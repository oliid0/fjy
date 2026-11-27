package com.fcjy.fcboard;

import static org.junit.Assert.*;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Actual content-URI WAV decoding, playlist state and bridge controls, not a mocked media engine. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
@RunWith(AndroidJUnit4.class)
public class MediaPlaybackTest {
    /** Active WebView animations need not make the whole UI queue idle before every read. */
    private void onActivity(ActivityScenario<MainActivity> scenario, ActivityScenario.ActivityAction<MainActivity> action) {
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
            .runOnMainSync(() -> scenario.onActivity(action));
    }

    private JSObject invoke(ActivityScenario<MainActivity> scenario, String action, JSObject args, Uri chosen) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<JSObject> result = new AtomicReference<>();
        AtomicReference<String> failure = new AtomicReference<>();
        onActivity(scenario, activity -> {
            MediaPlugin plugin = (MediaPlugin) activity.getBridge().getPlugin("FcboardMedia").getInstance();
            PluginCall call = new PluginCall(null, "FcboardMedia", "test", action, args) {
                @Override public void resolve(JSObject value) { result.set(value); done.countDown(); }
                @Override public void reject(String message, String code, Exception error, JSObject value) { failure.set(message); done.countDown(); }
            };
            if ("activate".equals(action)) { plugin.activate(call); return; }
            if (chosen == null) { plugin.action(call); return; }
            try {
                java.lang.reflect.Method callback = MediaPlugin.class.getDeclaredMethod("chosen", PluginCall.class, ActivityResult.class);
                callback.setAccessible(true);
                callback.invoke(plugin, call, new ActivityResult(Activity.RESULT_OK, new Intent().setData(chosen)));
            } catch (Exception error) { failure.set(error.toString()); done.countDown(); }
        });
        assertTrue("Media bridge must complete", done.await(15, TimeUnit.SECONDS));
        assertNull(failure.get(), failure.get()); return result.get();
    }
    @Test public void chosenContentUriPlaysSeeksAndReleasesWithoutExternalApk() throws Exception {
        Context context = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getTargetContext();
        File audio = File.createTempFile("builtin-player-", ".wav", context.getCacheDir());
        int bytes = 16000 * 2 * 8;
        ByteBuffer wave = ByteBuffer.allocate(44 + bytes).order(ByteOrder.LITTLE_ENDIAN);
        wave.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + bytes).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII))
            .putInt(16).putShort((short)1).putShort((short)1).putInt(16000).putInt(32000).putShort((short)2).putShort((short)16)
            .put("data".getBytes(StandardCharsets.US_ASCII)).putInt(bytes);
        try (FileOutputStream output = new FileOutputStream(audio)) { output.write(wave.array()); }
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", audio);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            try {
                JSObject selected = invoke(scenario, "chosen", new JSObject().put("fileTypes", new JSObject().put("wav", "audio/wav")), uri);
                JSObject target = new JSObject().put("owner", "board-player").put("key", selected.getString("key"));
                assertTrue(invoke(scenario, "activate", target, null).getBoolean("open"));
                JSObject state = null;
                for (int attempt = 0; attempt < 60; attempt++) {
                    state = invoke(scenario, "read", new JSObject().put("action", "read"), null);
                    if (state.optDouble("duration", -1) > 0) break;
                    Thread.sleep(200);
                }
                assertNotNull(state); assertEquals("", state.getString("error"));
                assertEquals(8.0, state.getDouble("duration"), 0.1);
                assertEquals(0, state.getInt("enhancement"));
                assertEquals("off", state.getString("enhancementStatus"));
                assertEquals(1, state.getJSONArray("items").length());
                assertFalse(invoke(scenario, "pause", new JSObject().put("action", "pause"), null).getBoolean("playing"));
                invoke(scenario, "seek", new JSObject().put("action", "seek").put("seconds", 2), null);
                assertEquals(2.0, invoke(scenario, "read", new JSObject().put("action", "read"), null).getDouble("position"), 0.1);
                invoke(scenario, "speed", new JSObject().put("action", "speed").put("speed", 1.5), null);
                // Let the previous Dialog's posted dismiss callback run after replacement.
                assertTrue(invoke(scenario, "activate", target.put("owner", "copied-player"), null).getBoolean("open"));
                invoke(scenario, "close", new JSObject().put("action", "close").put("owner", "board-player"), null);
                androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {});
                JSObject replacement = invoke(scenario, "read", new JSObject().put("action", "read"), null);
                assertTrue("Closing the old window must not release the replacement player", replacement.getBoolean("open"));
                assertEquals(1, replacement.getJSONArray("items").length());
            } finally {
                try {
                    assertFalse(invoke(scenario, "close", new JSObject().put("action", "close"), null).getBoolean("open"));
                } finally { onActivity(scenario, MainActivity::finish); }
            }
        } finally { assertTrue(audio.delete()); }
    }

    @Test public void enhancementPreservesPcmLengthAndReleasesWhenPaused() throws Exception {
        Context context = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getTargetContext();
        VoiceEnhancementProcessor processor = new VoiceEnhancementProcessor(context.getAssets(), () -> {});
        // A fractional hop size exercises the resampler and a partial end-of-stream drain.
        int rate = 44100;
        ByteBuffer input = ByteBuffer.allocateDirect((rate + 29) * 4).order(ByteOrder.nativeOrder());
        for (int frame = 0; frame < rate + 29; ++frame) {
            short sample = (short) (8000 * Math.sin(2 * Math.PI * frame * 300 / rate));
            input.putShort(sample).putShort(sample);
        }
        input.flip();
        byte[] original = new byte[input.remaining()];
        input.get(original).flip();
        try {
            processor.configure(new AudioProcessor.AudioFormat(rate, 2, C.ENCODING_PCM_16BIT));
            processor.flush(AudioProcessor.StreamMetadata.DEFAULT);
            assertArrayEquals(original, renderPcm(processor, input));
            input.rewind();

            processor.flush(AudioProcessor.StreamMetadata.DEFAULT);
            processor.setPlaybackActive(true);
            processor.setLevel(1);
            for (int attempt = 0; attempt < 100 && processor.status() == VoiceEnhancementProcessor.Status.LOADING; ++attempt) {
                Thread.sleep(50);
            }
            assertEquals(VoiceEnhancementProcessor.Status.ACTIVE, processor.status());
            processor.setLevel(3);
            byte[] enhanced = renderPcm(processor, input);
            assertEquals(original.length, enhanced.length);
            assertFalse(java.util.Arrays.equals(original, enhanced));

            processor.setPlaybackActive(false);
            assertEquals(VoiceEnhancementProcessor.Status.WAITING, processor.status());
            processor.setLevel(0);
            assertEquals(VoiceEnhancementProcessor.Status.OFF, processor.status());
        } finally {
            processor.close();
            processor.reset();
        }
    }

    @Test public void bundledModelReducesNoiseAtEachStrengthWithoutChangingSpeechTiming() throws Exception {
        Context test = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getContext();
        Context app = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getTargetContext();
        byte[] recording;
        try (java.io.InputStream speech = test.getAssets().open("chinese-circle-command.pcm")) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = speech.read(chunk)) != -1) bytes.write(chunk, 0, read);
            recording = bytes.toByteArray();
        }
        java.nio.ShortBuffer reference = ByteBuffer.wrap(recording).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer();
        // Mono, 16 kHz, with half a second of background alone before and after speech.
        int pad = 8000;
        int count = 2 * pad + reference.remaining();
        ByteBuffer noisy = ByteBuffer.allocateDirect(count * 2).order(ByteOrder.nativeOrder());
        java.util.Random noise = new java.util.Random(20261122);
        for (int i = 0; i < count; ++i) {
            double clean = i >= pad && i < count - pad ? .65 * reference.get(i - pad) : 0;
            noisy.putShort((short) Math.round(clean + (noise.nextDouble() * 2 - 1) * 2400));
        }
        VoiceEnhancementProcessor processor = new VoiceEnhancementProcessor(app.getAssets(), () -> {});
        try {
            processor.configure(new AudioProcessor.AudioFormat(16000, 1, C.ENCODING_PCM_16BIT));
            processor.setPlaybackActive(true);
            double previousNoise = 0, originalPower = 0, originalError = 0;
            for (int level = 0; level <= 3; ++level) {
                processor.flush(AudioProcessor.StreamMetadata.DEFAULT);
                processor.setLevel(level);
                for (int i = 0; i < 200 && processor.status() == VoiceEnhancementProcessor.Status.LOADING; ++i) Thread.sleep(25);
                if (level > 0) assertEquals(VoiceEnhancementProcessor.Status.ACTIVE, processor.status());
                noisy.rewind();
                byte[] output = renderPcm(processor, noisy);
                assertEquals(count * 2, output.length);
                java.nio.ShortBuffer samples = ByteBuffer.wrap(output).order(ByteOrder.nativeOrder()).asShortBuffer();
                double background = 0, power = 0, error = 0;
                for (int i = 0; i < count; ++i) {
                    double sample = samples.get(i);
                    if (i >= count - pad / 2) background += sample * sample;
                    power += sample * sample;
                    if (i >= pad && i < count - pad) {
                        double difference = sample - .65 * reference.get(i - pad);
                        error += difference * difference;
                    }
                }
                if (level == 0) { originalPower = power; originalError = error; }
                else {
                    assertTrue("Each step must reduce real background energy", background < previousNoise * .8);
                    assertTrue("Output RMS rose", power <= originalPower * 1.01);
                }
                if (level == 3) {
                    assertTrue("Speech must remain closer to the reference", error < originalError);
                    double best = -Double.MAX_VALUE;
                    int lag = 0;
                    for (int shift = -200; shift <= 200; ++shift) {
                        double correlation = 0;
                        for (int i = 0; i < reference.limit(); i += 4)
                            correlation += (double) reference.get(i) * samples.get(pad + i + shift);
                        if (correlation > best) { best = correlation; lag = shift; }
                    }
                    assertTrue("Unexpected speech delay in samples: " + lag, Math.abs(lag) <= 2);
                }
                previousNoise = background;
            }
            processor.setLevel(0);
            processor.flush(AudioProcessor.StreamMetadata.DEFAULT);
            noisy.rewind();
            renderPcm(processor, noisy);
            processor.flush(AudioProcessor.StreamMetadata.DEFAULT);
            // Smaller than one hop: a retired model must return the input immediately.
            ByteBuffer sample = ByteBuffer.allocateDirect(2).order(ByteOrder.nativeOrder());
            sample.putShort((short) 1234).flip();
            processor.queueInput(sample);
            assertEquals(1234, processor.getOutput().getShort());
        } finally { processor.close(); processor.reset(); }
    }

    private static byte[] renderPcm(VoiceEnhancementProcessor processor, ByteBuffer input) {
        ByteArrayOutputStream result = new ByteArrayOutputStream();
        while (input.hasRemaining()) {
            processor.queueInput(input);
            appendPcm(result, processor.getOutput());
        }
        processor.queueEndOfStream();
        appendPcm(result, processor.getOutput());
        return result.toByteArray();
    }

    private static void appendPcm(ByteArrayOutputStream result, ByteBuffer pcm) {
        byte[] bytes = new byte[pcm.remaining()];
        pcm.get(bytes);
        result.write(bytes, 0, bytes.length);
    }
}
