package com.fcjy.fcboard;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.InputDevice;
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
    @Test public void supportsTwentyContactsWithoutDroppingPendingStrokes() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            List<JSObject> events = new ArrayList<>(); NativeInkView view = surface(events, "pen");
            for (int count=1; count<=20; count++) motion(view, count==1 ? MotionEvent.ACTION_DOWN : MotionEvent.ACTION_POINTER_DOWN | ((count-1)<<8), 11, count, 2, 20, 20);
            assertEquals(20, events.size());
            for (int count=20; count>=1; count--) motion(view, count==1 ? MotionEvent.ACTION_UP : MotionEvent.ACTION_POINTER_UP | ((count-1)<<8), 11, count, 2, 20, 20);
            assertEquals(40, events.size());
            java.util.Set<String> completed = new java.util.HashSet<>();
            for (JSObject event:events) if (event.optString("phase").equals("end")) completed.add(event.optString("id"));
            assertEquals("All twenty strokes survive delayed WebView acknowledgements", 20, completed.size());
        });
    }
    @Test public void aRestingHandDoesNotEraseOrEndTheOtherDevicesPen() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            List<JSObject> events = new ArrayList<>(); NativeInkView view = surface(events, "pen");
            motion(view, MotionEvent.ACTION_DOWN, 11, 1, 70, 20, 20);
            assertEquals(0, events.size());
            motion(view, MotionEvent.ACTION_DOWN, 22, 1, 2, 70, 70);
            motion(view, MotionEvent.ACTION_MOVE, 11, 1, 70, 100, 100);
            motion(view, MotionEvent.ACTION_MOVE, 22, 1, 2, 130, 70);
            motion(view, MotionEvent.ACTION_UP, 22, 1, 2, 150, 70);
            motion(view, MotionEvent.ACTION_UP, 11, 1, 70, 100, 100);
            assertEquals(2, events.size());
            assertEquals("pen", events.get(0).optString("mode"));
            assertEquals("end", events.get(1).optString("phase"));
            assertTrue(events.get(1).optJSONArray("points").length() >= 3);
        });
    }
    @Test public void mainAndExternalDevicePointerZeroRemainIndependent() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            List<JSObject> events = new ArrayList<>(); NativeInkView view = surface(events, "pen");
            motion(view, MotionEvent.ACTION_DOWN, 11, 1, 2, 20, 20);
            motion(view, MotionEvent.ACTION_DOWN, 22, 1, 2, 80, 80);
            motion(view, MotionEvent.ACTION_CANCEL, 11, 1, 2, 20, 20);
            motion(view, MotionEvent.ACTION_MOVE, 22, 1, 2, 120, 80);
            motion(view, MotionEvent.ACTION_UP, 22, 1, 2, 150, 80);
            assertEquals(4, events.size());
            assertEquals("cancel", events.get(2).optString("phase"));
            assertEquals(events.get(1).optString("id"), events.get(3).optString("id"));
            assertEquals("end", events.get(3).optString("phase"));
        });
    }
    @Test public void nativeBrushKeepsFactoryFootprintAndLatestSampleVisible() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            NativeBrush brush = new NativeBrush(15, 1, 45, true);
            PaintFixture pixels = new PaintFixture();
            try {
                brush.add(40,40,.5f); brush.draw(pixels.canvas,pixels.paint);
                assertTrue(Color.alpha(pixels.bitmap.getPixel(54,40))>0);
                assertEquals(0,Color.alpha(pixels.bitmap.getPixel(40,54)));
                for(int x=50;x<150;x+=10) brush.add(x,40,.5f);
                brush.draw(pixels.canvas,pixels.paint);
                assertTrue("Latest real point is visible before lift",Color.alpha(pixels.bitmap.getPixel(140,40))>0);
            } finally { pixels.bitmap.recycle(); }
        });
    }
    private static final class PaintFixture {
        final Bitmap bitmap=Bitmap.createBitmap(200,200,Bitmap.Config.ARGB_8888);
        final Canvas canvas=new Canvas(bitmap);
        final android.graphics.Paint paint=new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        PaintFixture() { paint.setColor(Color.RED); paint.setStyle(android.graphics.Paint.Style.FILL); }
    }
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
        view.configure(mode, true, 0, 0, 1, 4, 1, 1, "#ff0000", false, 36, Collections.emptyList(), null, 0, mode, true, 60, null);
        return view;
    }
    private static void touch(NativeInkView view, int action, float x, float y) {
        long now = SystemClock.uptimeMillis();
        MotionEvent event = MotionEvent.obtain(now, now, action, x, y, 0);
        try { assertTrue(view.onTouchEvent(event)); } finally { event.recycle(); }
    }
    private static void motion(NativeInkView view, int action, int device, int count, float major, float x, float y) {
        MotionEvent.PointerProperties[] properties=new MotionEvent.PointerProperties[count];
        MotionEvent.PointerCoords[] coordinates=new MotionEvent.PointerCoords[count];
        for(int i=0;i<count;i++) {
            properties[i]=new MotionEvent.PointerProperties(); properties[i].id=i; properties[i].toolType=MotionEvent.TOOL_TYPE_FINGER;
            coordinates[i]=new MotionEvent.PointerCoords(); coordinates[i].x=x+i*3; coordinates[i].y=y+i*3;
            coordinates[i].pressure=.5f; coordinates[i].touchMajor=major; coordinates[i].touchMinor=major;
        }
        long now=SystemClock.uptimeMillis();
        MotionEvent event=MotionEvent.obtain(now,now,action,count,properties,coordinates,0,0,1,1,device,0,InputDevice.SOURCE_TOUCHSCREEN,0);
        try { assertTrue(view.onTouchEvent(event)); } finally { event.recycle(); }
    }
}
