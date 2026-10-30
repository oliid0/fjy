package com.fcjy.fcboard;

import static org.junit.Assert.*;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.SeekBar;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.JSObject;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class WebResourceDialogTest {
    private void pointer(View view, int action, float x, float y) {
        long now = SystemClock.uptimeMillis();
        MotionEvent event = MotionEvent.obtain(now, now, action, x, y, 0);
        view.dispatchTouchEvent(event); event.recycle();
    }
    @Test public void nativeBrowserMovesResizesAndCancelsWithoutReplacingItsLiveWebView() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebResourceDialog> dialog = new AtomicReference<>();
            scenario.onActivity(activity -> {
                WebResourceDialog browser = new WebResourceDialog(activity, "https://example.test/", "en");
                dialog.set(browser); browser.show();
                browser.web.loadDataWithBaseURL("https://example.test/", "<p>Live experiment</p><script>window.__fcKeepExperiment=17</script>", "text/html", "UTF-8", null);
            });
            boolean initialized = false;
            for (int attempt = 0; attempt < 30 && !initialized; attempt++) {
                CountDownLatch read = new CountDownLatch(1);
                AtomicReference<String> marker = new AtomicReference<>();
                scenario.onActivity(activity -> dialog.get().web.evaluateJavascript("window.__fcKeepExperiment", value -> { marker.set(value); read.countDown(); }));
                assertTrue(read.await(5, TimeUnit.SECONDS));
                initialized = "17".equals(marker.get());
                if (!initialized) Thread.sleep(100);
            }
            assertTrue(initialized);
            scenario.onActivity(activity -> {
                WebResourceDialog browser = dialog.get();
                android.view.WindowManager.LayoutParams before = new android.view.WindowManager.LayoutParams();
                before.copyFrom(browser.getWindow().getAttributes());
                pointer(browser.moveHandle, MotionEvent.ACTION_DOWN, 10, 10);
                pointer(browser.moveHandle, MotionEvent.ACTION_MOVE, 30, 25);
                pointer(browser.moveHandle, MotionEvent.ACTION_UP, 30, 25);
                assertTrue(browser.getWindow().getAttributes().x >= before.x);
                assertTrue(browser.getWindow().getAttributes().y >= before.y);
                pointer(browser.resizeHandle, MotionEvent.ACTION_DOWN, 10, 10);
                pointer(browser.resizeHandle, MotionEvent.ACTION_MOVE, 40, 35);
                pointer(browser.resizeHandle, MotionEvent.ACTION_UP, 40, 35);
                assertTrue(browser.getWindow().getAttributes().width >= before.width);
                assertTrue(browser.getWindow().getAttributes().height >= before.height);
                int width = browser.getWindow().getAttributes().width;
                pointer(browser.resizeHandle, MotionEvent.ACTION_DOWN, 10, 10);
                pointer(browser.resizeHandle, MotionEvent.ACTION_MOVE, 0, 0);
                pointer(browser.resizeHandle, MotionEvent.ACTION_CANCEL, 0, 0);
                assertEquals(width, browser.getWindow().getAttributes().width);
            });
            CountDownLatch checked = new CountDownLatch(1);
            AtomicReference<String> value = new AtomicReference<>();
            scenario.onActivity(activity -> dialog.get().web.evaluateJavascript("window.__fcKeepExperiment", result -> { value.set(result); checked.countDown(); }));
            assertTrue(checked.await(5, TimeUnit.SECONDS));
            assertEquals("17", value.get());
            scenario.onActivity(activity -> dialog.get().dismiss());
        }
    }
    private SeekBar findBar(View view) {
        if (view instanceof SeekBar) return (SeekBar)view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup)view;
            for (int i = 0; i < group.getChildCount(); i++) { SeekBar found = findBar(group.getChildAt(i)); if (found != null) return found; }
        }
        return null;
    }
    @Test public void nativeBrowserPansWideContentAndExtractsLongPressedText() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebResourceDialog> dialog = new AtomicReference<>();
            AtomicReference<JSObject> selection = new AtomicReference<>();
            CountDownLatch selected = new CountDownLatch(1);
            scenario.onActivity(activity -> {
                WebResourceDialog browser = new WebResourceDialog(activity,"https://example.test/", "en", result -> { selection.set(result); selected.countDown(); });
                dialog.set(browser); browser.show();
                browser.web.loadDataWithBaseURL("https://example.test/", "<meta name='viewport' content='width=device-width,initial-scale=1'><div id='wide' style='width:100%;height:100px;overflow-x:auto'><div style='width:2000px;height:80px'>Newton force and acceleration</div></div>", "text/html","UTF-8",null);
            });
            boolean ready = false;
            for (int attempt = 0; attempt < 30 && !ready; attempt++) {
                AtomicReference<Boolean> enabled = new AtomicReference<>(false);
                scenario.onActivity(activity -> { SeekBar bar = findBar(dialog.get().getWindow().getDecorView()); enabled.set(bar != null && bar.isEnabled()); });
                ready = enabled.get(); if (!ready) Thread.sleep(200);
            }
            assertTrue("The real horizontal scrollbar must discover the wide DOM container",ready);
            scenario.onActivity(activity -> {
                SeekBar bar = findBar(dialog.get().getWindow().getDecorView());
                long now = SystemClock.uptimeMillis();
                for (int action : new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_MOVE,MotionEvent.ACTION_UP}) {
                    MotionEvent event = MotionEvent.obtain(now,now+16,action,action == MotionEvent.ACTION_DOWN ? 12 : bar.getWidth()-12,bar.getHeight()/2f,0);
                    bar.dispatchTouchEvent(event);event.recycle();
                }
            });
            CountDownLatch scrolled = new CountDownLatch(1);
            AtomicReference<String> position = new AtomicReference<>();
            scenario.onActivity(activity -> dialog.get().web.evaluateJavascript("document.getElementById('wide').scrollLeft", value -> { position.set(value); scrolled.countDown(); }));
            assertTrue(scrolled.await(5,TimeUnit.SECONDS));
            assertTrue(Double.parseDouble(position.get()) > 100);
            scenario.onActivity(activity -> {
                WebResourceDialog browser = dialog.get();
                browser.web.evaluateJavascript("document.getElementById('wide').scrollLeft=0", ignored -> {
                    long now = SystemClock.uptimeMillis();
                    MotionEvent event = MotionEvent.obtain(now,now,MotionEvent.ACTION_DOWN,20*browser.web.getScale(),20*browser.web.getScale(),0);
                    browser.web.dispatchTouchEvent(event);event.recycle();browser.web.performLongClick();
                });
            });
            assertTrue("A native long-press must produce real webpage text",selected.await(5,TimeUnit.SECONDS));
            assertEquals("text",selection.get().getString("kind"));
            assertTrue(selection.get().getString("value").contains("Newton"));
            scenario.onActivity(activity -> dialog.get().dismiss());
        }
    }
}
