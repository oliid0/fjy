package com.fcjy.fcboard;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.PorterDuff;
import android.graphics.Rect;
import android.graphics.RectF;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Process;
import android.view.Choreographer;
import android.view.SurfaceHolder;
import android.view.SurfaceView;

/** A standard Android display surface. Ink buffers bypass WebView/HWUI frame
 * submission; only damaged pixels are composed, on this surface's own looper. */
abstract class NativeCanvasView extends SurfaceView implements SurfaceHolder.Callback {
    private final Object lifecycle = new Object();
    private final Rect damage = new Rect();
    private HandlerThread displayThread;
    private Handler display;
    private boolean available, scheduled, full = true;
    private boolean firstPost = true;

    NativeCanvasView(Context context) {
        super(context);
        setWillNotDraw(true);
        setFocusable(false);
        getHolder().setFormat(PixelFormat.TRANSLUCENT);
        // The surface remains under the application window: HTML controls,
        // dialogs and native widgets retain their normal composition order.
        getHolder().addCallback(this);
    }

    protected abstract void paintCanvas(Canvas canvas);
    protected void onFramePosted() { }

    final void requestRender() {
        synchronized (lifecycle) { full = true; schedule(); }
    }

    final void requestRender(RectF bounds) {
        synchronized (lifecycle) {
            Rect rect = new Rect();
            bounds.roundOut(rect);
            if (rect.intersect(0, 0, getWidth(), getHeight())) damage.union(rect);
            schedule();
        }
    }

    private void schedule() {
        if (!available || scheduled || display == null || (!full && damage.isEmpty())) return;
        scheduled = true;
        display.post(() -> Choreographer.getInstance().postFrameCallback(time -> present()));
    }

    private void present() {
        Rect dirty;
        synchronized (lifecycle) {
            if (!available) { scheduled = false; return; }
            dirty = full ? new Rect(0, 0, getWidth(), getHeight()) : new Rect(damage);
            full = false;
            damage.setEmpty();
        }
        Canvas canvas = null;
        android.os.Trace.beginSection("NativeInk.present");
        try {
            // lockCanvas may expand dirty when a buffer is new. Paint the actual
            // returned clip, never assume its old pixels already exist.
            canvas = getHolder().lockCanvas(dirty);
            if (canvas != null) {
                canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR);
                paintCanvas(canvas);
            } else synchronized(lifecycle){full=true;}
        } catch (IllegalArgumentException | IllegalStateException unavailable) {
            synchronized (lifecycle) {
                if (available) android.util.Log.w("NativeInk", "Surface presentation unavailable", unavailable);
                full = true;
            }
        } finally {
            try {
                if (canvas != null) {
                    getHolder().unlockCanvasAndPost(canvas);
                    onFramePosted();
                    if(firstPost){firstPost=false;MainActivity.startup("surface.posted");}
                }
            } catch (IllegalArgumentException | IllegalStateException unavailable) {
                synchronized(lifecycle){full=true;}
            } finally {
                android.os.Trace.endSection();
                synchronized (lifecycle) {
                    scheduled = false;
                    if (available && (full || !damage.isEmpty())) schedule();
                }
            }
        }
    }

    @Override public void surfaceCreated(SurfaceHolder holder) {
        synchronized (lifecycle) {
            displayThread = new HandlerThread("native-ink-display", Process.THREAD_PRIORITY_DISPLAY);
            displayThread.start();
            display = new Handler(displayThread.getLooper());
            available = true;
            full = true;
            schedule();
        }
    }

    @Override public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) { requestRender(); }

    @Override public void surfaceDestroyed(SurfaceHolder holder) {
        HandlerThread thread;
        synchronized (lifecycle) {
            available = false;
            thread = displayThread;
            displayThread = null;
            if (display != null) display.removeCallbacksAndMessages(null);
            display = null;
            scheduled = false;
            full = true;
        }
        // SurfaceHolder serializes destruction with a locked canvas. Joining
        // outside the state/lifecycle locks lets an in-flight frame finish.
        if (thread != null) {
            thread.quitSafely();
            boolean interrupted = false;
            while (thread.isAlive()) {
                try { thread.join(); }
                catch (InterruptedException error) { interrupted = true; }
            }
            if (interrupted) Thread.currentThread().interrupt();
        }
    }
}
