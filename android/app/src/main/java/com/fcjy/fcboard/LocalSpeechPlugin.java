package com.fcjy.fcboard;

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
@CapacitorPlugin(name = "FcboardLocalSpeech")
public class LocalSpeechPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private Transcriber transcriber;
    private int stream = -1;
    private String session;
    private JSArray completed = new JSArray();
    private JSObject interim;
    private boolean speechActive;
    private Throwable transcriptError;
    private static final String[] FILES = {
        "adapter.ort", "cross_kv.ort", "decoder_kv.ort", "encoder.ort",
        "frontend.model.ort", "frontend.weights.ort", "streaming_config.json", "tokenizer.bin"
    };
    private static final long[] SIZES = {1318472, 1288120, 19717336, 7772792, 27608, 2090728, 509, 74587};

    static File modelDirectory(android.content.Context context) throws Exception {
        File directory = new File(context.getFilesDir(), "moonshine-tiny-zh-26-08-24");
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IllegalStateException("Unable to prepare the offline speech model directory");
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
                throw new IllegalStateException("The offline model is incomplete; check the installed package and free storage");
            }
        }
        return directory;
    }

    @PluginMethod
    public void prepare(PluginCall call) {
        worker.execute(() -> {
            try {
                prepareModel();
                call.resolve();
            } catch (Exception | LinkageError error) { release(); call.reject("The bundled Chinese speech model is unavailable: " + error.getMessage()); }
        });
    }

    @PluginMethod
    public void start(PluginCall call) {
        worker.execute(() -> {
            if (session != null) { call.reject("A speech task is already running"); return; }
            try {
                prepareModel();
                completed = new JSArray();
                interim = null; speechActive = false; transcriptError = null;
                stream = transcriber.createStream();
                transcriber.startStream(stream);
                session = UUID.randomUUID().toString();
                JSObject result = new JSObject(); result.put("session", session); call.resolve(result);
            } catch (Exception | LinkageError error) {
                release(); call.reject("Unable to start bundled Chinese speech: " + error.getMessage());
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
                    throw new IllegalArgumentException("Invalid audio segment format");
                }
                byte[] data = Base64.decode(pcm, Base64.DEFAULT);
                if (data.length % 2 != 0 || data.length > rate * 4) {
                    throw new IllegalArgumentException("The audio segment is too long or incomplete");
                }
                ByteBuffer input = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
                float[] samples = new float[data.length / 2];
                for (int i = 0; i < samples.length; i++) { samples[i] = input.getShort() / 32768f; }
                transcriber.addAudioToStream(stream, samples, rate);
                call.resolve(drain());
            } catch (Exception | LinkageError error) {
                call.reject("Offline recognition failed: " + error.getMessage());
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        worker.execute(() -> {
            if (session == null || !session.equals(call.getString("session"))) {
                call.reject("The speech task ended"); return;
            }
            try {
                transcriber.stopStream(stream);
                call.resolve(drain());
            } catch (Exception | LinkageError error) { call.reject("Unable to finish offline recognition: " + error.getMessage()); }
            finally { releaseSession(); }
        });
    }

    private void requireSession(PluginCall call) {
        if (session == null || !session.equals(call.getString("session"))) {
            throw new IllegalStateException("The speech task ended; start a new session");
        }
    }
    private JSObject drain() {
        if (transcriptError != null) throw new IllegalStateException("Transcription failed", transcriptError);
        JSObject result = new JSObject(); result.put("lines", completed);
        result.put("activity", speechActive);
        result.put("interim", interim == null ? org.json.JSONObject.NULL : interim);
        completed = new JSArray(); return result;
    }
    private void prepareModel() throws Exception {
        if (transcriber != null && transcriber.isLoaded()) { return; }
        Transcriber model = new Transcriber(Collections.singletonList(
            new TranscriberOption("max_tokens_per_second", "13.0")));
        try {
            model.loadFromFiles(modelDirectory(getContext()).getAbsolutePath(), JNI.MOONSHINE_MODEL_ARCH_TINY_STREAMING);
            model.setUpdateInterval(0.5);
            model.addListener(event -> {
                TranscriptLine pending = null;
                if (event instanceof TranscriptEvent.LineStarted) pending = ((TranscriptEvent.LineStarted)event).line;
                else if (event instanceof TranscriptEvent.LineUpdated) pending = ((TranscriptEvent.LineUpdated)event).line;
                else if (event instanceof TranscriptEvent.LineTextChanged) pending = ((TranscriptEvent.LineTextChanged)event).line;
                else if (event instanceof TranscriptEvent.Error) transcriptError = ((TranscriptEvent.Error)event).cause;
                if (pending != null) {
                    speechActive = true;
                    if (pending.text != null && !pending.text.trim().isEmpty()) interim = new JSObject().put("time", Math.max(0, pending.startTime)).put("text", pending.text.trim());
                }
                if (event instanceof TranscriptEvent.LineCompleted) {
                    speechActive = false; interim = null;
                    TranscriptLine line = ((TranscriptEvent.LineCompleted) event).line;
                    if (line.text != null && !line.text.trim().isEmpty()) {
                        JSObject value = new JSObject();
                        value.put("time", Math.max(0, line.startTime));
                        value.put("text", line.text.trim());
                        completed.put(value);
                    }
                }
            });
            transcriber = model;
        } catch (Exception | LinkageError error) { model.close(); throw error; }
    }
    private void releaseSession() {
        if (transcriber != null && stream >= 0) { transcriber.freeStream(stream); }
        stream = -1;
        session = null;
        completed = new JSArray();
        interim = null; speechActive = false; transcriptError = null;
    }
    private void release() {
        releaseSession();
        if (transcriber != null) { transcriber.close(); transcriber = null; }
        session = null; completed = new JSArray();
    }
    @Override
    protected void handleOnDestroy() {
        worker.execute(this::release);
        worker.shutdown();
    }
}
