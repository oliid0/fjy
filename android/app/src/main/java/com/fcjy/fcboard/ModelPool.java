package com.fcjy.fcboard;

import android.os.SystemClock;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/** Bounded exclusive leases: reuse during a writing burst, unload after idle.
 * Factories and close() run outside the pool lock, never on the input path. */
final class ModelPool<T extends AutoCloseable> implements AutoCloseable {
    static final long IDLE_MS = 15000;
    private static volatile long lastInk;
    private static final ScheduledExecutorService TIMER = Executors.newSingleThreadScheduledExecutor(task -> new Thread(() -> {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND);
        task.run();
    }, "fcboard-model-idle"));
    static void inkActivity() { lastInk = SystemClock.elapsedRealtime(); }
    interface Factory<T> { T create() throws Exception; }
    private static final class Slot<T> {
        final String key;
        T value;
        boolean busy = true, discard;
        long used;
        Slot(String key) { this.key = key; }
    }
    static final class Lease<T extends AutoCloseable> {
        private final ModelPool<T> pool;
        private final Slot<T> slot;
        private boolean released;
        Lease(ModelPool<T> pool, Slot<T> slot) { this.pool = pool; this.slot = slot; }
        T value() { return slot.value; }
        synchronized void release(boolean reusable) {
            if (released) return;
            released = true;
            pool.release(slot, reusable);
        }
    }
    private final int limit;
    private final long idleMs;
    private final java.util.function.Predicate<String> inkDriven;
    private final List<Slot<T>> slots = new ArrayList<>();
    private ScheduledFuture<?> expiry;
    private boolean closed;
    private android.content.Context observing;
    private final android.content.ComponentCallbacks2 memory = new android.content.ComponentCallbacks2() {
        @Override public void onConfigurationChanged(android.content.res.Configuration configuration) { }
        @Override public void onLowMemory() { trim(); }
        @Override public void onTrimMemory(int level) { if (level >= TRIM_MEMORY_RUNNING_LOW) trim(); }
    };
    ModelPool(int limit) { this(limit, IDLE_MS, key -> true); }
    ModelPool(int limit, long idleMs) { this(limit, idleMs, key -> true); }
    ModelPool(int limit, java.util.function.Predicate<String> inkDriven) { this(limit, IDLE_MS, inkDriven); }
    private ModelPool(int limit, long idleMs, java.util.function.Predicate<String> inkDriven) { this.limit = limit; this.idleMs = idleMs; this.inkDriven = inkDriven; }
    private long used(Slot<T> slot) { return Math.max(slot.used, inkDriven.test(slot.key) ? lastInk : 0); }
    synchronized void observe(android.content.Context context) {
        if (observing == null && !closed) { observing = context; observing.registerComponentCallbacks(memory); }
    }

    Lease<T> acquire(String key, Factory<T> factory) throws Exception {
        Slot<T> slot = null, evicted = null;
        synchronized (this) {
            if (closed) throw new IllegalStateException("Model pool closed");
            for (Slot<T> candidate : slots) if (!candidate.busy && candidate.key.equals(key)) { slot = candidate; break; }
            if (slot == null) {
                if (slots.size() >= limit) {
                    for (Slot<T> candidate : slots) if (!candidate.busy && (evicted == null || candidate.used < evicted.used)) evicted = candidate;
                    if (evicted == null) throw new IllegalStateException("Model pool busy");
                    slots.remove(evicted);
                }
                slot = new Slot<>(key); slots.add(slot);
            }
            slot.busy = true;
        }
        if (evicted != null) closeValue(evicted.value);
        try {
            if (slot.value == null) slot.value = factory.create();
            synchronized (this) {
                if (closed || slot.discard) throw new IllegalStateException("Model retired during loading");
            }
            return new Lease<>(this, slot);
        } catch (Exception | LinkageError error) {
            synchronized (this) { slots.remove(slot); }
            closeValue(slot.value); throw error;
        }
    }
    private void release(Slot<T> slot, boolean reusable) {
        boolean dispose;
        synchronized (this) {
            slot.busy = false; slot.used = SystemClock.elapsedRealtime();
            dispose = closed || slot.discard || !reusable;
            if (dispose) slots.remove(slot);
            schedule();
        }
        if (dispose) closeValue(slot.value);
    }
    private void schedule() {
        if (expiry != null) expiry.cancel(false);
        expiry = null;
        if (closed) return;
        long delay = Long.MAX_VALUE, now = SystemClock.elapsedRealtime();
        for (Slot<T> slot : slots) if (!slot.busy) delay = Math.min(delay, Math.max(1, idleMs - (now - used(slot))));
        if (delay != Long.MAX_VALUE) expiry = TIMER.schedule(this::expire, delay, TimeUnit.MILLISECONDS);
    }
    private void expire() {
        List<T> values = new ArrayList<>();
        synchronized (this) {
            long now = SystemClock.elapsedRealtime();
            slots.removeIf(slot -> {
                if (slot.busy || now - used(slot) < idleMs) return false;
                values.add(slot.value); return true;
            });
            schedule();
        }
        for (T value : values) closeValue(value);
    }
    void retire(String key) { discard(key, false); }
    void trim() { discard(null, false); }
    @Override public void close() {
        discard(null, true);
        synchronized (this) {
            if (observing != null) { observing.unregisterComponentCallbacks(memory); observing = null; }
        }
    }
    private void discard(String key, boolean destroy) {
        List<T> values = new ArrayList<>();
        synchronized (this) {
            if (destroy) closed = true;
            slots.removeIf(slot -> {
                if (key != null && !slot.key.equals(key)) return false;
                slot.discard = true;
                if (slot.busy) return false;
                values.add(slot.value); return true;
            });
            schedule();
        }
        // Memory callbacks and Activity teardown may originate on the UI thread.
        if (!values.isEmpty()) TIMER.execute(() -> { for (T value : values) closeValue(value); });
    }
    private static void closeValue(AutoCloseable value) {
        if (value != null) try { value.close(); } catch (Exception error) { android.util.Log.w("FcboardModels", "Model release failed", error); }
    }
}
