package com.fcjy.fcboard;

import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.util.concurrent.CancellationException;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real bundled weights and JNI, without a system TTS engine, endpoint or network download. */
@RunWith(AndroidJUnit4.class)
public class OfflineTtsTest {
    @Test public void synthesizesAudibleChineseAndEnglishAndHonorsCancellation() throws Exception {
        android.content.Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File output = new File(context.getCacheDir(), "tts-instrumentation.wav");
        try (OfflineTtsEngine engine = new OfflineTtsEngine(context)) {
            for (String text : new String[]{"牛顿定律。", "Hello world."}) {
                engine.synthesize(text, output, () -> false);
                byte[] wav = Files.readAllBytes(output.toPath());
                assertEquals("RIFF", new String(wav, 0, 4, java.nio.charset.StandardCharsets.US_ASCII));
                assertTrue("Missing PCM", wav.length > 10000);
                ByteBuffer pcm = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN);
                assertEquals(44100, pcm.getInt(24));
                long energy = 0;
                for (int index = 44; index + 1 < wav.length; index += 2) { energy += Math.abs((int)pcm.getShort(index)); }
                assertTrue("The model returned silence", energy > wav.length * 2L);
                output.delete();
            }
            try {
                engine.synthesize("取消后不可出声。", output, () -> true);
                fail("Cancelled synthesis must not succeed");
            } catch (CancellationException expected) { assertFalse(output.exists()); }
        } finally { output.delete(); }
    }
}
