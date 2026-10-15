package com.fcjyboard.fcdraw;

import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import ai.moonshine.voice.JNI;
import ai.moonshine.voice.Transcriber;
import ai.moonshine.voice.TranscriberOption;
import ai.moonshine.voice.TranscriptEvent;
import ai.moonshine.voice.TranscriptLine;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Offline STT. PCM comes from the same WebAudio microphone as the recording. */
@CapacitorPlugin(name = "FcdrawLocalSpeech")
public class LocalSpeechPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private Transcriber transcriber;
    private String session;
    private JSArray completed = new JSArray();
    private static final String[] FILES = {
        "adapter.ort", "cross_kv.ort", "decoder_kv.ort", "encoder.ort",
        "frontend.model.ort", "frontend.weights.ort", "streaming_config.json", "tokenizer.bin"
    };
    private static final long[] SIZES = {1318472, 1288120, 19717336, 7772792, 27608, 2090728, 509, 74587};

    static File modelDirectory(android.content.Context context) throws Exception {
        File directory = new File(context.getFilesDir(), "moonshine-tiny-zh-26-08-24");
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IllegalStateException("无法准备离线语音模型目录");
        }
        for (int index = 0; index < FILES.length; index++) {
            String name = FILES[index];
            File target = new File(directory, name);
            if (target.isFile() && target.length() == SIZES[index]) { continue; }
            File pending = new File(directory, name + ".pending");
            try (InputStream input = context.getAssets().open("speech/zh/" + name);
                 FileOutputStream output = new FileOutputStream(pending)) {
                byte[] buffer = new byte[65536];
                int size;
                while ((size = input.read(buffer)) != -1) { output.write(buffer, 0, size); }
                output.getFD().sync();
            }
            if (pending.length() != SIZES[index] || !pending.renameTo(target)) {
                throw new IllegalStateException("离线模型不完整，请检查安装包与剩余存储空间");
            }
        }
        return directory;
    }

    @PluginMethod
    public void prepare(PluginCall call) {
        worker.execute(() -> {
            try {
                modelDirectory(getContext());
                call.resolve();
            } catch (Exception error) { call.reject("离线中文语音模型不可用：" + error.getMessage()); }
        });
    }

    @PluginMethod
    public void start(PluginCall call) {
        worker.execute(() -> {
            if (session != null) { call.reject("已有语音任务正在运行"); return; }
            try {
                transcriber = new Transcriber(Collections.singletonList(
                    new TranscriberOption("max_tokens_per_second", "13.0")));
                transcriber.loadFromFiles(modelDirectory(getContext()).getAbsolutePath(), JNI.MOONSHINE_MODEL_ARCH_TINY_STREAMING);
                completed = new JSArray();
                transcriber.addListener(event -> {
                    if (event instanceof TranscriptEvent.LineCompleted) {
                        TranscriptLine line = ((TranscriptEvent.LineCompleted) event).line;
                        if (line.text != null && !line.text.trim().isEmpty()) {
                            JSObject value = new JSObject();
                            value.put("time", Math.max(0, line.startTime));
                            value.put("text", line.text.trim());
                            completed.put(value);
                        }
                    }
                });
                transcriber.start();
                session = UUID.randomUUID().toString();
                JSObject result = new JSObject(); result.put("session", session); call.resolve(result);
            } catch (Exception | LinkageError error) {
                release(); call.reject("无法启动内置中文语音：" + error.getMessage());
            }
        });
    }

    @PluginMethod
    public void push(PluginCall call) {
        worker.execute(() -> {
            try {
                requireSession(call);
                int rate = call.getInt("sampleRate", 16000);
                String pcm = call.getString("pcm", "");
                if (rate < 8000 || rate > 96000 || pcm.length() > 512000) {
                    throw new IllegalArgumentException("音频片段格式无效");
                }
                byte[] data = Base64.decode(pcm, Base64.DEFAULT);
                if (data.length % 2 != 0 || data.length > rate * 4) {
                    throw new IllegalArgumentException("音频片段过长或不完整");
                }
                ByteBuffer input = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
                float[] samples = new float[data.length / 2];
                for (int i = 0; i < samples.length; i++) { samples[i] = input.getShort() / 32768f; }
                transcriber.addAudio(samples, rate);
                call.resolve(drain());
            } catch (Exception | LinkageError error) {
                call.reject("离线识别失败：" + error.getMessage());
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        worker.execute(() -> {
            if (session == null || !session.equals(call.getString("session"))) {
                call.reject("语音任务已结束"); return;
            }
            try {
                transcriber.stop();
                call.resolve(drain());
            } catch (Exception | LinkageError error) { call.reject("无法结束离线识别：" + error.getMessage()); }
            finally { release(); }
        });
    }

    private void requireSession(PluginCall call) {
        if (session == null || !session.equals(call.getString("session"))) {
            throw new IllegalStateException("语音任务已结束，请重新开启");
        }
    }
    private JSObject drain() {
        JSObject result = new JSObject(); result.put("lines", completed); completed = new JSArray(); return result;
    }
    private void release() {
        if (transcriber != null) { transcriber.close(); transcriber = null; }
        session = null; completed = new JSArray();
    }
    @Override
    protected void handleOnDestroy() {
        worker.execute(this::release);
        worker.shutdown();
    }
}
