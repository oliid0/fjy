package com.fcjy.fcboard;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Message;
import android.os.Messenger;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real packaged ONNX models and IPC, never mocked WebView/model responses. */
@RunWith(AndroidJUnit4.class)
public class NativeInferenceTest {
    @Test public void apkHasOnlyNativePenModelsAndNoBrowserInferenceAssets() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals(0, context.getAssets().list("public/ocr").length);
        assertEquals(0, context.getAssets().list("public/local-models").length);
        assertEquals(0, context.getAssets().list("public/dictionary").length);
        try (java.io.InputStream dictionary = context.getAssets().open("dictionary/en-zh.json")) { assertTrue(dictionary.read() >= 0); }
        for (String path : new String[]{"comer/encoder_int8.onnx", "comer/decoder_int8.onnx", "Xenova/opus-mt-en-zh/onnx/encoder_model_quantized.onnx", "Xenova/opus-mt-zh-en/onnx/decoder_model_merged_quantized.onnx"}) {
            try (java.io.InputStream asset = context.getAssets().open("inference/" + path)) { assertTrue(asset.read() >= 0); }
        }
    }
    @Test public void translatesShortWordsInTheSeparateNativeProcessWithoutRepetition() throws Exception {
        try (Connection connection = new Connection()) {
            String[][] samples = {{"hello", "你好|您好|喂|哈罗"}, {"hi", "嗨|你好|您好|喂"}, {"yes", "是|对|好"}, {"thank", "谢|感谢"}};
            for (String[] sample : samples) {
                Bundle input = new Bundle(); input.putString("kind", "translation"); input.putString("source", "en"); input.putString("target", "zh"); input.putString("text", sample[0]);
                Bundle result = connection.request(input);
                assertFalse(result.getString("error", ""), result.containsKey("error"));
                assertNotEquals(android.os.Process.myPid(), result.getInt("processId"));
                assertEquals("dictionary", result.getString("engine"));
                String text = result.getString("translation", "");
                assertTrue(sample[0] + " -> " + text, java.util.regex.Pattern.compile(sample[1]).matcher(text).find());
                assertFalse(text, java.util.regex.Pattern.compile("(.{1,8})\\1\\1").matcher(text).find());
                Bundle repeated = connection.request(input); assertEquals(text, repeated.getString("translation"));
            }
            Bundle sentence = new Bundle(); sentence.putString("kind", "translation"); sentence.putString("source", "en"); sentence.putString("target", "zh"); sentence.putString("text", "I love you.");
            Bundle sentenceResult = connection.request(sentence); assertFalse(sentenceResult.getString("error", ""), sentenceResult.containsKey("error"));
            assertEquals("onnxruntime", sentenceResult.getString("engine"));
            assertTrue(sentenceResult.getString("translation"), sentenceResult.getString("translation").contains("我爱你"));
            Bundle input = new Bundle(); input.putString("kind", "translation"); input.putString("source", "zh"); input.putString("target", "en"); input.putString("text", "你好");
            Bundle result = connection.request(input); assertFalse(result.getString("error", ""), result.containsKey("error"));
            assertTrue(result.getString("translation"), result.getString("translation").toLowerCase(java.util.Locale.ROOT).matches(".*(hello|hi).*"));
        }
    }
    @Test public void nativeMathRunsTheShippedEncoderDecoderAndKeepsDotPixels() throws Exception {
        float[] points = {0, 0, 0, 80, 30, 40, 70, 40, 50, 20, 50, 60, 100, 0, 100, 80};
        MathInkTensor dot = new MathInkTensor(new float[]{1, 1}, new int[]{1});
        boolean white = false;
        for (int i = 0; i < dot.pixels.limit(); i++) white |= dot.pixels.get(i) > 0;
        assertTrue("Decimal/division dots must survive rasterization", white);
        try (Connection connection = new Connection()) {
            Bundle input = new Bundle(); input.putString("kind", "math"); input.putFloatArray("points", points); input.putIntArray("lengths", new int[]{2, 2, 2, 2});
            Bundle result = connection.request(input); assertFalse(result.getString("error", ""), result.containsKey("error"));
            assertFalse(result.getString("latex", "").trim().isEmpty());
            assertNotEquals(android.os.Process.myPid(), result.getInt("processId"));
        }
    }
    private static final class Connection implements AutoCloseable {
        final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        final HandlerThread replies = new HandlerThread("native-model-test");
        final CountDownLatch connected = new CountDownLatch(1);
        Messenger remote;
        final ServiceConnection connection = new ServiceConnection() {
            @Override public void onServiceConnected(ComponentName name, IBinder binder) { remote = new Messenger(binder); connected.countDown(); }
            @Override public void onServiceDisconnected(ComponentName name) { remote = null; }
        };
        Connection() throws Exception {
            replies.start();
            assertTrue(context.bindService(new Intent(context, LocalInferenceService.class), connection, Context.BIND_AUTO_CREATE));
            assertTrue("Native service did not bind", connected.await(10, TimeUnit.SECONDS));
        }
        Bundle request(Bundle source) throws Exception {
            Bundle input = new Bundle(source); input.putString("id", UUID.randomUUID().toString());
            CountDownLatch completed = new CountDownLatch(1); AtomicReference<Bundle> result = new AtomicReference<>();
            Message message = Message.obtain(null, LocalInferenceService.INFER); message.setData(input);
            message.replyTo = new Messenger(new Handler(replies.getLooper(), reply -> { result.set(reply.getData()); completed.countDown(); return true; }));
            remote.send(message); assertTrue("Native inference timed out", completed.await(75, TimeUnit.SECONDS)); return result.get();
        }
        @Override public void close() { context.unbindService(connection); replies.quitSafely(); }
    }
}
