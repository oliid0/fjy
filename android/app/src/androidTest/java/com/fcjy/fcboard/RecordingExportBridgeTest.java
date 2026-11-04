package com.fcjy.fcboard;

import static org.junit.Assert.*;
import android.net.Uri;
import android.util.Base64;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.InputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BiConsumer;
import java.util.zip.ZipInputStream;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Exercises Integer-valued JS bridge numbers and actual MediaStore persistence. */
@RunWith(AndroidJUnit4.class)
public class RecordingExportBridgeTest {
    private JSObject invoke(ActivityScenario<MainActivity> scenario, String method, JSObject args,
            BiConsumer<RecordingExportPlugin, PluginCall> invoke) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<JSObject> result = new AtomicReference<>();
        AtomicReference<String> error = new AtomicReference<>();
        scenario.onActivity(activity -> {
            RecordingExportPlugin plugin = (RecordingExportPlugin) activity.getBridge()
                .getPlugin("FcboardRecordingExport").getInstance();
            invoke.accept(plugin, new PluginCall(null, "FcboardRecordingExport", "test", method, args) {
                @Override public void resolve(JSObject data) { result.set(data); done.countDown(); }
                @Override public void resolve() { result.set(new JSObject()); done.countDown(); }
                @Override public void reject(String message, String code, Exception exception, JSObject data) {
                    error.set(message); done.countDown();
                }
            });
        });
        assertTrue("Native export must finish: " + method, done.await(15, TimeUnit.SECONDS));
        assertNull(error.get(), error.get());
        return result.get();
    }

    @Test public void integerSizeAndOffsetsExportEveryByteToDownloads() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            // Small numbers parsed from JS JSON are Integer, not Long.
            JSObject begin = new JSObject().put("size", 4).put("mime", "audio/webm;codecs=opus")
                .put("transcript", "[00:01] 牛顿第二定律").put("summary", "F=ma");
            String id = invoke(scenario, "begin", begin, RecordingExportPlugin::begin).getString("id");
            Uri saved = null;
            try {
                for (int offset = 0; offset < 4; offset += 2) {
                    JSObject chunk = new JSObject().put("id", id).put("offset", offset)
                        .put("data", Base64.encodeToString(new byte[]{(byte)(offset + 1), (byte)(offset + 2)}, Base64.NO_WRAP));
                    invoke(scenario, "append", chunk, RecordingExportPlugin::append);
                }
                invoke(scenario, "complete", new JSObject().put("id", id), RecordingExportPlugin::complete);
                JSObject output = invoke(scenario, "saveDownloads", new JSObject().put("id", id), RecordingExportPlugin::saveDownloads);
                assertTrue(output.getBoolean("saved"));
                saved = Uri.parse(output.getString("uri"));
                try (InputStream input = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
                        .getTargetContext().getContentResolver().openInputStream(saved);
                     ZipInputStream zip = new ZipInputStream(input)) {
                    assertEquals("recording.webm", zip.getNextEntry().getName());
                    assertArrayEquals(new byte[]{1, 2, 3, 4}, zip.readAllBytes());
                    assertEquals("transcript.txt", zip.getNextEntry().getName());
                    assertEquals("[00:01] 牛顿第二定律", new String(zip.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
                    assertEquals("summary.md", zip.getNextEntry().getName());
                    assertEquals("F=ma", new String(zip.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
                }
            } finally {
                if (saved != null) androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
                    .getTargetContext().getContentResolver().delete(saved, null, null);
                invoke(scenario, "close", new JSObject().put("id", id), RecordingExportPlugin::close);
            }
        }
    }
}
