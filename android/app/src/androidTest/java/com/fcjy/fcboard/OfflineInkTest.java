package com.fcjy.fcboard;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.TaskCompletionSource;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.google.mlkit.common.model.RemoteModelManager;
import com.google.mlkit.vision.digitalink.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
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
        for (String tag : new String[]{"zh-Hani-CN", "en-US", "zxx-Zsym-x-shapes", "zxx-Zsye-x-emoji"}) {
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

    @Test public void bundledEmojiModelRecognizesASmilingFaceWithoutDownloading() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        DigitalInkModels.install(context);
        assertEquals(3, context.getSharedPreferences("fcboard-digital-ink", 0).getInt("version", 0));
        Ink.Stroke.Builder outline = Ink.Stroke.builder(), mouth = Ink.Stroke.builder();
        for (int i = 0; i <= 64; i++) {
            double angle = 2 * Math.PI * i / 64;
            outline.addPoint(Ink.Point.create((float)(100 + 80 * Math.cos(angle)), (float)(100 + 80 * Math.sin(angle))));
        }
        for (int i = 0; i <= 32; i++) {
            double angle = Math.PI * i / 32;
            mouth.addPoint(Ink.Point.create((float)(100 + 40 * Math.cos(angle)), (float)(110 + 40 * Math.sin(angle))));
        }
        Ink smile = Ink.builder().addStroke(outline.build())
            .addStroke(line(70, 75, 70, 85)).addStroke(line(130, 75, 130, 85))
            .addStroke(mouth.build()).build();
        DigitalInkRecognitionModel model = DigitalInkRecognitionModel.builder(
            DigitalInkRecognitionModelIdentifier.fromLanguageTag("zxx-Zsye-x-emoji")).build();
        try (DigitalInkRecognizer recognizer = DigitalInkRecognition.getClient(DigitalInkRecognizerOptions.builder(model).build())) {
            RecognitionResult result = Tasks.await(recognizer.recognize(smile), 30, TimeUnit.SECONDS);
            assertTrue("No face candidates: " + result.getCandidates(), result.getCandidates().stream().anyMatch(candidate -> {
                int point = candidate.getText().codePointAt(0);
                return (point >= 0x1f600 && point <= 0x1f64f) || point == 0x263a;
            }));
        }
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

    private static final class InkCall extends PluginCall {
        final CountDownLatch done = new CountDownLatch(1);
        final AtomicReference<JSObject> result = new AtomicReference<>();
        final AtomicReference<String> error = new AtomicReference<>();
        final AtomicReference<String> code = new AtomicReference<>();
        final AtomicReference<JSObject> errorData = new AtomicReference<>();
        final AtomicInteger completions = new AtomicInteger();
        InkCall(String method, JSObject options) { super(null, "FcboardDigitalInk", "ink-test", method, options); }
        @Override public void resolve(JSObject value) { result.set(value); completions.incrementAndGet(); done.countDown(); }
        @Override public void resolve() { resolve(new JSObject()); }
        @Override public void reject(String message, String code, Exception exception, JSObject data) {
            error.set(message); this.code.set(code); errorData.set(data); completions.incrementAndGet(); done.countDown();
        }
    }

    /** Real SDK clients and native inference remain in use; only one Task is held
     * to reproduce a slow model check or recognition without blocking a thread. */
    private static final class ControlledInkPlugin extends DigitalInkPlugin {
        final boolean holdModel, holdRecognition;
        final TaskCompletionSource<Boolean> firstModel = new TaskCompletionSource<>();
        final TaskCompletionSource<RecognitionResult> firstRecognition = new TaskCompletionSource<>();
        final AtomicInteger checks = new AtomicInteger(), clients = new AtomicInteger(), closes = new AtomicInteger();
        final CountDownLatch recognitionStarted = new CountDownLatch(1);
        final CountDownLatch firstClosed = new CountDownLatch(1);
        ControlledInkPlugin(boolean holdModel, boolean holdRecognition) {
            this.holdModel = holdModel; this.holdRecognition = holdRecognition;
        }
        @Override Task<Boolean> modelDownloaded(DigitalInkRecognitionModel model) {
            if (checks.incrementAndGet() == 1 && holdModel) return firstModel.getTask();
            return super.modelDownloaded(model);
        }
        @Override DigitalInkRecognizer createRecognizer(DigitalInkRecognitionModel model) {
            DigitalInkRecognizer actual = super.createRecognizer(model);
            boolean first = clients.incrementAndGet() == 1;
            return new DigitalInkRecognizer() {
                @Override public Task<RecognitionResult> recognize(Ink ink) {
                    if (first && holdRecognition) { recognitionStarted.countDown(); return firstRecognition.getTask(); }
                    return actual.recognize(ink);
                }
                @Override public Task<RecognitionResult> recognize(Ink ink, RecognitionContext context) { return actual.recognize(ink, context); }
                @Override public void close() {
                    actual.close(); closes.incrementAndGet();
                    if (first) firstClosed.countDown();
                }
            };
        }
    }

    private JSObject chineseSelection() {
        JSArray strokes = new JSArray();
        for (int direction = 0; direction < 2; direction++) {
            JSArray points = new JSArray();
            for (int i = 0; i <= 20; i++) {
                points.put(new JSArray().put(direction == 0 ? 20 + i * 4 : 60).put(direction == 0 ? 60 : 20 + i * 4));
            }
            strokes.put(points);
        }
        return new JSObject().put("language", "zh-Hani-CN").put("strokes", strokes);
    }

    private void assertChineseResult(InkCall call) throws Exception {
        assertTrue("Independent native recognition must finish without waiting for an earlier Task", call.done.await(15, TimeUnit.SECONDS));
        assertNull(call.error.get(), call.error.get());
        assertEquals("mlkit-digital-ink-18.1.0", call.result.get().getString("engine"));
        assertEquals("十", call.result.get().getJSONArray("candidates").getString(0).trim());
        assertEquals(1, call.completions.get());
    }

    @Test public void pendingModelCheckDoesNotBlockLaterRecognitionAndRetainsTheMissingPackCode() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ControlledInkPlugin plugin = new ControlledInkPlugin(true, false);
            scenario.onActivity(activity -> plugin.setBridge(activity.getBridge()));
            InkCall first = new InkCall("recognize", chineseSelection());
            InkCall second = new InkCall("recognize", chineseSelection());
            try {
                plugin.recognize(first);
                plugin.recognize(second);
                assertChineseResult(second);
                assertEquals(1, first.done.getCount());
                plugin.firstModel.setResult(false);
                assertTrue(first.done.await(5, TimeUnit.SECONDS));
                assertEquals("HANDWRITING_MODEL_REQUIRED", first.code.get());
                assertEquals("zh-Hani-CN", first.errorData.get().getString("tag"));
                assertEquals(1, first.completions.get());
            } finally {
                plugin.firstModel.trySetResult(false);
                plugin.handleOnDestroy();
            }
        }
    }

    @Test public void aRecognitionTimeoutAffectsOnlyItsOwnCallAndClosesItsClientAfterActualCompletion() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ControlledInkPlugin plugin = new ControlledInkPlugin(false, true);
            scenario.onActivity(activity -> plugin.setBridge(activity.getBridge()));
            InkCall first = new InkCall("recognize", chineseSelection());
            InkCall second = new InkCall("recognize", chineseSelection());
            try {
                plugin.recognize(first);
                assertTrue(plugin.recognitionStarted.await(15, TimeUnit.SECONDS));
                plugin.recognize(second);
                assertChineseResult(second);
                assertEquals(1, first.done.getCount());
                assertTrue("The first call must retain its own bounded timeout", first.done.await(30, TimeUnit.SECONDS));
                assertNotNull(first.error.get());
                assertEquals(1, first.completions.get());
                assertEquals("Do not close a client whose underlying Task is still running", 1, plugin.firstClosed.getCount());
                plugin.firstRecognition.setException(new IllegalStateException("late SDK completion"));
                assertTrue(plugin.firstClosed.await(5, TimeUnit.SECONDS));
                assertEquals(2, plugin.closes.get());
                assertEquals(1, first.completions.get());
                assertEquals(1, second.completions.get());
            } finally {
                plugin.firstRecognition.trySetException(new IllegalStateException("test cleanup"));
                plugin.handleOnDestroy();
            }
        }
    }

    @Test public void deletedPackInvalidatesOnlyItsPendingResultAndLateCompletionCannotDeliverIt() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ControlledInkPlugin plugin = new ControlledInkPlugin(false, true);
            scenario.onActivity(activity -> plugin.setBridge(activity.getBridge()));
            InkCall first = new InkCall("recognize", chineseSelection());
            try {
                plugin.recognize(first);
                assertTrue(plugin.recognitionStarted.await(15, TimeUnit.SECONDS));
                // Exercise the actual successful-pack-deletion callback without
                // deleting the bundled language assets that other tests require.
                plugin.retireLanguage("zh-Hani-CN");
                assertTrue(first.done.await(5, TimeUnit.SECONDS));
                assertEquals("HANDWRITING_MODEL_REQUIRED", first.code.get());
                assertEquals(1, plugin.firstClosed.getCount());
                InkCall later = new InkCall("recognize", chineseSelection());
                plugin.recognize(later);
                assertChineseResult(later);
                plugin.firstRecognition.setException(new IllegalStateException("late SDK completion"));
                assertTrue(plugin.firstClosed.await(5, TimeUnit.SECONDS));
                assertEquals(1, first.completions.get());
                assertNull(first.result.get());
            } finally {
                plugin.firstRecognition.trySetException(new IllegalStateException("test cleanup"));
                plugin.handleOnDestroy();
            }
        }
    }

    @Test public void unloadingRejectsPendingCallsButStillReleasesTheirClientsOnActualCompletion() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ControlledInkPlugin plugin = new ControlledInkPlugin(false, true);
            scenario.onActivity(activity -> plugin.setBridge(activity.getBridge()));
            InkCall first = new InkCall("recognize", chineseSelection());
            try {
                plugin.recognize(first);
                assertTrue(plugin.recognitionStarted.await(15, TimeUnit.SECONDS));
                plugin.handleOnDestroy();
                assertTrue(first.done.await(5, TimeUnit.SECONDS));
                assertTrue(first.error.get().contains("closed"));
                plugin.firstRecognition.setException(new IllegalStateException("late SDK completion"));
                assertTrue(plugin.firstClosed.await(5, TimeUnit.SECONDS));
                assertEquals(1, first.completions.get());
                assertEquals(1, plugin.closes.get());
                InkCall late = new InkCall("recognize", chineseSelection());
                plugin.recognize(late);
                assertTrue(late.done.await(5, TimeUnit.SECONDS));
                assertTrue(late.error.get().contains("closed"));
                assertEquals(1, plugin.clients.get());
            } finally {
                plugin.firstRecognition.trySetException(new IllegalStateException("test cleanup"));
                plugin.handleOnDestroy();
            }
        }
    }

    @Test public void completedInkClientsAreReusedAndDeletedLanguagesRetireTheCache() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ControlledInkPlugin plugin = new ControlledInkPlugin(false, false);
            scenario.onActivity(activity -> plugin.setBridge(activity.getBridge()));
            try {
                for (int index = 0; index < 2; index++) {
                    InkCall call = new InkCall("recognize", chineseSelection().put("reuse", true));
                    plugin.recognize(call);
                    assertChineseResult(call);
                }
                assertEquals("Completed requests reuse the same native model", 1, plugin.clients.get());
                assertEquals("The warm client remains open while idle", 0, plugin.closes.get());
                plugin.retireLanguage("zh-Hani-CN");
                assertEquals(1, plugin.closes.get());
                InkCall later = new InkCall("recognize", chineseSelection().put("reuse", true));
                plugin.recognize(later);
                assertChineseResult(later);
                assertEquals(2, plugin.clients.get());
            } finally { plugin.handleOnDestroy(); }
            assertEquals(2, plugin.closes.get());
        }
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
