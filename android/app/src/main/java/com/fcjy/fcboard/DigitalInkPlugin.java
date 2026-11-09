package com.fcjy.fcboard;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.common.model.RemoteModelManager;
import com.google.mlkit.vision.digitalink.*;
import org.json.JSONArray;
import java.util.Set;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Recognizes real pen trajectories locally, not a screenshot or language model. */
@CapacitorPlugin(name = "FcboardDigitalInk")
public class DigitalInkPlugin extends Plugin {
    private static final Executor DIRECT = Runnable::run;
    // Serialize short SDK submissions, never wait here for model checks or inference.
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor();
    private final java.util.concurrent.Semaphore inference = new java.util.concurrent.Semaphore(2);
    private final Set<Request> pending = ConcurrentHashMap.newKeySet();
    private volatile boolean closed;
    private DigitalInkPacks packs;
    private interface Action { void run() throws Exception; }
    private static final class Request {
        final PluginCall call;
        final String language;
        final boolean preparing;
        final AtomicBoolean settled = new AtomicBoolean();
        final long deadline = android.os.SystemClock.elapsedRealtime() + 45000;
        Request(PluginCall call, String language, boolean preparing) {
            this.call = call; this.language = language; this.preparing = preparing;
        }
    }
    private static class ModelRequiredException extends Exception {
        final String tag;
        ModelRequiredException(String tag) { super("Handwriting language pack required: " + tag); this.tag = tag; }
    }

    private synchronized DigitalInkPacks packs() {
        if (packs == null) packs = new DigitalInkPacks(getContext(), () -> notifyListeners("packsChanged", packs.snapshot()), this::retireLanguage);
        return packs;
    }
    void retireLanguage(String tag) {
        for (Request request : pending) {
            if (tag.equals(request.language)) fail(request, new ModelRequiredException(tag));
        }
    }
    private DigitalInkPacks.Result packResult(PluginCall call) {
        return new DigitalInkPacks.Result() {
            public void success(JSObject result) { call.resolve(result); }
            public void failure(Exception error) { call.reject("Handwriting language pack operation failed: " + error.getMessage(), error); }
        };
    }
    @PluginMethod public void listPacks(PluginCall call) { packs().list(packResult(call)); }
    @PluginMethod public void downloadPack(PluginCall call) { packs().operate(call.getString("tag", ""), false, packResult(call)); }
    @PluginMethod public void deletePack(PluginCall call) { packs().operate(call.getString("tag", ""), true, packResult(call)); }

    private void fail(Request request, Throwable error) {
        if (!request.settled.compareAndSet(false, true)) return;
        pending.remove(request);
        if (!request.preparing && error instanceof ModelRequiredException) {
            ModelRequiredException missing = (ModelRequiredException) error;
            request.call.reject(missing.getMessage(), "HANDWRITING_MODEL_REQUIRED", missing, new JSObject().put("tag", missing.tag));
        } else {
            request.call.reject((request.preparing ? "Offline handwriting models unavailable: " : "Offline handwriting recognition failed: ") + error.getMessage());
        }
    }
    private void succeed(Request request, JSObject value) {
        if (closed) { fail(request, new IllegalStateException("Handwriting recognition closed")); return; }
        if (!request.settled.compareAndSet(false, true)) return;
        pending.remove(request);
        if (value == null) request.call.resolve(); else request.call.resolve(value);
    }
    private void dispatch(Request request, Action action) {
        if (closed) { fail(request, new IllegalStateException("Handwriting recognition closed")); return; }
        if (request.settled.get()) return;
        if (android.os.SystemClock.elapsedRealtime() >= request.deadline) { fail(request, new java.util.concurrent.TimeoutException("Offline handwriting timed out")); return; }
        try {
            worker.execute(() -> {
                if (closed) { fail(request, new IllegalStateException("Handwriting recognition closed")); return; }
                if (request.settled.get()) return;
                try { action.run(); }
                catch (Exception | LinkageError error) { fail(request, error); }
            });
        } catch (RejectedExecutionException error) { fail(request, error); }
    }
    private Exception failure(Task<?> task) {
        if (task.isCanceled()) return new CancellationException("Handwriting task cancelled");
        return task.getException() != null ? task.getException() : new IllegalStateException("Handwriting task failed");
    }
    Task<Boolean> modelDownloaded(DigitalInkRecognitionModel model) {
        return RemoteModelManager.getInstance().isModelDownloaded(model);
    }
    DigitalInkRecognizer createRecognizer(DigitalInkRecognitionModel model) {
        return DigitalInkRecognition.getClient(DigitalInkRecognizerOptions.builder(model).build());
    }
    private Task<DigitalInkRecognitionModel> model(String language) throws Exception {
        if (!DigitalInkPacks.supported(language) && !language.equals("zxx-Zsym-x-shapes")) {
            throw new IllegalArgumentException("This offline handwriting language is not installed");
        }
        DigitalInkModels.install(getContext());
        DigitalInkRecognitionModelIdentifier identifier = DigitalInkRecognitionModelIdentifier.fromLanguageTag(language);
        if (identifier == null) throw new IllegalStateException("Unsupported handwriting model");
        DigitalInkRecognitionModel model = DigitalInkRecognitionModel.builder(identifier).build();
        return Tasks.withTimeout(modelDownloaded(model), 20, TimeUnit.SECONDS).continueWithTask(DIRECT, status -> {
            if (!status.isSuccessful()) throw failure(status);
            if (!Boolean.TRUE.equals(status.getResult())) throw new ModelRequiredException(language);
            return Tasks.forResult(model);
        });
    }

