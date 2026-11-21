package com.fcjy.fcboard;

import android.app.Service;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.os.RemoteException;
import ai.onnxruntime.OrtSession;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.CancellationException;

/** Only this private :ml_engine process maps model files and allocates tensors. */
public class LocalInferenceService extends Service {
    static final int INFER = 1, CANCEL = 2, INK_ACTIVITY = 3;
    private final ExecutorService worker = Executors.newFixedThreadPool(2, task -> new Thread(() -> {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND);
        task.run();
    }, "fcboard-local-model"));
    private final ExecutorService dictionaryWorker = Executors.newSingleThreadExecutor();
    private NativeLexicon lexicon;
    private final Map<String, Job> jobs = new ConcurrentHashMap<>();
    private volatile boolean closed;
    private final ModelPool<NativePenModels> clients = new ModelPool<>(2, key -> key.startsWith("math:"));
    static final class Job {
        final Bundle input;
        final Messenger reply;
        private boolean cancelled;
        private OrtSession.RunOptions running;
        Job(Bundle input, Messenger reply) { this.input = input; this.reply = reply; }
        synchronized void check() { if (cancelled) throw new CancellationException("Inference cancelled"); }
        synchronized void cancel() {
            cancelled = true;
            if (running != null) try { running.setTerminate(true); } catch (Exception ignored) { }
        }
        synchronized void attach(OrtSession.RunOptions options) { check(); running = options; }
        synchronized void detach() { running = null; }
    }
    private final Messenger messenger = new Messenger(new Handler(Looper.getMainLooper(), message -> {
        String id = message.getData().getString("id", "");
        if (message.what == INK_ACTIVITY) {
            ModelPool.inkActivity();
        } else if (message.what == CANCEL) {
            Job job = jobs.get(id); if (job != null) job.cancel();
        } else if (message.what == INFER && message.replyTo != null && !closed) {
            Job job = new Job(message.getData(), message.replyTo);
            if (jobs.size() >= 8 || jobs.putIfAbsent(id, job) != null) {
                Bundle error = new Bundle(); error.putString("error", "Native inference queue full"); respond(id, job, error);
            } else if (job.input.getString("kind", "").equals("translation") && job.input.getString("source", "").equals("en") && job.input.getString("target", "").equals("zh")) {
                dictionaryWorker.execute(() -> lookup(id, job));
            } else worker.execute(() -> execute(id, job));
        }
        return true;
    }));
    private void lookup(String id, Job job) {
        Bundle result = new Bundle();
        try {
            job.check();
            if (closed) throw new java.util.concurrent.CancellationException();
            if (lexicon == null) lexicon = new NativeLexicon(this);
            String text = lexicon.lookup(job.input.getString("text", "")); job.check();
            if (text == null) { worker.execute(() -> execute(id, job)); return; }
            result.putString("language", "en"); result.putString("translation", text); result.putString("engine", "dictionary");
        } catch (Exception error) { result.putString("error", "Local dictionary failed: " + error.getMessage()); }
        jobs.remove(id, job); respond(id, job, result);
    }
    private void execute(String id, Job job) {
        Bundle result = new Bundle();
        ModelPool.Lease<NativePenModels> lease = null;
        boolean success = false;
        try {
            job.check();
            if (closed) throw new CancellationException();
            // A request owns all mutable decoder state and native sessions.
            // Closing one request cannot terminate another equation or translation.
            String key = job.input.getString("kind", "") + ":" + job.input.getString("source", "") + ":" + job.input.getString("target", "");
            lease = clients.acquire(key, () -> new NativePenModels(this));
            result = lease.value().infer(job);
            job.check();
            success = true;
        } catch (Exception | LinkageError error) {
            result.putString("error", "Local model inference failed: " + error.getMessage());
        } finally { if (lease != null) lease.release(success && !closed); jobs.remove(id, job); }
        respond(id, job, result);
    }
    private static void respond(String id, Job job, Bundle result) {
        result.putString("id", id);
        result.putInt("processId", android.os.Process.myPid());
        Message reply = Message.obtain(); reply.setData(result);
        try { job.reply.send(reply); } catch (RemoteException ignored) { /* The requesting surface is gone. */ }
    }
    @Override public IBinder onBind(Intent intent) { return messenger.getBinder(); }
    @Override public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (closed) return;
        if (level >= TRIM_MEMORY_BACKGROUND || level >= TRIM_MEMORY_RUNNING_LOW && level < TRIM_MEMORY_UI_HIDDEN) releaseModels();
    }
    @Override public void onLowMemory() {
        super.onLowMemory();
        if (!closed) releaseModels();
    }
    private void releaseModels() {
        clients.trim();
        dictionaryWorker.execute(() -> lexicon = null);
    }
    @Override public void onDestroy() {
        closed = true;
        clients.close();
        for (Job job : jobs.values()) job.cancel();
        dictionaryWorker.execute(() -> lexicon = null); dictionaryWorker.shutdown();
        worker.shutdown(); super.onDestroy();
    }
}
