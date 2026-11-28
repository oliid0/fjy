package com.fcjy.fcboard;

import android.content.ContextWrapper;
import android.content.Intent;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class NativeBoardModeTest {
    private static final class State implements NativeBoardMode.Settings {
        String value;
        boolean writable = true;
        final List<String> writes = new ArrayList<>();
        State(String value) { this.value = value; }
        @Override public String read() { return value; }
        @Override public boolean write(String next) {
            writes.add(next);
            if (writable) value = next;
            return writable;
        }
    }

    private static ContextWrapper context(List<Intent> broadcasts) {
        return new ContextWrapper(InstrumentationRegistry.getInstrumentation().getTargetContext()) {
            @Override public void sendBroadcast(Intent intent) { broadcasts.add(intent); }
        };
    }

    @Test public void mapsBothSideboardsForTheWholeForegroundSessionAndRestoresOnce() {
        List<Intent> broadcasts = new ArrayList<>();
        State state = new State("0");
        NativeBoardMode mode = new NativeBoardMode(context(broadcasts), () -> 14, state);
        mode.foreground(true);
        mode.foreground(true);
        assertEquals("1", state.value);
        assertEquals(2, broadcasts.size());
        assertEquals("broadcast.beststar.action.setCommand", broadcasts.get(0).getAction());
        assertEquals("SetDoubleScreen", broadcasts.get(0).getStringExtra("command"));
        assertEquals("broadcast.navigation.touch_off", broadcasts.get(1).getAction());
        mode.foreground(false);
        mode.foreground(false);
        assertEquals("0", state.value);
        assertEquals(Arrays.asList("1", "0"), state.writes);
        assertEquals(4, broadcasts.size());
        assertEquals("SetSingleScreen", broadcasts.get(2).getStringExtra("command"));
        assertEquals("broadcast.navigation.touch_on", broadcasts.get(3).getAction());
        mode.foreground(true);
        mode.foreground(false);
        assertEquals(8, broadcasts.size());
        assertEquals(Arrays.asList("1", "0", "1", "0"), state.writes);
    }

    @Test public void missingProviderDoesNotSkipTheFirmwareMappingOrChangeOtherDevices() {
        for (int customer : new int[]{0, 14}) {
            List<Intent> broadcasts = new ArrayList<>();
            NativeBoardMode.Settings missing = new NativeBoardMode.Settings() {
                @Override public String read() { throw new UnsupportedOperationException("No provider"); }
                @Override public boolean write(String value) { throw new AssertionError("No provider"); }
            };
            NativeBoardMode mode = new NativeBoardMode(context(broadcasts), () -> customer, missing);
            mode.foreground(true);
            mode.foreground(false);
            assertEquals(customer == 14 ? 4 : 0, broadcasts.size());
            if (customer == 14) {
                assertEquals("SetDoubleScreen", broadcasts.get(0).getStringExtra("command"));
                assertEquals("SetSingleScreen", broadcasts.get(2).getStringExtra("command"));
            }
        }
    }

    @Test public void restoresOnlyTheProviderStateItActuallyChanged() {
        for (String original : new String[]{"0", "1"}) {
            List<Intent> broadcasts = new ArrayList<>();
            State state = new State(original);
            NativeBoardMode mode = new NativeBoardMode(context(broadcasts), () -> 0, state);
            mode.foreground(true);
            mode.foreground(false);
            assertEquals(original, state.value);
            assertEquals(Arrays.asList("1", original), state.writes);
            assertEquals(2, broadcasts.size());
            assertEquals("broadcast.navigation.touch_off", broadcasts.get(0).getAction());
            assertEquals("broadcast.navigation.touch_on", broadcasts.get(1).getAction());
        }
        State changedElsewhere = new State("0");
        NativeBoardMode mode = new NativeBoardMode(context(new ArrayList<>()), () -> 0, changedElsewhere);
        mode.foreground(true);
        changedElsewhere.value = "0";
        mode.foreground(false);
        assertEquals(Arrays.asList("1"), changedElsewhere.writes);
    }

    @Test public void aRejectedWriteOrBroadcastDoesNotClaimOwnership() {
        State state = new State("0");
        state.writable = false;
        NativeBoardMode mode = new NativeBoardMode(context(new ArrayList<>()), () -> 0, state);
        mode.foreground(true);
        mode.foreground(false);
        assertEquals(Arrays.asList("1"), state.writes);
        List<Intent> attempts = new ArrayList<>();
        ContextWrapper denied = new ContextWrapper(context(attempts)) {
            @Override public void sendBroadcast(Intent intent) {
                attempts.add(intent);
                throw new SecurityException("Firmware command unavailable");
            }
        };
        mode = new NativeBoardMode(denied, () -> 14, new State(null));
        mode.foreground(true);
        mode.foreground(false);
        assertEquals(1, attempts.size());
        assertEquals("SetDoubleScreen", attempts.get(0).getStringExtra("command"));
    }
}
