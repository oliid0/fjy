package com.fcjy.fcboard;

import android.content.Context;
import android.os.SystemClock;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.common.model.DownloadConditions;
import com.google.mlkit.common.MlKitException;
import com.google.mlkit.common.model.RemoteModelManager;
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModel;
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModelIdentifier;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/** ModelManager.APP_LANGUAGE_TAGS, state IDs and serial model-operation queue.
 * Downloads never occupy the handwriting-recognition worker or the UI thread. */
final class DigitalInkPacks {
    static final String[] TAGS = {"zh-Hani-CN", "en-US", "ar", "bn-BD", "cs-CZ", "da-DK", "de-DE", "el-GR", "es-ES", "fa-IR", "fi-FI", "fr-FR", "gu-IN", "he-IL", "hi-IN", "hr-HR", "hu-HU", "id-ID", "it-IT", "ja-JP", "kk-KZ", "kn-IN", "ko-KR", "ky-KG", "mn-MN", "mr-IN", "ne-NP", "nl-NL", "pl-PL", "pt-PT", "ro-RO", "ru-RU", "sk-SK", "sv-SE", "ta-IN", "th-TH", "tr-TR", "uk-UA", "vi-VN"};
    interface Result { void success(JSObject snapshot); void failure(Exception error); }
    private final Context context;
    private final Runnable changed;
    private final Consumer<String> deleted;
    private final ExecutorService operations = Executors.newSingleThreadExecutor();
    private final Map<String, Integer> states = new LinkedHashMap<>();
    private volatile boolean initialized, closed;
    private volatile long refreshed;
    private boolean refreshing;
    private long revision;

    DigitalInkPacks(Context context, Runnable changed, Consumer<String> deleted) {
        this.context = context.getApplicationContext(); this.changed = changed; this.deleted = deleted;
        for (String tag : TAGS) states.put(tag, 0);
    }
    static boolean bundled(String tag) { return "zh-Hani-CN".equals(tag) || "en-US".equals(tag); }
    static boolean supported(String tag) { return Arrays.asList(TAGS).contains(tag); }
    static DigitalInkRecognitionModel model(String tag) throws MlKitException {
        if (!supported(tag)) throw new IllegalArgumentException("Unsupported handwriting language pack");
        DigitalInkRecognitionModelIdentifier identifier = DigitalInkRecognitionModelIdentifier.fromLanguageTag(tag);
        if (identifier == null) throw new IllegalArgumentException("Unsupported handwriting language pack");
        return DigitalInkRecognitionModel.builder(identifier).build();
    }
    synchronized JSObject snapshot() {
        JSArray packs = new JSArray();
        for (String tag : TAGS) {
            JSObject pack = new JSObject(); pack.put("tag", tag); pack.put("bundled", bundled(tag));
            pack.put("state", states.get(tag)); packs.put(pack);
        }
        JSObject result = new JSObject(); result.put("packs", packs); result.put("revision", revision); return result;
    }
    private void emit() { if (!closed) changed.run(); }
    private void refresh() throws Exception {
        DigitalInkModels.install(context);
        Set<DigitalInkRecognitionModel> downloaded = Tasks.await(RemoteModelManager.getInstance()
            .getDownloadedModels(DigitalInkRecognitionModel.class), 30, TimeUnit.SECONDS);
        synchronized (this) {
            for (String tag : TAGS) {
                if (states.get(tag) == 8 || states.get(tag) == 3 || states.get(tag) == 5) continue;
                try { states.put(tag, downloaded.contains(model(tag)) ? (bundled(tag) ? 1 : 4) : (bundled(tag) ? 7 : 2)); }
                catch (IllegalArgumentException | MlKitException error) { states.put(tag, 6); }
            }
            initialized = true; refreshed = SystemClock.elapsedRealtime(); revision++;
        }
        emit();
    }
    void list(Result result) {
        if (closed) { result.failure(new IllegalStateException("Handwriting models closed")); return; }
        if (initialized) {
            result.success(snapshot());
            synchronized (this) {
                if (refreshing || SystemClock.elapsedRealtime() - refreshed < 30000) return;
                refreshing = true;
            }
            operations.execute(() -> {
                try { refresh(); } catch (Exception error) { /* Existing verified states remain usable. */ }
                finally { synchronized (this) { refreshing = false; } }
            });
            return;
        }
        operations.execute(() -> {
            try { if (!initialized) refresh(); result.success(snapshot()); }
            catch (Exception error) { result.failure(error); }
        });
    }
    void operate(String tag, boolean remove, Result result) {
        synchronized (this) {
            if (closed || !supported(tag) || (remove && bundled(tag))) {
                result.failure(new IllegalArgumentException("Built-in or unsupported handwriting pack cannot be changed")); return;
            }
            int state = states.get(tag);
            if (!remove && (state == 1 || state == 4)) { result.success(snapshot()); return; }
            if (state == 3 || state == 5 || state == 8) {
                result.failure(new IllegalStateException("Handwriting pack operation already queued")); return;
            }
            states.put(tag, remove ? 5 : 8);
            revision++;
        }
        emit();
        operations.execute(() -> {
            try {
                if (!initialized) refresh();
                DigitalInkRecognitionModel model = model(tag);
                if (remove) {
                    Tasks.await(RemoteModelManager.getInstance().deleteDownloadedModel(model), 60, TimeUnit.SECONDS);
                    deleted.accept(tag);
                    synchronized (this) { states.put(tag, 2); revision++; }
                } else {
                    synchronized (this) { states.put(tag, 3); revision++; } emit();
                    Tasks.await(RemoteModelManager.getInstance().download(model, new DownloadConditions.Builder().build()), 10, TimeUnit.MINUTES);
                    if (!Tasks.await(RemoteModelManager.getInstance().isModelDownloaded(model), 30, TimeUnit.SECONDS)) {
                        throw new IllegalStateException("Handwriting model download did not install the model");
                    }
                    synchronized (this) { states.put(tag, bundled(tag) ? 1 : 4); revision++; }
                }
                refreshed = SystemClock.elapsedRealtime(); emit(); result.success(snapshot());
            } catch (Exception error) {
                synchronized (this) { states.put(tag, 7); revision++; }
                emit(); result.failure(error);
            }
        });
    }
    void close() { closed = true; operations.shutdownNow(); }
}
