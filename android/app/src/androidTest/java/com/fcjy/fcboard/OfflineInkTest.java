package com.fcjy.fcboard;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.common.model.RemoteModelManager;
import com.google.mlkit.vision.digitalink.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.TimeUnit;
import java.text.Normalizer;
import java.util.stream.Collectors;
import org.json.JSONArray;
import static org.junit.Assert.*;

/** Runs the real bundled SDK/models, without download(), OCR or a network service. */
@RunWith(AndroidJUnit4.class)
public class OfflineInkTest {
    @Test public void languagePackCatalogReportsRealBundledModelsAndRejectsDeletingThem() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        java.util.concurrent.CountDownLatch listed = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.atomic.AtomicReference<com.getcapacitor.JSObject> snapshot = new java.util.concurrent.atomic.AtomicReference<>();
        java.util.concurrent.atomic.AtomicReference<Exception> failure = new java.util.concurrent.atomic.AtomicReference<>();
        DigitalInkPacks packs = new DigitalInkPacks(context, () -> {}, tag -> fail("No pack should be deleted"));
        try {
            packs.list(new DigitalInkPacks.Result() {
                public void success(com.getcapacitor.JSObject value) { snapshot.set(value); listed.countDown(); }
                public void failure(Exception error) { failure.set(error); listed.countDown(); }
            });
            assertTrue(listed.await(60, TimeUnit.SECONDS));
            assertNull(failure.get());
            JSONArray values = snapshot.get().getJSONArray("packs");
            assertEquals(DigitalInkPacks.TAGS.length, values.length());
            for (int i = 0; i < values.length(); i++) {
                org.json.JSONObject pack = values.getJSONObject(i);
                assertTrue(DigitalInkPacks.supported(pack.getString("tag")));
                if (pack.getBoolean("bundled")) assertEquals(1, pack.getInt("state"));
            }
            for (String tag : new String[]{"zh-Hani-CN", "en-US", "not-a-model"}) {
                failure.set(null);
                packs.operate(tag, true, new DigitalInkPacks.Result() {
                    public void success(com.getcapacitor.JSObject value) { fail("Built-in model deletion succeeded"); }
                    public void failure(Exception error) { failure.set(error); }
                });
                assertNotNull(failure.get());
            }
        } finally { packs.close(); }
    }
    @Test public void bundledModelsRegisterForOurPackageAndRecognizeChineseAndLatinInk() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        DigitalInkModels.install(context);
        for (String tag : new String[]{"zh-Hani-CN", "en-US", "zxx-Zsym-x-shapes"}) {
            DigitalInkRecognitionModelIdentifier id = DigitalInkRecognitionModelIdentifier.fromLanguageTag(tag);
            assertNotNull(id);
            assertTrue("Offline model missing: " + tag, Tasks.await(RemoteModelManager.getInstance().isModelDownloaded(
                DigitalInkRecognitionModel.builder(id).build()), 30, TimeUnit.SECONDS));
        }
        Ink.Stroke.Builder horizontal = Ink.Stroke.builder(), vertical = Ink.Stroke.builder();
        for (int i = 0; i <= 20; i++) {
            horizontal.addPoint(Ink.Point.create(20 + i * 4, 60));
            vertical.addPoint(Ink.Point.create(60, 20 + i * 4));
        }
        Ink chinese = Ink.builder().addStroke(horizontal.build()).addStroke(vertical.build()).build();
        assertRecognition("zh-Hani-CN", chinese, "十");
        Ink one = Ink.builder().addStroke(vertical.build()).build();
        assertRecognition("en-US", one, "1");
    }

    private void assertRecognition(String tag, Ink ink, String expected) throws Exception {
        DigitalInkRecognitionModel model = DigitalInkRecognitionModel.builder(
            DigitalInkRecognitionModelIdentifier.fromLanguageTag(tag)).build();
        try (DigitalInkRecognizer recognizer = DigitalInkRecognition.getClient(DigitalInkRecognizerOptions.builder(model).build())) {
            RecognitionResult result = Tasks.await(recognizer.recognize(ink), 30, TimeUnit.SECONDS);
            assertFalse("Empty native recognition", result.getCandidates().isEmpty());
            assertTrue("Expected candidate " + expected + ": " + result.getCandidates(), result.getCandidates().stream().anyMatch(candidate -> candidate.getText().trim().equals(expected)));
        }
    }

    /** Canonical stroke fixtures check the default candidate, not a convenient alternative. */
    @Test public void chineseCharacterUsesTheFirstCandidate() throws Exception {
        Ink ink = Ink.builder()
            .addStroke(line(20, 60, 100, 60))
            .addStroke(line(60, 20, 60, 100))
            .build();
        assertTopRecognition("zh-Hani-CN", ink, "十");
    }

    @Test public void arithmeticKeepsDigitsAndOperatorsInTheFirstCandidate() throws Exception {
        Ink ink = Ink.builder()
            .addStroke(line(20, 20, 20, 100))
            .addStroke(line(65, 60, 105, 60))
            .addStroke(line(85, 40, 85, 80))
            .addStroke(line(145, 20, 145, 100))
            .addStroke(line(185, 50, 225, 50))
            .addStroke(line(185, 70, 225, 70))
            .build();
        assertTopRecognition("en-US", ink, "1+1=");
    }

    @Test public void englishWordUsesTheFirstCandidate() throws Exception {
        Ink.Stroke.Builder dot = Ink.Stroke.builder();
        dot.addPoint(Ink.Point.create(90, 35));
        Ink ink = Ink.builder()
            .addStroke(line(20, 20, 20, 100))
            .addStroke(line(60, 20, 60, 100))
            .addStroke(line(20, 60, 60, 60))
            .addStroke(line(90, 50, 90, 100))
            .addStroke(dot.build())
            .build();
        assertTopRecognition("en-US", ink, "Hi");
    }

    private Ink.Stroke line(float x1, float y1, float x2, float y2) {
        Ink.Stroke.Builder stroke = Ink.Stroke.builder();
        for (int index = 0; index <= 20; index++) {
            float fraction = index / 20f;
            stroke.addPoint(Ink.Point.create(x1 + (x2 - x1) * fraction, y1 + (y2 - y1) * fraction));
        }
        return stroke.build();
    }

    private void assertTopRecognition(String tag, Ink ink, String expected) throws Exception {
        DigitalInkModels.install(InstrumentationRegistry.getInstrumentation().getTargetContext());
        DigitalInkRecognitionModel model = DigitalInkRecognitionModel.builder(
            DigitalInkRecognitionModelIdentifier.fromLanguageTag(tag)).build();
        try (DigitalInkRecognizer recognizer = DigitalInkRecognition.getClient(DigitalInkRecognizerOptions.builder(model).build())) {
            RecognitionResult result = Tasks.await(recognizer.recognize(ink), 30, TimeUnit.SECONDS);
            assertFalse("Empty native recognition", result.getCandidates().isEmpty());
            String candidates = result.getCandidates().stream().map(RecognitionCandidate::getText).collect(Collectors.joining(" | "));
            String first = Normalizer.normalize(result.getCandidates().get(0).getText(), Normalizer.Form.NFKC).replaceAll("\\s+", "");
            assertEquals("First candidate must preserve the fixture, candidates: " + candidates, expected, first);
        }
    }
}
