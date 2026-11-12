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
    static final int INFER = 1, CANCEL = 2;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService dictionaryWorker = Executors.newSingleThreadExecutor();
    private NativeLexicon lexicon;
    private final Map<String, Job> jobs = new ConcurrentHashMap<>();
    private NativePenModels models;
    private volatile boolean closed;
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
        if (message.what == CANCEL) {
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
        try {
            job.check();
            if (models == null) models = new NativePenModels(this);
            result = models.infer(job);
            job.check();
        } catch (Exception | LinkageError error) {
            result.putString("error", "Local model inference failed: " + error.getMessage());
        } finally { jobs.remove(id, job); }
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
        if (level >= TRIM_MEMORY_RUNNING_LOW) {
            worker.execute(() -> { if (models != null) { models.close(); models = null; } });
            dictionaryWorker.execute(() -> lexicon = null);
        }
    }
    @Override public void onDestroy() {
        closed = true;
        for (Job job : jobs.values()) job.cancel();
        worker.execute(() -> { if (models != null) models.close(); models = null; });
        dictionaryWorker.execute(() -> lexicon = null); dictionaryWorker.shutdown();
        worker.shutdown(); super.onDestroy();
    }
}
