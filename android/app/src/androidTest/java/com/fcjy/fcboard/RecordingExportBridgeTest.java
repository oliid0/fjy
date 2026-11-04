package com.fcjy.fcboard;

import static org.junit.Assert.*;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import android.util.Base64;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Map;
import java.util.concurrent.ExecutorService;
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
    @Test public void independentPackagesSurviveInterleavedPreparationAndClose() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            JSObject begin = new JSObject().put("size", 2).put("mime", "audio/webm").put("transcript", "hello").put("summary", "summary");
            String first = invoke(scenario, "begin", begin, RecordingExportPlugin::begin).getString("id");
            String second = invoke(scenario, "begin", begin, RecordingExportPlugin::begin).getString("id");
            Uri saved = null;
            try {
                JSObject chunk = new JSObject().put("id", first).put("offset", 0).put("data", Base64.encodeToString(new byte[]{1, 2}, Base64.NO_WRAP));
                invoke(scenario, "append", chunk, RecordingExportPlugin::append);
                invoke(scenario, "complete", new JSObject().put("id", first), RecordingExportPlugin::complete);
                invoke(scenario, "close", new JSObject().put("id", first), RecordingExportPlugin::close);
                invoke(scenario, "append", new JSObject().put("id", second).put("offset", 0).put("data", Base64.encodeToString(new byte[]{3, 4}, Base64.NO_WRAP)), RecordingExportPlugin::append);
                invoke(scenario, "complete", new JSObject().put("id", second), RecordingExportPlugin::complete);
                JSObject output = invoke(scenario, "saveDownloads", new JSObject().put("id", second), RecordingExportPlugin::saveDownloads);
                saved = Uri.parse(output.getString("uri"));
                try (InputStream input = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getTargetContext().getContentResolver().openInputStream(saved); ZipInputStream zip = new ZipInputStream(input)) {
                    assertEquals("recording.webm", zip.getNextEntry().getName());
                    assertArrayEquals(new byte[]{3, 4}, zip.readAllBytes());
                }
            } finally {
                invoke(scenario, "close", new JSObject().put("id", first), RecordingExportPlugin::close);
                invoke(scenario, "close", new JSObject().put("id", second), RecordingExportPlugin::close);
                if (saved != null) androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getTargetContext().getContentResolver().delete(saved, null, null);
            }
        }
    }

    private RecordingExportPlugin exportPlugin(ActivityScenario<MainActivity> scenario) {
        AtomicReference<RecordingExportPlugin> plugin = new AtomicReference<>();
        scenario.onActivity(activity -> plugin.set((RecordingExportPlugin) activity.getBridge()
            .getPlugin("FcboardRecordingExport").getInstance()));
        return plugin.get();
    }

    private JSObject invoke(ActivityScenario<MainActivity> scenario, String method, JSObject args,
            BiConsumer<RecordingExportPlugin, PluginCall> invoke) throws Exception {
        return invoke(exportPlugin(scenario), method, args, invoke);
    }

    private JSObject invoke(RecordingExportPlugin plugin, String method, JSObject args,
            BiConsumer<RecordingExportPlugin, PluginCall> invoke) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<JSObject> result = new AtomicReference<>();
        AtomicReference<String> error = new AtomicReference<>();
        invoke.accept(plugin, new PluginCall(null, "FcboardRecordingExport", "test", method, args) {
            @Override public void resolve(JSObject data) { result.set(data); done.countDown(); }
            @Override public void resolve() { result.set(new JSObject()); done.countDown(); }
            @Override public void reject(String message, String code, Exception exception, JSObject data) {
                error.set(message); done.countDown();
            }
        });
        assertTrue("Native export must finish: " + method, done.await(15, TimeUnit.SECONDS));
        assertNull(error.get(), error.get());
        return result.get();
    }

    private String prepare(RecordingExportPlugin plugin, byte[] bytes) throws Exception {
        String id = invoke(plugin, "begin", new JSObject().put("size", bytes.length)
            .put("mime", "audio/webm").put("transcript", "hello").put("summary", "summary"), RecordingExportPlugin::begin).getString("id");
        invoke(plugin, "append", new JSObject().put("id", id).put("offset", 0)
            .put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)), RecordingExportPlugin::append);
        invoke(plugin, "complete", new JSObject().put("id", id), RecordingExportPlugin::complete);
        return id;
    }

    private File directory(String id) {
        return new File(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
            .getTargetContext().getCacheDir(), "recording-export-" + id);
    }

    /** Capture the system-picker boundary while running the real save/session logic. */
    private static final class PickerExportPlugin extends RecordingExportPlugin {
        final CountDownLatch opened = new CountDownLatch(1);
        volatile Intent intent;
        volatile PluginCall call;
        @Override public void startActivityForResult(PluginCall call, Intent intent, String callback) {
            this.call = call;
            this.intent = intent;
            opened.countDown();
        }
    }

    private void cancelPicker(PickerExportPlugin plugin) throws Exception {
        Method saved = RecordingExportPlugin.class.getDeclaredMethod("saved", PluginCall.class, ActivityResult.class);
        saved.setAccessible(true);
        saved.invoke(plugin, plugin.call, new ActivityResult(Activity.RESULT_CANCELED, null));
    }

    @Test public void downloadsAnotherPackageWhileAFilePickerIsPendingAndDefersClosingTheSavedPackage() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            PickerExportPlugin plugin = new PickerExportPlugin();
            scenario.onActivity(activity -> plugin.setBridge(activity.getBridge()));
            String first = prepare(plugin, new byte[]{1, 2});
            String second = prepare(plugin, new byte[]{3, 4});
            CountDownLatch saved = new CountDownLatch(1);
            AtomicReference<JSObject> saveResult = new AtomicReference<>();
            AtomicReference<String> saveError = new AtomicReference<>();
            Uri output = null;
            try {
                plugin.save(new PluginCall(null, "FcboardRecordingExport", "picker-test", "save", new JSObject().put("id", first)) {
                    @Override public void resolve(JSObject value) { saveResult.set(value); saved.countDown(); }
                    @Override public void reject(String message, String code, Exception exception, JSObject data) {
                        saveError.set(message); saved.countDown();
                    }
                });
                assertTrue(plugin.opened.await(5, TimeUnit.SECONDS));
                assertEquals(Intent.ACTION_CREATE_DOCUMENT, plugin.intent.getAction());
                assertEquals("application/zip", plugin.intent.getType());
                invoke(plugin, "close", new JSObject().put("id", first), RecordingExportPlugin::close);
                assertTrue("The pending picker must retain its source file", directory(first).isDirectory());
                JSObject result = invoke(plugin, "saveDownloads", new JSObject().put("id", second), RecordingExportPlugin::saveDownloads);
                output = Uri.parse(result.getString("uri"));
                try (InputStream input = plugin.getContext().getContentResolver().openInputStream(output); ZipInputStream zip = new ZipInputStream(input)) {
                    assertEquals("recording.webm", zip.getNextEntry().getName());
                    assertArrayEquals(new byte[]{3, 4}, zip.readAllBytes());
                }
                assertTrue(directory(first).isDirectory());
                cancelPicker(plugin);
                assertTrue(saved.await(5, TimeUnit.SECONDS));
                assertNull(saveError.get());
                assertFalse(saveResult.get().getBoolean("saved"));
                // The next worker operation follows the callback's finally cleanup.
                invoke(plugin, "close", new JSObject().put("id", second), RecordingExportPlugin::close);
                assertFalse(directory(first).exists());
            } finally {
                if (plugin.call != null && saved.getCount() != 0) {
                    cancelPicker(plugin);
                    assertTrue(saved.await(5, TimeUnit.SECONDS));
                }
                invoke(plugin, "close", new JSObject().put("id", first), RecordingExportPlugin::close);
                invoke(plugin, "close", new JSObject().put("id", second), RecordingExportPlugin::close);
                if (output != null) plugin.getContext().getContentResolver().delete(output, null, null);
                plugin.handleOnDestroy();
            }
        }
    }

    @SuppressWarnings("unchecked")
    private Runnable scheduleExpiry(RecordingExportPlugin plugin, String id) throws Exception {
        Field workerField = RecordingExportPlugin.class.getDeclaredField("worker");
        workerField.setAccessible(true);
        ExecutorService worker = (ExecutorService) workerField.get(plugin);
        Method schedule = RecordingExportPlugin.class.getDeclaredMethod("scheduleShareExpiry", String.class);
        schedule.setAccessible(true);
        Field expirations = RecordingExportPlugin.class.getDeclaredField("shareExpirations");
        expirations.setAccessible(true);
        return worker.submit(() -> {
            schedule.invoke(plugin, id);
            return ((Map<String, Runnable>) expirations.get(plugin)).get(id);
        }).get(5, TimeUnit.SECONDS);
    }

    @Test public void renewedShareIgnoresAnOldExpiryAlreadyQueuedAndOnlyTheCurrentExpiryClosesIt() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            RecordingExportPlugin plugin = exportPlugin(scenario);
            String first = prepare(plugin, new byte[]{1, 2});
            String second = prepare(plugin, new byte[]{3, 4});
            Uri output = null;
            try {
                // Trigger the actual scheduled callbacks without a ten-minute wait
                // or assuming that the test device has a LAN connection.
                Runnable old = scheduleExpiry(plugin, first);
                Runnable current = scheduleExpiry(plugin, first);
                Runnable other = scheduleExpiry(plugin, second);
                old.run();
                JSObject result = invoke(plugin, "saveDownloads", new JSObject().put("id", first), RecordingExportPlugin::saveDownloads);
                output = Uri.parse(result.getString("uri"));
                try (InputStream input = plugin.getContext().getContentResolver().openInputStream(output); ZipInputStream zip = new ZipInputStream(input)) {
                    assertEquals("recording.webm", zip.getNextEntry().getName());
                    assertArrayEquals(new byte[]{1, 2}, zip.readAllBytes());
                }
                current.run();
                invoke(plugin, "close", new JSObject(), RecordingExportPlugin::close);
                assertFalse(directory(first).exists());
                assertTrue("Closing one share must preserve the other package", directory(second).isDirectory());
                other.run();
                invoke(plugin, "close", new JSObject(), RecordingExportPlugin::close);
                assertFalse(directory(second).exists());
            } finally {
                invoke(plugin, "close", new JSObject().put("id", first), RecordingExportPlugin::close);
                invoke(plugin, "close", new JSObject().put("id", second), RecordingExportPlugin::close);
                if (output != null) plugin.getContext().getContentResolver().delete(output, null, null);
            }
        }
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
