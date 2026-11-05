package com.fcjy.fcboard;

import static org.junit.Assert.*;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
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
                assertTrue(invoke(scenario, "chosen", new JSObject(), uri).getBoolean("open"));
                JSObject state = null;
                for (int attempt = 0; attempt < 60; attempt++) {
                    state = invoke(scenario, "read", new JSObject().put("action", "read"), null);
                    if (state.optDouble("duration", -1) > 0) break;
                    Thread.sleep(200);
                }
                assertNotNull(state); assertEquals("", state.getString("error"));
                assertEquals(8.0, state.getDouble("duration"), 0.1);
                assertEquals(1, state.getJSONArray("items").length());
                assertFalse(invoke(scenario, "pause", new JSObject().put("action", "pause"), null).getBoolean("playing"));
                invoke(scenario, "seek", new JSObject().put("action", "seek").put("seconds", 2), null);
                assertEquals(2.0, invoke(scenario, "read", new JSObject().put("action", "read"), null).getDouble("position"), 0.1);
                invoke(scenario, "speed", new JSObject().put("action", "speed").put("speed", 1.5), null);
                // Let the previous Dialog's posted dismiss callback run after replacement.
                assertTrue(invoke(scenario, "chosen", new JSObject(), uri).getBoolean("open"));
                androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {});
                JSObject replacement = invoke(scenario, "read", new JSObject().put("action", "read"), null);
                assertTrue("Closing the old window must not release the replacement player", replacement.getBoolean("open"));
                assertEquals(1, replacement.getJSONArray("items").length());
            } finally {
                assertFalse(invoke(scenario, "close", new JSObject().put("action", "close"), null).getBoolean("open"));
            }
        } finally { assertTrue(audio.delete()); }
    }
}
