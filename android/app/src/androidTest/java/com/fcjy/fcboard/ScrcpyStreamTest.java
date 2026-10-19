package com.fcjy.fcboard;

import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.core.app.ActivityScenario;
import android.content.Context;
import android.view.accessibility.AccessibilityNodeInfo;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Runs the actual bundled Scrcpy server over the emulator's ADB TCP transport. */
@RunWith(AndroidJUnit4.class)
public class ScrcpyStreamTest {
    @Test public void capturesTheWholeDeviceAndAcceptsSystemNavigation() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        ScrcpyBridge bridge = new ScrcpyBridge(context, "127.0.0.1");
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            CountDownLatch connected = new CountDownLatch(1);
            AtomicReference<Exception> connectError = new AtomicReference<>();
            new Thread(() -> { try { bridge.connect(0, "", 5555); } catch (Exception error) { connectError.set(error); } finally { connected.countDown(); } }).start();
            // An authenticated emulator may ask once to allow this app's new ADB identity.
            for (int attempt = 0; attempt < 40 && connected.getCount() > 0; attempt++) {
                AccessibilityNodeInfo root = InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
                if (root != null) for (AccessibilityNodeInfo node : root.findAccessibilityNodeInfosByText("Allow")) {
                    if (node.isClickable()) node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                }
                Thread.sleep(250);
            }
            assertTrue("ADB connection must finish", connected.await(20, TimeUnit.SECONDS));
            assertNull(connectError.get());
            String additionalOutput = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir");
            File directory = additionalOutput == null ? context.getExternalFilesDir(null) : new File(additionalOutput);
            assertNotNull(directory);
            assertTrue(directory.isDirectory() || directory.mkdirs());
            File target = new File(directory, "scrcpy-stream.bin");
            CountDownLatch frames = new CountDownLatch(12);
            CountDownLatch ready = new CountDownLatch(1);
            AtomicReference<String> error = new AtomicReference<>();
            AtomicReference<int[]> size = new AtomicReference<>();
            try (FileOutputStream output = new FileOutputStream(target)) {
                bridge.stream((channel, data) -> {
                    if (size.get() == null) {
                        assertEquals(0x68323634, ByteBuffer.wrap(data).getInt());
                        size.set(new int[]{ByteBuffer.wrap(data, 4, 4).getInt(), ByteBuffer.wrap(data, 8, 4).getInt()});
                        ready.countDown();
                    }
                    if (frames.getCount() > 0) { output.write(data); frames.countDown(); }
                }, value -> { error.set(value); ready.countDown(); while (frames.getCount() > 0) frames.countDown(); });
                assertTrue("Scrcpy video metadata must arrive", ready.await(20, TimeUnit.SECONDS));
                assertNull(error.get());
                assertNotNull(size.get());
                // The same 14-byte message used by the official client, Down + Up Home.
                for (int action : new int[]{0, 1}) bridge.control(ByteBuffer.allocate(14).put((byte)0).put((byte)action).putInt(3).putInt(0).putInt(0).array());
                Thread.sleep(500);
                AccessibilityNodeInfo foreground = InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
                assertNotNull(foreground);
                assertNotEquals("Scrcpy Home must navigate outside the whiteboard", "com.fcjy.fcboard", String.valueOf(foreground.getPackageName()));
                assertTrue("Actual encoded screen frames must arrive", frames.await(25, TimeUnit.SECONDS));
                assertNull(error.get());
                assertNotNull(size.get()); assertTrue(size.get()[0] > 0 && size.get()[0] <= 1280); assertTrue(size.get()[1] > 0 && size.get()[1] <= 1280);
                bridge.stopStream();
            }
            assertTrue(target.length() > 2000);
        } finally { bridge.dispose(); }
    }
}
