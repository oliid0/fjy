package com.fcjy.fcboard;

import static org.junit.Assert.*;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.Test;

public class SkizzeButtonsTest {
    private static final class Clock implements SkizzeButtons.Timer {
        long now;
        final Map<Runnable, Long> pending = new HashMap<>();
        public void after(Runnable task, long milliseconds) { pending.put(task, now + milliseconds); }
        public void cancel(Runnable task) { pending.remove(task); }
        void advance(long milliseconds) {
            now += milliseconds;
            for (Runnable task : new ArrayList<>(pending.keySet())) if (pending.get(task) <= now) { pending.remove(task); task.run(); }
        }
    }
    @Test public void waitsForRealReleaseAndPreservesSingleAndDoubleClickTiming() {
        Clock clock = new Clock(); List<String> clicks = new ArrayList<>();
        SkizzeButtons buttons = new SkizzeButtons(clock, (button, twice) -> clicks.add(button + ":" + twice));
        buttons.raw(0); clock.advance(1000); assertTrue(clicks.isEmpty());
        buttons.raw(4); buttons.raw(4); clock.advance(1000); assertTrue(clicks.isEmpty());
        buttons.raw(0); clock.advance(499); assertTrue(clicks.isEmpty());
        clock.advance(1); assertEquals("4:false", clicks.get(0));
        buttons.raw(32); buttons.raw(0); clock.advance(100);
        buttons.raw(32); buttons.raw(0); assertEquals("32:true", clicks.get(1));
        clock.advance(1000); assertEquals(2, clicks.size());
        buttons.close(); assertTrue(clock.pending.isEmpty());
    }
    @Test public void isolatesSensoryAndRawInputsAndCancelsAfterDisconnectOrAmbiguousChord() {
        Clock clock = new Clock(); List<String> clicks = new ArrayList<>();
        SkizzeButtons buttons = new SkizzeButtons(clock, (button, twice) -> clicks.add(button + ":" + twice));
        buttons.raw(8); buttons.raw(0);
        buttons.sensory(1, 2); buttons.sensory(0, 2);
        buttons.sensory(1, 2); buttons.sensory(0, 2);
        assertEquals("0:true", clicks.get(0));
        clock.advance(500); assertEquals("8:false", clicks.get(1));
        buttons.sensory(1, 1); buttons.sensory(0, 1); clock.advance(500); assertEquals(2, clicks.size());
        buttons.raw(4); buttons.raw(12); buttons.raw(4); buttons.raw(0);
        clock.advance(1000); assertEquals(2, clicks.size());
        buttons.raw(32); buttons.raw(0); buttons.close(); clock.advance(1000);
        assertEquals(2, clicks.size()); assertTrue(clock.pending.isEmpty());
    }
}
