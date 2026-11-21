package com.fcjy.fcboard;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ModelPoolTest {
    private static final class Resource implements AutoCloseable {
        final CountDownLatch closed = new CountDownLatch(1);
        final AtomicInteger closes = new AtomicInteger();
        @Override public void close() { closes.incrementAndGet(); closed.countDown(); }
    }
    @Test public void reusesDuringABurstThenClosesAfterIdleWithoutAnotherRequest() throws Exception {
        ModelPool<Resource> pool = new ModelPool<>(2, 1000);
        Resource model = new Resource();
        AtomicInteger created = new AtomicInteger();
        try {
            ModelPool.Lease<Resource> first = pool.acquire("zh", () -> { created.incrementAndGet(); return model; });
            first.release(true);
            ModelPool.Lease<Resource> second = pool.acquire("zh", () -> { created.incrementAndGet(); return new Resource(); });
            assertSame(model, second.value()); assertEquals(1, created.get());
            second.release(true);
            assertTrue(model.closed.await(5, TimeUnit.SECONDS));
            assertEquals(1, model.closes.get());
        } finally { pool.close(); }
    }
    @Test public void trimmingOrDeletingNeverClosesALiveLeaseAndLateReleaseIsExactlyOnce() throws Exception {
        ModelPool<Resource> pool = new ModelPool<>(2);
        Resource active = new Resource(), idle = new Resource();
        ModelPool.Lease<Resource> first = pool.acquire("en", () -> active);
        ModelPool.Lease<Resource> second = pool.acquire("zh", () -> idle);
        second.release(true);
        pool.trim();
        assertTrue(idle.closed.await(5, TimeUnit.SECONDS));
        assertEquals(0, active.closes.get());
        pool.close(); assertEquals(0, active.closes.get());
        first.release(true); first.release(false);
        assertTrue(active.closed.await(5, TimeUnit.SECONDS));
        assertEquals(1, active.closes.get());
    }
    @Test public void languageEvictionCannotEvictTheOtherRunningRequest() throws Exception {
        try (ModelPool<Resource> pool = new ModelPool<>(2)) {
            Resource active = new Resource(), idle = new Resource();
            ModelPool.Lease<Resource> first = pool.acquire("math", () -> active);
            ModelPool.Lease<Resource> second = pool.acquire("en", () -> idle);
            second.release(true);
            ModelPool.Lease<Resource> third = pool.acquire("zh", Resource::new);
            assertTrue(idle.closed.await(5, TimeUnit.SECONDS));
            assertEquals(0, active.closes.get());
            pool.retire("math"); assertEquals(0, active.closes.get());
            first.release(true); assertEquals(1, active.closes.get());
            third.release(false);
        }
    }
    @Test public void slowConstructionDoesNotHoldThePoolLockOrBlockAnotherRequest() throws Exception {
        try (ModelPool<Resource> pool = new ModelPool<>(2)) {
            CountDownLatch started = new CountDownLatch(1), finish = new CountDownLatch(1), complete = new CountDownLatch(1);
            java.util.concurrent.atomic.AtomicReference<Throwable> error = new java.util.concurrent.atomic.AtomicReference<>();
            Thread first = new Thread(() -> {
                try { pool.acquire("slow", () -> { started.countDown(); finish.await(); return new Resource(); }).release(false); }
                catch (Throwable failure) { error.set(failure); }
                finally { complete.countDown(); }
            });
            first.start();
            try {
                assertTrue(started.await(5, TimeUnit.SECONDS));
                pool.acquire("independent", Resource::new).release(false);
                assertEquals(1, complete.getCount());
            } finally { finish.countDown(); }
            assertTrue(complete.await(5, TimeUnit.SECONDS));
            assertNull(error.get());
        }
    }
}
