package com.fcjy.fcboard;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.common.model.DownloadConditions;
import com.google.mlkit.nl.languageid.LanguageIdentification;
import com.google.mlkit.nl.languageid.LanguageIdentifier;
import com.google.mlkit.nl.translate.TranslateLanguage;
import com.google.mlkit.nl.translate.Translation;
import com.google.mlkit.nl.translate.Translator;
import com.google.mlkit.nl.translate.TranslatorOptions;
import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Per-request native clients, outside the WebView heap. Downloads remain on disk. */
@CapacitorPlugin(name = "FcboardTranslation")
public class TranslationPlugin extends Plugin {
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor(task -> new Thread(() -> {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND);
        task.run();
    }, "fcboard-translation"));
    private final ArrayDeque<Request> waiting = new ArrayDeque<>();
    private final Set<Request> active = new HashSet<>();
    private final ModelPool<Translator> clients = new ModelPool<>(2, key -> false);
    @Override public void load() { clients.observe(getContext()); }
    @Override protected void handleOnStop() { clients.trim(); }
    private volatile boolean destroyed;

    private static final class Request {
        final PluginCall call;
        final String id, text, source, target;
        final AtomicBoolean settled = new AtomicBoolean();
        java.util.concurrent.ScheduledFuture<?> timeout;
        ModelPool.Lease<Translator> translator;
        LanguageIdentifier identifier;
        Request(PluginCall call) {
            this.call = call;
            id = call.getString("id", "");
            text = call.getString("text", "");
            source = call.getString("source", "auto");
            target = call.getString("target", "");
        }
        void fail(String message) {
            if (settled.compareAndSet(false, true)) {
                if (timeout != null) timeout.cancel(false);
                call.reject(message);
            }
        }
        void resolve(String source, String translation) {
            if (settled.compareAndSet(false, true)) {
                if (timeout != null) timeout.cancel(false);
                call.resolve(new JSObject().put("language", source).put("translation", translation));
            }
        }
    }
    private static String language(String tag) {
        String result = TranslateLanguage.fromLanguageTag(tag);
        if (result == null) throw new IllegalArgumentException("Local translation language unavailable: " + tag);
        return result;
    }
    @PluginMethod public void translate(PluginCall call) {
        Request request = new Request(call);
        if (!request.id.matches("[a-fA-F0-9-]{36}") || request.text.trim().isEmpty() || request.text.length() > 4000) {
            call.reject("Invalid translation request"); return;
        }
        if (destroyed) { call.reject("Local translation closed"); return; }
        submit(call, () -> {
            if (destroyed) { request.fail("Local translation closed"); return; }
            if (waiting.size() + active.size() >= 8) { request.fail("Local translation queue is full"); return; }
            waiting.add(request);
            // Download failures/timeouts are visible. A timeout never closes a client
            // still used by an SDK Task. The other request slot stays independent.
            request.timeout = worker.schedule(() -> {
                request.fail("Local translation timed out; check the downloaded language models and network");
                waiting.remove(request);
            }, 120, TimeUnit.SECONDS);
            pump();
        });
    }
    @PluginMethod public void cancel(PluginCall call) {
        if (destroyed) { call.resolve(); return; }
        String id = call.getString("id", "");
        submit(call, () -> {
            for (Request request : active) if (request.id.equals(id)) request.fail("Translation cancelled");
            waiting.removeIf(request -> {
                if (!request.id.equals(id)) return false;
                request.fail("Translation cancelled"); return true;
            });
            call.resolve();
        });
    }
    private void submit(PluginCall call, Runnable action) {
        try { worker.execute(action); }
        catch (java.util.concurrent.RejectedExecutionException error) { call.reject("Local translation closed"); }
    }
    private void pump() {
        if (active.size() >= 2 || destroyed) return;
        Request request = waiting.poll();
        if (request == null) return;
        if (request.settled.get()) { pump(); return; }
        active.add(request);
        try {
            final String target = language(request.target);
            Task<String> source;
            if (request.source.equals("auto")) {
                request.identifier = LanguageIdentification.getClient();
                source = request.identifier.identifyLanguage(request.text);
            } else source = Tasks.forResult(request.source);
            Task<JSObject> actual = source.continueWithTask(worker, detected -> {
                if (request.identifier != null) { request.identifier.close(); request.identifier = null; }
                if (!detected.isSuccessful()) throw taskError(detected);
                if (destroyed || request.settled.get()) throw new java.util.concurrent.CancellationException();
                String from = language(detected.getResult());
                if (from.equals(target)) return Tasks.forResult(new JSObject().put("language", from).put("translation", request.text));
                request.translator = clients.acquire(from + ":" + target, () -> Translation.getClient(new TranslatorOptions.Builder().setSourceLanguage(from).setTargetLanguage(target).build()));
                // Both API and models live in this application, not another APK.
                return request.translator.value().downloadModelIfNeeded(new DownloadConditions.Builder().build())
                    .continueWithTask(worker, ready -> {
                        if (!ready.isSuccessful()) throw taskError(ready);
                        if (destroyed || request.settled.get()) throw new java.util.concurrent.CancellationException();
                        return request.translator.value().translate(request.text);
                    }).continueWith(worker, translated -> {
                        if (!translated.isSuccessful()) throw taskError(translated);
                        String value = translated.getResult();
                        if (value == null || value.trim().isEmpty() || value.length() > 10000) throw new IllegalStateException("Empty or oversized translation");
                        return new JSObject().put("language", from).put("translation", value);
                    });
            });
            actual.addOnCompleteListener(worker, done -> {
                boolean reusable = done.isSuccessful() && !destroyed && !request.settled.get();
                if (request.translator != null) { request.translator.release(reusable); request.translator = null; }
                if (!destroyed && !request.settled.get()) {
                    if (done.isSuccessful()) request.resolve(done.getResult().getString("language"), done.getResult().getString("translation"));
                    else request.fail("Local translation failed: " + taskError(done).getMessage());
                }
                finish(request);
            });
        } catch (Exception | LinkageError error) {
            request.fail("Local translation failed: " + error.getMessage());
            finish(request);
        }
        pump();
    }
    private static Exception taskError(Task<?> task) {
        return task.getException() != null ? task.getException() : new java.util.concurrent.CancellationException();
    }
    private void finish(Request request) {
        try {
            if (request.translator != null) request.translator.release(false);
        } finally {
            request.translator = null;
            try {
                if (request.identifier != null) request.identifier.close();
            } finally {
                request.identifier = null;
                active.remove(request);
                if (destroyed) { if (active.isEmpty()) worker.shutdown(); }
                else pump();
            }
        }
    }
    @Override protected void handleOnDestroy() {
        destroyed = true;
        clients.close();
        worker.execute(() -> {
            for (Request request : waiting) request.fail("Local translation closed");
            waiting.clear();
            for (Request request : active) request.fail("Local translation closed");
            if (active.isEmpty()) worker.shutdown();
        });
    }
}
