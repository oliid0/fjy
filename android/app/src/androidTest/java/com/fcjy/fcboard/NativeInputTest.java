package com.fcjy.fcboard;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.widget.FrameLayout;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real Android Views/MotionEvent/Canvas; no WebView or mocked renderer. */
@RunWith(AndroidJUnit4.class)
public class NativeInputTest {
    @Test public void nativePenDrawsLocallyAndOnlySendsContactBoundaries() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            List<JSObject> events = new ArrayList<>();
            NativeInkView view = surface(events, "pen");
            touch(view, MotionEvent.ACTION_DOWN, 20, 20);
            for (int i = 30; i <= 90; i += 10) touch(view, MotionEvent.ACTION_MOVE, i, i);
            assertEquals("Move samples must stay native", 1, events.size());
            touch(view, MotionEvent.ACTION_UP, 100, 100);
            assertEquals(2, events.size());
            assertEquals("end", events.get(1).optString("phase"));
            assertTrue(events.get(1).optJSONArray("points").length() > 2);
            Bitmap pixels = Bitmap.createBitmap(200, 200, Bitmap.Config.ARGB_8888);
            try {
                view.draw(new Canvas(pixels));
                assertTrue(Color.alpha(pixels.getPixel(50, 50)) > 0);
                view.acknowledge(events.get(1).optString("id"));
                pixels.eraseColor(Color.TRANSPARENT); view.draw(new Canvas(pixels));
                assertEquals(Color.TRANSPARENT, pixels.getPixel(50, 50));
            } finally { pixels.recycle(); }
        });
    }
    @Test public void regionEraseHasNativeFillWhileSelectorStaysAnOpenOutline() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            for (String mode : new String[]{"select", "regionErase"}) {
                List<JSObject> events = new ArrayList<>();
                NativeInkView view = surface(events, mode);
                touch(view, MotionEvent.ACTION_DOWN, 50, 50);
                touch(view, MotionEvent.ACTION_MOVE, 150, 50);
                touch(view, MotionEvent.ACTION_MOVE, 150, 150);
                touch(view, MotionEvent.ACTION_UP, 50, 150);
                assertEquals(2, events.size());
                assertEquals(mode, events.get(1).optString("mode"));
                Bitmap pixels = Bitmap.createBitmap(200, 200, Bitmap.Config.ARGB_8888);
                try {
                    view.draw(new Canvas(pixels));
                    assertEquals(mode.equals("regionErase") ? 48 : 0, Color.alpha(pixels.getPixel(100, 100)));
                } finally { pixels.recycle(); }
            }
        });
    }
    private static NativeInkView surface(List<JSObject> events, String mode) {
        android.content.Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        FrameLayout parent = new FrameLayout(context);
        NativeInkView view = new NativeInkView(context, events::add);
        parent.addView(view, new FrameLayout.LayoutParams(200, 200));
        view.layout(0, 0, 200, 200);
        view.configure(mode, true, 0, 0, 1, 4, 1, 1, "#ff0000", false, 36, Collections.emptyList(), null, 0, mode, true, 60);
        return view;
    }
    private static void touch(NativeInkView view, int action, float x, float y) {
        long now = SystemClock.uptimeMillis();
        MotionEvent event = MotionEvent.obtain(now, now, action, x, y, 0);
        try { assertTrue(view.onTouchEvent(event)); } finally { event.recycle(); }
    }
}
