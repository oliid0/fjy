package com.fcjy.fcboard;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** No network, system TTS service or UI-thread inference. Playback stays with the narrator. */
@CapacitorPlugin(name = "FcboardOfflineTts")
public class OfflineTtsPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Map<String, AtomicBoolean> jobs = new ConcurrentHashMap<>();
    private volatile boolean destroyed;
    private OfflineTtsEngine engine;

    private File audioFile(String id) {
        if (id == null || !id.matches("[a-fA-F0-9-]{36}")) {
            throw new IllegalArgumentException("Invalid speech request ID");
        }
        return new File(getContext().getCacheDir(), "fcboard-tts-" + id + ".wav");
    }

    @PluginMethod public void synthesize(PluginCall call) {
        String id = call.getString("id");
        final File output;
        try { output = audioFile(id); }
        catch (IllegalArgumentException error) { call.reject(error.getMessage()); return; }
        AtomicBoolean cancelled = new AtomicBoolean();
        if (destroyed || jobs.putIfAbsent(id, cancelled) != null) {
            call.reject("Speech request is unavailable"); return;
        }
        worker.execute(() -> {
            try {
                if (cancelled.get() || destroyed) { throw new java.util.concurrent.CancellationException(); }
                if (engine == null) { engine = new OfflineTtsEngine(getContext()); }
                engine.synthesize(call.getString("text"), output, () -> cancelled.get() || destroyed);
                if (cancelled.get() || destroyed) { throw new java.util.concurrent.CancellationException(); }
                JSObject result = new JSObject();
                result.put("path", android.net.Uri.fromFile(output).toString());
                call.resolve(result);
            } catch (Exception | LinkageError error) {
                output.delete();
                call.reject("Offline speech synthesis failed: " + error.getMessage());
            } finally {
                jobs.remove(id, cancelled);
                if (cancelled.get() || destroyed) { output.delete(); }
            }
        });
    }

    @PluginMethod public void cancel(PluginCall call) {
        try {
            File output = audioFile(call.getString("id"));
            AtomicBoolean cancelled = jobs.get(call.getString("id"));
            if (cancelled != null) { cancelled.set(true); }
            output.delete();
            call.resolve();
        } catch (IllegalArgumentException error) { call.reject(error.getMessage()); }
    }

    @Override protected void handleOnDestroy() {
        destroyed = true;
        jobs.values().forEach(cancelled -> cancelled.set(true));
        worker.execute(() -> { if (engine != null) { engine.close(); engine = null; } });
        worker.shutdown();
    }
}
