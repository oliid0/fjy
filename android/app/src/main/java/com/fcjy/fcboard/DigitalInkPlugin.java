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

    private DigitalInkRecognizer recognizer(String language) throws Exception {
        if (!language.equals("zh-Hani-CN") && !language.equals("en-US") && !language.equals("zxx-Zsym-x-shapes")) {
            throw new IllegalArgumentException("This offline handwriting language is not installed");
        }
        DigitalInkModels.install(getContext());
        if (!recognizers.containsKey(language)) {
            DigitalInkRecognitionModelIdentifier identifier = DigitalInkRecognitionModelIdentifier.fromLanguageTag(language);
            if (identifier == null) { throw new IllegalStateException("Unsupported handwriting model"); }
            DigitalInkRecognitionModel model = DigitalInkRecognitionModel.builder(identifier).build();
            if (!Tasks.await(RemoteModelManager.getInstance().isModelDownloaded(model), 20, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Bundled handwriting model is not registered; check the APK model assets");
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
                        // Like HSlide.createSmaText, preserve stroke/sample order.
                        // The SDK supports points without synthetic timestamps.
                        stroke.addPoint(Ink.Point.create((float)x, (float)y));
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
            } catch (Exception | LinkageError error) { call.reject("Offline handwriting recognition failed: " + error.getMessage()); }
        });
    }

    @Override protected void handleOnDestroy() {
        worker.execute(() -> { for (DigitalInkRecognizer recognizer : recognizers.values()) { recognizer.close(); } recognizers.clear(); });
        worker.shutdown();
    }
}
