package com.fcjy.fcboard;

import static org.junit.Assert.assertTrue;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import ai.moonshine.voice.JNI;
import ai.moonshine.voice.Transcriber;
import ai.moonshine.voice.TranscriberOption;
import java.io.File;
import java.util.Collections;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Runs the actual bundled model/JNI on Android; no microphone or system STT service. */
@RunWith(AndroidJUnit4.class)
public class OfflineSpeechTest {
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
