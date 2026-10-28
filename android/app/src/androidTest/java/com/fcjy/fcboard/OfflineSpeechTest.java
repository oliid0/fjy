package com.fcjy.fcboard;

import static org.junit.Assert.assertTrue;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import ai.moonshine.voice.JNI;
import ai.moonshine.voice.Transcriber;
import ai.moonshine.voice.TranscriberOption;
import java.io.File;
import java.util.Collections;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Runs the actual bundled model/JNI on Android; no microphone or system STT service. */
@RunWith(AndroidJUnit4.class)
public class OfflineSpeechTest {
    @Test
    public void bundledChineseModelRecognizesSpeechAcrossTwoSessions() throws Exception {
        File directory = LocalSpeechPlugin.modelDirectory(
            InstrumentationRegistry.getInstrumentation().getTargetContext());
        byte[] bytes;
        try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("chinese-circle-command.pcm")) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) { output.write(buffer, 0, count); }
            bytes = output.toByteArray();
        }
        ByteBuffer pcm = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        float[] samples = new float[bytes.length / 2];
        for (int index = 0; index < samples.length; index++) { samples[index] = pcm.getShort() / 32768f; }
        Transcriber transcriber = new Transcriber(Collections.singletonList(
            new TranscriberOption("max_tokens_per_second", "13.0")));
        StringBuilder text = new StringBuilder();
        boolean[] started = {false};
        transcriber.addListener(event -> {
            if (event instanceof ai.moonshine.voice.TranscriptEvent.LineStarted) started[0] = true;
            if (event instanceof ai.moonshine.voice.TranscriptEvent.LineCompleted) {
                text.append(((ai.moonshine.voice.TranscriptEvent.LineCompleted) event).line.text);
            }
        });
        try {
            transcriber.loadFromFiles(directory.getAbsolutePath(), JNI.MOONSHINE_MODEL_ARCH_TINY_STREAMING);
            for (int session = 0; session < 2; session++) {
                text.setLength(0);
                started[0] = false;
                int stream = transcriber.createStream();
                try {
                    transcriber.startStream(stream);
                    for (int offset = 0; offset < samples.length; offset += 8000) {
                        transcriber.addAudioToStream(stream, java.util.Arrays.copyOfRange(samples, offset, Math.min(samples.length, offset + 8000)), 16000);
                    }
                    transcriber.stopStream(stream);
                    assertTrue("Expected live speech activity before completing transcript", started[0]);
                    assertTrue("Expected Chinese circle command, got: " + text, text.toString().contains("画") && text.toString().contains("圆"));
                } finally { transcriber.freeStream(stream); }
            }
        } finally { transcriber.close(); }
    }
    @Test
    public void bundledChineseModelLoadsAndProcessesAudioOffline() throws Exception {
        File directory = LocalSpeechPlugin.modelDirectory(
            InstrumentationRegistry.getInstrumentation().getTargetContext());
        assertTrue(new File(directory, "decoder_kv.ort").length() == 19717336);
        Transcriber transcriber = new Transcriber(Collections.singletonList(
            new TranscriberOption("max_tokens_per_second", "13.0")));
        try {
            transcriber.loadFromFiles(directory.getAbsolutePath(), JNI.MOONSHINE_MODEL_ARCH_TINY_STREAMING);
            assertTrue(transcriber.isLoaded());
            transcriber.start();
            for (int i = 0; i < 4; i++) { transcriber.addAudio(new float[8000], 16000); }
            transcriber.stop();
        } finally { transcriber.close(); }
    }
}
