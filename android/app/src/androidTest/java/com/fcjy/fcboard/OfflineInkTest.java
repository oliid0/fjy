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
import static org.junit.Assert.*;

/** Runs the real bundled SDK/models, without download(), OCR or a network service. */
@RunWith(AndroidJUnit4.class)
public class OfflineInkTest {
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
}
