package com.fcjy.fcboard;

import static org.junit.Assert.*;
import android.app.Instrumentation;
import android.content.IntentFilter;
import android.provider.Settings;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class DebugSettingsTest {
    @Test public void opensDeveloperWirelessEntryOrAboutDeviceAccordingToActualSystemState() throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        android.content.ContentResolver resolver = instrumentation.getTargetContext().getContentResolver();
        int original = Settings.Global.getInt(resolver, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0);
        instrumentation.getUiAutomation().adoptShellPermissionIdentity(android.Manifest.permission.WRITE_SECURE_SETTINGS);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            for (boolean enabled : new boolean[] {false, true}) {
                assertTrue(Settings.Global.putInt(resolver, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, enabled ? 1 : 0));
                String action = enabled ? Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS : Settings.ACTION_DEVICE_INFO_SETTINGS;
                Instrumentation.ActivityMonitor monitor = instrumentation.addMonitor(new IntentFilter(action), null, true);
                try {
                    CountDownLatch done = new CountDownLatch(1);
                    AtomicReference<JSObject> result = new AtomicReference<>();
                    AtomicReference<String> error = new AtomicReference<>();
                    scenario.onActivity(activity -> {
                        ClassroomPlugin plugin = (ClassroomPlugin) activity.getBridge().getPlugin("FcboardClassroom").getInstance();
                        plugin.openDebugSettings(new PluginCall(null, "FcboardClassroom", "test-settings", "openDebugSettings", new JSObject()) {
                            @Override public void resolve(JSObject value) { result.set(value); done.countDown(); }
                            @Override public void reject(String message, String code, Exception exception, JSObject data) { error.set(message); done.countDown(); }
                        });
                    });
                    assertTrue(done.await(5, TimeUnit.SECONDS)); assertNull(error.get());
                    assertNotNull(result.get()); assertEquals(enabled, result.get().getBoolean("enabled"));
                    assertEquals("The actual system settings Intent must be launched", 1, monitor.getHits());
                } finally { instrumentation.removeMonitor(monitor); }
            }
        } finally {
            Settings.Global.putInt(resolver, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, original);
            instrumentation.getUiAutomation().dropShellPermissionIdentity();
        }
    }
}
