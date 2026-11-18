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
    private final ExecutorService worker = Executors.newFixedThreadPool(2, task -> new Thread(() -> {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND);
        task.run();
    }, "fcboard-offline-speech"));
    private final Map<String, AtomicBoolean> jobs = new ConcurrentHashMap<>();
    private volatile boolean destroyed;
    private final ModelPool<OfflineTtsEngine> clients = new ModelPool<>(2, key -> false);
    @Override public void load() { clients.observe(getContext()); }
    @Override protected void handleOnStop() { clients.trim(); }

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
        if (destroyed || jobs.size() >= 8 || jobs.putIfAbsent(id, cancelled) != null) {
            call.reject("Speech request is unavailable"); return;
        }
        worker.execute(() -> {
            ModelPool.Lease<OfflineTtsEngine> lease = null;
            boolean success = false;
            try {
                if (cancelled.get() || destroyed) { throw new java.util.concurrent.CancellationException(); }
                lease = clients.acquire("speech", () -> new OfflineTtsEngine(getContext()));
                lease.value().synthesize(call.getString("text"), output, () -> cancelled.get() || destroyed);
                if (cancelled.get() || destroyed) { throw new java.util.concurrent.CancellationException(); }
                JSObject result = new JSObject();
                result.put("path", android.net.Uri.fromFile(output).toString());
                success = true;
                call.resolve(result);
            } catch (Exception | LinkageError error) {
                output.delete();
                call.reject("Offline speech synthesis failed: " + error.getMessage());
            } finally {
                if (lease != null) lease.release(success && !cancelled.get() && !destroyed);
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
        clients.close();
        jobs.values().forEach(cancelled -> cancelled.set(true));
        worker.shutdown();
    }
}
