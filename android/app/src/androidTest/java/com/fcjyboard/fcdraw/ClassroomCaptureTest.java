package com.fcjyboard.fcdraw;

import static org.junit.Assert.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Validates the actual WebView/PixelCopy bridge used for document recording and AI vision. */
@RunWith(AndroidJUnit4.class)
public class ClassroomCaptureTest {
    @Test public void capturesVisibleAppPixelsWithoutAnExternalScreenService() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            boolean ready = false;
            for (int attempt = 0; attempt < 60 && !ready; attempt++) {
                CountDownLatch checked = new CountDownLatch(1);
                AtomicReference<String> result = new AtomicReference<>("false");
                scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript("!!document.querySelector('.fc-unified-toolbar')", value -> { result.set(value); checked.countDown(); }));
                assertTrue(checked.await(5, TimeUnit.SECONDS));
                ready = "true".equals(result.get());
                if (!ready) Thread.sleep(500);
            }
            assertTrue("Production whiteboard must load", ready);
            CountDownLatch captured = new CountDownLatch(1);
            AtomicReference<String> image = new AtomicReference<>();
            AtomicReference<String> error = new AtomicReference<>();
            scenario.onActivity(activity -> {
                ClassroomPlugin plugin = (ClassroomPlugin) activity.getBridge().getPlugin("FcdrawClassroom").getInstance();
                PluginCall call = new PluginCall(null, "FcdrawClassroom", "test", "captureFrame", new JSObject()) {
                    @Override public void resolve(JSObject data) { image.set(data.getString("image")); captured.countDown(); }
                    @Override public void reject(String message, String code, Exception exception, JSObject data) { error.set(message); captured.countDown(); }
                };
                plugin.captureFrame(call);
            });
            assertTrue(captured.await(15, TimeUnit.SECONDS));
            assertNull(error.get());
            assertNotNull(image.get());
            byte[] bytes = Base64.decode(image.get().substring(image.get().indexOf(',') + 1), Base64.DEFAULT);
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            assertNotNull(bitmap);
            assertTrue(bitmap.getWidth() > 100 && bitmap.getWidth() <= 1280);
            assertTrue(bitmap.getHeight() > 100);
            bitmap.recycle();
        }
    }
}
