package com.fcjy.fcboard;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.PorterDuff;
import android.graphics.RectF;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Process;
import android.view.Choreographer;
import android.view.SurfaceHolder;
import android.view.SurfaceView;

/** Retained ink is submitted to an Android hardware Surface on its own looper.
 * Input never waits for a full-screen software buffer clear/copy. */
abstract class NativeCanvasView extends SurfaceView implements SurfaceHolder.Callback {
    private final Object lifecycle = new Object();
    private HandlerThread displayThread;
    private Handler display;
    private boolean available, scheduled, dirty = true;
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
        synchronized (lifecycle) { dirty = true; schedule(); }
    }

    final void requestRender(RectF bounds) {
        synchronized (lifecycle) {
            if (bounds.left < getWidth() && bounds.top < getHeight() && bounds.right > 0 && bounds.bottom > 0) {
                dirty = true;
                schedule();
            }
        }
    }

    private void schedule() {
        if (!available || scheduled || display == null || !dirty) return;
        scheduled = true;
        // An idle Surface can start the new tip now. Do not add a whole
        // refresh interval between an unbuffered MotionEvent and presentation.
        display.post(this::present);
    }

    private void present() {
        synchronized (lifecycle) {
            if (!available) { scheduled = false; return; }
            dirty = false;
        }
        Canvas canvas = null;
        android.os.Trace.beginSection("NativeInk.present");
        try {
            android.os.Trace.beginSection("NativeInk.acquire");
            try { canvas = getHolder().lockHardwareCanvas(); }
            finally { android.os.Trace.endSection(); }
            if (canvas != null) {
                // Hardware buffers do not preserve previous pixels. Clear and
                // replay the retained tiles for the entire frame (API 26+).
                canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR);
                android.os.Trace.beginSection("NativeInk.record");
                try { paintCanvas(canvas); }
                finally { android.os.Trace.endSection(); }
            } else synchronized(lifecycle){dirty=true;}
        } catch (IllegalArgumentException | IllegalStateException unavailable) {
            synchronized (lifecycle) {
                if (available) android.util.Log.w("NativeInk", "Surface presentation unavailable", unavailable);
                dirty = true;
            }
        } finally {
            try {
                if (canvas != null) {
                    android.os.Trace.beginSection("NativeInk.submit");
                    try { getHolder().unlockCanvasAndPost(canvas); }
                    finally { android.os.Trace.endSection(); }
                    onFramePosted();
                    if(firstPost){firstPost=false;MainActivity.startup("surface.posted");}
                }
            } catch (IllegalArgumentException | IllegalStateException unavailable) {
                synchronized(lifecycle){dirty=true;}
            } finally {
                android.os.Trace.endSection();
                synchronized (lifecycle) {
                    if (available && dirty) {
                        // Input arrived during this render (or the buffer was
                        // unavailable). Coalesce the backlog into one frame.
                        Choreographer.getInstance().postFrameCallback(time -> present());
                    } else {
                        scheduled = false;
                    }
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
            dirty = true;
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
            dirty = true;
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
