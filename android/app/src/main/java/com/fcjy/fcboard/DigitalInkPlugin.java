package com.fcjy.fcboard;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.common.model.RemoteModelManager;
import com.google.mlkit.vision.digitalink.*;
import org.json.JSONArray;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/** Recognizes real pen trajectories locally, not a screenshot or language model. */
@CapacitorPlugin(name = "FcboardDigitalInk")
public class DigitalInkPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Map<String, DigitalInkRecognizer> recognizers = new HashMap<>();
    private DigitalInkPacks packs;
    private static class ModelRequiredException extends Exception {
        final String tag;
        ModelRequiredException(String tag) { super("Handwriting language pack required: " + tag); this.tag = tag; }
    }

    private synchronized DigitalInkPacks packs() {
        if (packs == null) packs = new DigitalInkPacks(getContext(), () -> notifyListeners("packsChanged", packs.snapshot()),
            tag -> worker.execute(() -> { DigitalInkRecognizer recognizer = recognizers.remove(tag); if (recognizer != null) recognizer.close(); }));
        return packs;
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

    private DigitalInkRecognizer recognizer(String language) throws Exception {
        if (!DigitalInkPacks.supported(language) && !language.equals("zxx-Zsym-x-shapes")) {
            throw new IllegalArgumentException("This offline handwriting language is not installed");
        }
        DigitalInkModels.install(getContext());
        if (!recognizers.containsKey(language)) {
            DigitalInkRecognitionModelIdentifier identifier = DigitalInkRecognitionModelIdentifier.fromLanguageTag(language);
            if (identifier == null) { throw new IllegalStateException("Unsupported handwriting model"); }
            DigitalInkRecognitionModel model = DigitalInkRecognitionModel.builder(identifier).build();
            if (!Tasks.await(RemoteModelManager.getInstance().isModelDownloaded(model), 20, TimeUnit.SECONDS)) {
                throw new ModelRequiredException(language);
            }
            recognizers.put(language, DigitalInkRecognition.getClient(DigitalInkRecognizerOptions.builder(model).build()));
        }
        return recognizers.get(language);
    }

    @PluginMethod public void prepare(PluginCall call) {
        worker.execute(() -> {
            try { recognizer("zh-Hani-CN"); recognizer("en-US"); call.resolve(); }
            catch (Exception | LinkageError error) { call.reject("Offline handwriting models unavailable: " + error.getMessage()); }
        });
    }

    @PluginMethod public void recognize(PluginCall call) {
        worker.execute(() -> {
            try {
                JSONArray strokes = call.getArray("strokes", new JSArray());
                if (strokes.length() < 1 || strokes.length() > 3000) { throw new IllegalArgumentException("Invalid handwriting strokes"); }
                Ink.Builder ink = Ink.builder();
                int count = 0;
                for (int index = 0; index < strokes.length(); index++) {
                    JSONArray points = strokes.getJSONArray(index);
                    if (points.length() == 0) { continue; }
                    Ink.Stroke.Builder stroke = Ink.Stroke.builder();
                    for (int point = 0; point < points.length(); point++) {
                        if (++count > 120000) { throw new IllegalArgumentException("Handwriting selection is too large"); }
                        JSONArray xy = points.getJSONArray(point);
                        double x = xy.getDouble(0), y = xy.getDouble(1);
                        if (!Double.isFinite(x) || !Double.isFinite(y) || Math.abs(x) > 1e7 || Math.abs(y) > 1e7) {
                            throw new IllegalArgumentException("Invalid handwriting point");
                        }
                        // HSlide.createSmaText supplies increasing 1 ms samples.
                        // Use the same relative ordering without sleeping on the worker.
                        stroke.addPoint(Ink.Point.create((float)x, (float)y, (long)count));
                    }
                    ink.addStroke(stroke.build());
                }
                if (ink.isEmpty()) { throw new IllegalArgumentException("No handwriting in selection"); }
                DigitalInkRecognizer recognizer = recognizer(call.getString("language", "zh-Hani-CN"));
                RecognitionResult result = Tasks.await(recognizer.recognize(ink.build()), 25, TimeUnit.SECONDS);
                JSArray candidates = new JSArray();
                for (RecognitionCandidate candidate : result.getCandidates()) { candidates.put(candidate.getText()); }
                JSObject output = new JSObject(); output.put("candidates", candidates);
                output.put("engine", "mlkit-digital-ink-18.1.0"); call.resolve(output);
            } catch (ModelRequiredException error) {
                JSObject data = new JSObject(); data.put("tag", error.tag);
                call.reject(error.getMessage(), "HANDWRITING_MODEL_REQUIRED", error, data);
            } catch (Exception | LinkageError error) { call.reject("Offline handwriting recognition failed: " + error.getMessage()); }
        });
    }

    @Override protected void handleOnDestroy() {
        if (packs != null) packs.close();
        worker.execute(() -> { for (DigitalInkRecognizer recognizer : recognizers.values()) { recognizer.close(); } recognizers.clear(); });
        worker.shutdown();
    }
}