    @PluginMethod public void prepare(PluginCall call) {
        Request request = new Request(call, null, true);
        pending.add(request);
        dispatch(request, () -> Tasks.whenAll(model("zh-Hani-CN"), model("en-US"))
            .addOnCompleteListener(DIRECT, ready -> dispatch(request, () -> {
                if (!ready.isSuccessful()) throw failure(ready);
                succeed(request, null);
            })));
    }

    @PluginMethod public void recognize(PluginCall call) {
        if (pending.size() >= 16) { call.reject("Offline handwriting queue is full; try a smaller selection"); return; }
        Request request = new Request(call, call.getString("language", "zh-Hani-CN"), false);
        pending.add(request);
        dispatch(request, () -> {
            JSONArray strokes = call.getArray("strokes", new JSArray());
            if (strokes.length() < 1 || strokes.length() > 3000) throw new IllegalArgumentException("Invalid handwriting strokes");
            Ink.Builder ink = Ink.builder();
            int count = 0;
            for (int index = 0; index < strokes.length(); index++) {
                JSONArray points = strokes.getJSONArray(index);
                if (points.length() == 0) continue;
                Ink.Stroke.Builder stroke = Ink.Stroke.builder();
                for (int point = 0; point < points.length(); point++) {
                    if (++count > 120000) throw new IllegalArgumentException("Handwriting selection is too large");
                    JSONArray xy = points.getJSONArray(point);
                    double x = xy.getDouble(0), y = xy.getDouble(1);
                    if (!Double.isFinite(x) || !Double.isFinite(y) || Math.abs(x) > 1e7 || Math.abs(y) > 1e7) throw new IllegalArgumentException("Invalid handwriting point");
                    stroke.addPoint(Ink.Point.create((float)x, (float)y, (long)count));
                }
                ink.addStroke(stroke.build());
            }
            if (ink.isEmpty()) throw new IllegalArgumentException("No handwriting in selection");
            model(request.language).addOnCompleteListener(DIRECT, ready -> dispatch(request, new Action() {
                public void run() throws Exception {
                if (!ready.isSuccessful()) throw failure(ready);
                // Each request owns its client; do not assume concurrent use of one client.
                // Async ML Kit tasks outlive dispatch(). Bound real inference,
                // not only Java dispatch, so parallel pen regions cannot load
                // an unbounded number of native clients on small ARM boards.
                if (!inference.tryAcquire()) {
                    worker.schedule(() -> dispatch(request, this), 40, TimeUnit.MILLISECONDS);
                    return;
                }
                if (closed || request.settled.get()) { inference.release(); return; }
                DigitalInkRecognizer recognizer;
                try { recognizer = createRecognizer(ready.getResult()); }
                catch (Exception | LinkageError error) { inference.release(); throw error; }
                Task<RecognitionResult> actual;
                try { actual = recognizer.recognize(ink.build()); }
                catch (Exception | LinkageError error) { recognizer.close(); inference.release(); throw error; }
                // A timeout does not cancel the underlying Task. Keep its client alive
                // until actual completion, even after deletion, timeout or plugin unload.
                actual.addOnCompleteListener(DIRECT, ignored -> {
                    try { recognizer.close(); } finally { inference.release(); }
                });
                Tasks.withTimeout(actual, 25, TimeUnit.SECONDS).addOnCompleteListener(DIRECT, result -> dispatch(request, () -> {
                    if (!result.isSuccessful()) throw failure(result);
                    JSArray candidates = new JSArray();
                    for (RecognitionCandidate candidate : result.getResult().getCandidates()) candidates.put(candidate.getText());
                    succeed(request, new JSObject().put("candidates", candidates).put("engine", "mlkit-digital-ink-18.1.0"));
                }));
                }
            }));
        });
    }

    @Override protected void handleOnDestroy() {
        closed = true;
        if (packs != null) packs.close();
        for (Request request : pending) fail(request, new IllegalStateException("Handwriting recognition closed"));
        worker.shutdown();
    }
}
