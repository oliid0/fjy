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
    @Test public void hiddenBrowserDisposesSynchronouslyAndCannotBeResurrected() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            onActivity(scenario, activity -> {
                WebResourceDialog browser = new WebResourceDialog(activity, "https://example.test/", "en");
                browser.show();
                android.webkit.WebView original = browser.web;
                browser.hide();
                assertFalse(browser.isShowing());
                assertNotNull(original.getParent());
                browser.dismiss();
                assertNull(browser.web);
                assertNull(original.getParent());
                // The same path is called by a delayed cancelled image drag.
                browser.show();
                assertFalse(browser.isShowing());
                browser.dismiss();
            });
        }
    }

    @Test public void rendererTerminationReleasesOnlyTheAffectedBrowser() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            onActivity(scenario, activity -> {
                android.webkit.WebView board = activity.getBridge().getWebView();
                WebResourceDialog browser = new WebResourceDialog(activity, "https://example.test/", "en");
                browser.show();
                android.webkit.WebView original = browser.web;
                android.webkit.WebViewClient client = original.getWebViewClient();
                android.webkit.RenderProcessGoneDetail stopped = new android.webkit.RenderProcessGoneDetail() {
                    @Override public boolean didCrash() { return false; }
                    @Override public int rendererPriorityAtExit() { return android.webkit.WebView.RENDERER_PRIORITY_IMPORTANT; }
                };
                assertTrue(client.onRenderProcessGone(original, stopped));
                assertTrue(client.onRenderProcessGone(original, stopped));
                assertNull(browser.web);
                assertNull(original.getParent());
                assertFalse(browser.isShowing());
                assertSame(board, activity.getBridge().getWebView());
                assertNotNull(board.getParent());
                client.onPageFinished(original, "https://example.test/late");
                browser.show();
                assertFalse(browser.isShowing());
            });
        }
    }

    /** Active WebView animations need not make the whole UI queue idle before every read. */
    private void onActivity(ActivityScenario<MainActivity> scenario, ActivityScenario.ActivityAction<MainActivity> action) {
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
            .runOnMainSync(() -> scenario.onActivity(action));
    }

    private void inject(long down, int action, float x, float y) {
        MotionEvent event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x, y, 0);
        event.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);
        try { assertTrue(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getUiAutomation().injectInputEvent(event, true)); }
        finally { event.recycle(); }
    }
    @Test public void longPressImportsInlineImagePixels() throws Exception { assertImageImport(false); }
    @Test public void longPressImportsBlobImagePixels() throws Exception { assertImageImport(true); }
    private void assertImageImport(boolean blob) throws Exception {
        android.graphics.Bitmap original=android.graphics.Bitmap.createBitmap(20,10,android.graphics.Bitmap.Config.ARGB_8888);
        original.eraseColor(android.graphics.Color.RED);
        java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();
        original.compress(android.graphics.Bitmap.CompressFormat.PNG,100,bytes);original.recycle();
        String data="data:image/png;base64,"+android.util.Base64.encodeToString(bytes.toByteArray(),android.util.Base64.NO_WRAP);
        AtomicReference<WebResourceDialog> dialog=new AtomicReference<>();
        AtomicReference<JSObject> selection=new AtomicReference<>();
        CountDownLatch selected=new CountDownLatch(1);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            try {
                onActivity(scenario, activity->{
                    WebResourceDialog browser=new WebResourceDialog(activity,"https://example.test/","en",value->{selection.set(value);selected.countDown();});
                    dialog.set(browser);browser.show();
                    String source=blob?"fetch('"+data+"').then(r=>r.blob()).then(b=>image.src=URL.createObjectURL(b))":"image.src='"+data+"'";
                    browser.web.loadDataWithBaseURL("https://example.test/","<meta name='viewport' content='width=device-width,initial-scale=1'><img id='image' style='width:100px;height:50px'><script>var image=document.getElementById('image');image.onload=()=>window.__fcImageReady=true;"+source+";</script>","text/html","UTF-8",null);
                });
                boolean ready=false;
                for(int attempt=0;attempt<30 && !ready;attempt++) {
                    CountDownLatch read=new CountDownLatch(1);AtomicReference<Boolean> loaded=new AtomicReference<>(false);
                    onActivity(scenario, activity->dialog.get().web.evaluateJavascript("window.__fcImageReady===true",value->{loaded.set("true".equals(value) && dialog.get().web.getProgress()==100);read.countDown();}));
                    assertTrue(read.await(5,TimeUnit.SECONDS));ready=loaded.get();if(!ready)Thread.sleep(100);
                }
                assertTrue("The actual inline/blob image must finish loading",ready);
                final float[] start = new float[2], end = new float[2];
                onActivity(scenario, activity->{
                    WebResourceDialog browser=dialog.get(); int[] location=new int[2];
                    browser.web.getLocationOnScreen(location);
                    start[0]=location[0]+20*browser.web.getScale(); start[1]=location[1]+20*browser.web.getScale();
                    activity.getBridge().getWebView().getLocationOnScreen(location);
                    end[0]=location[0]+activity.getBridge().getWebView().getWidth()*0.2f;
                    end[1]=location[1]+activity.getBridge().getWebView().getHeight()*0.4f;
                });
                long down=SystemClock.uptimeMillis();
                inject(down,MotionEvent.ACTION_DOWN,start[0],start[1]);
                boolean floating=false;
                try {
                    for(int attempt=0;attempt<100 && !floating;attempt++) {
                        AtomicReference<Boolean> hidden=new AtomicReference<>(false);
                        onActivity(scenario, activity->hidden.set(dialog.get().getWindow().getDecorView().getVisibility()!=View.VISIBLE));
                        floating=hidden.get(); if(!floating) Thread.sleep(50);
                    }
                    assertTrue("Holding the real image must lift its native drag shadow",floating);
                    assertEquals("Lifting must not insert before the drop",1,selected.getCount());
                    for(int step=1;step<=12;step++) {
                        inject(down,MotionEvent.ACTION_MOVE,start[0]+(end[0]-start[0])*step/12,start[1]+(end[1]-start[1])*step/12);
                        Thread.sleep(16);
                    }
                } finally { inject(down,MotionEvent.ACTION_UP,end[0],end[1]); }
                assertTrue("Dropping must return the actual displayed image",selected.await(5,TimeUnit.SECONDS));
                assertEquals("image",selection.get().getString("kind"));
                assertTrue(selection.get().has("position"));
                onActivity(scenario, activity->assertFalse(dialog.get().isShowing()));
                String value=selection.get().getString("value");
                assertTrue(value.startsWith("data:image/png;base64,"));
                byte[] decoded=android.util.Base64.decode(value.substring(value.indexOf(',')+1),android.util.Base64.DEFAULT);
                android.graphics.Bitmap image=android.graphics.BitmapFactory.decodeByteArray(decoded,0,decoded.length);
                assertNotNull(image);assertEquals(20,image.getWidth());assertEquals(10,image.getHeight());assertEquals(android.graphics.Color.RED,image.getPixel(10,5));image.recycle();
            } finally {
                onActivity(scenario, activity->{if(dialog.get()!=null)dialog.get().dismiss();});
            }
        }
    }
    private void pointer(View view, int action, float x, float y) {
        long now = SystemClock.uptimeMillis();
        MotionEvent event = MotionEvent.obtain(now, now, action, x, y, 0);
        view.dispatchTouchEvent(event); event.recycle();
    }
    @Test public void nativeBrowserMovesResizesAndCancelsWithoutReplacingItsLiveWebView() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebResourceDialog> dialog = new AtomicReference<>();
            onActivity(scenario, activity -> {
                WebResourceDialog browser = new WebResourceDialog(activity, "https://example.test/", "en");
                dialog.set(browser); browser.show();
                browser.web.loadDataWithBaseURL("https://example.test/", "<p>Live experiment</p><script>window.__fcKeepExperiment=17</script>", "text/html", "UTF-8", null);
            });
            boolean initialized = false;
            for (int attempt = 0; attempt < 30 && !initialized; attempt++) {
                CountDownLatch read = new CountDownLatch(1);
                AtomicReference<String> marker = new AtomicReference<>();
                onActivity(scenario, activity -> dialog.get().web.evaluateJavascript("window.__fcKeepExperiment", value -> { marker.set(value); read.countDown(); }));
                assertTrue(read.await(5, TimeUnit.SECONDS));
                initialized = "17".equals(marker.get());
                if (!initialized) Thread.sleep(100);
            }
            assertTrue(initialized);
            onActivity(scenario, activity -> {
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
            onActivity(scenario, activity -> dialog.get().web.evaluateJavascript("window.__fcKeepExperiment", result -> { value.set(result); checked.countDown(); }));
            assertTrue(checked.await(5, TimeUnit.SECONDS));
            assertEquals("17", value.get());
            onActivity(scenario, activity -> dialog.get().dismiss());
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
            onActivity(scenario, activity -> {
                WebResourceDialog browser = new WebResourceDialog(activity,"https://example.test/", "en", result -> { selection.set(result); selected.countDown(); });
                dialog.set(browser); browser.show();
                browser.web.loadDataWithBaseURL("https://example.test/", "<meta name='viewport' content='width=device-width,initial-scale=1'><div id='wide' style='width:100%;height:100px;overflow-x:auto'><div style='width:2000px;height:80px'>Newton force and acceleration</div></div>", "text/html","UTF-8",null);
            });
            boolean ready = false;
            for (int attempt = 0; attempt < 30 && !ready; attempt++) {
                AtomicReference<Boolean> enabled = new AtomicReference<>(false);
                onActivity(scenario, activity -> { SeekBar bar = findBar(dialog.get().getWindow().getDecorView()); enabled.set(bar != null && bar.isEnabled()); });
                ready = enabled.get(); if (!ready) Thread.sleep(200);
            }
            assertTrue("The real horizontal scrollbar must discover the wide DOM container",ready);
            onActivity(scenario, activity -> {
                SeekBar bar = findBar(dialog.get().getWindow().getDecorView());
                long now = SystemClock.uptimeMillis();
                for (int action : new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_MOVE,MotionEvent.ACTION_UP}) {
                    MotionEvent event = MotionEvent.obtain(now,now+16,action,action == MotionEvent.ACTION_DOWN ? 12 : bar.getWidth()-12,bar.getHeight()/2f,0);
                    bar.dispatchTouchEvent(event);event.recycle();
                }
            });
            CountDownLatch scrolled = new CountDownLatch(1);
            AtomicReference<String> position = new AtomicReference<>();
            onActivity(scenario, activity -> dialog.get().web.evaluateJavascript("document.getElementById('wide').scrollLeft", value -> { position.set(value); scrolled.countDown(); }));
            assertTrue(scrolled.await(5,TimeUnit.SECONDS));
            assertTrue(Double.parseDouble(position.get()) > 100);
            onActivity(scenario, activity -> {
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
            onActivity(scenario, activity -> dialog.get().dismiss());
        }
    }
}
