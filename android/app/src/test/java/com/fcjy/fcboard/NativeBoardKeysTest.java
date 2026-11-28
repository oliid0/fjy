package com.fcjy.fcboard;

import org.junit.Test;
import static org.junit.Assert.*;

public class NativeBoardKeysTest {
    @Test public void matchesOnlyTheCapturedDeviceCapabilities() {
        assertTrue(NativeBoardKeys.hidPanel("InfraredMultiTouch-61 Touch Device,94-50P Keyboard", 0x0483, 0xba51));
        assertTrue(NativeBoardKeys.hidPanel("InfraredMultiTouch-61 Touch Device,86-60P Keyboard", 0x0483, 0xba51));
        assertFalse(NativeBoardKeys.hidPanel("InfraredMultiTouch-61 Touch Device,94-50P", 0x0483, 0xba51));
        assertTrue(NativeBoardKeys.mergedPanelKey(406, 206));
        assertTrue(NativeBoardKeys.mergedPanelKey(407, 209));
        assertFalse(NativeBoardKeys.mergedPanelKey(406, 209));
        assertFalse(NativeBoardKeys.mergedPanelKey(7, 206));
        assertTrue(NativeBoardKeys.bsd("BSD_UartTouch", 0, 0));
        assertTrue(NativeBoardKeys.bsd("BSD_TouchScreen", 0x003f, 0));
        assertFalse(NativeBoardKeys.bsd("Other keyboard", 0x003f, 0));
        assertFalse(NativeBoardKeys.bsd("BSD_TouchScreen", 0x1234, 0));
        assertTrue(NativeBoardKeys.hidPanel("TouchPlanet ETDV3 Keyboard", 0x0483, 0xba50));
        assertTrue(NativeBoardKeys.hidPanel("TouchPlanet ETDV3", 0x0483, 0xba50));
        assertFalse(NativeBoardKeys.hidPanel("TouchPlanet ETDV3", 0x0483, 0x1234));
    }
    @Test public void capturedButtonsUseTheSameActionsAcrossPanelModels() {
        assertTrue(NativeBoardKeys.hidPanel("InfraredMultiTouch-61 Touch Device,99-20P Keyboard", 0x0483, 0xba50));
        int[] keys = {7, 29, 30, 31, 14, 15, 16};
        String[] actions = {"split", "tip", "red", "new", "toggleLock", "save", "share"};
        for (int i = 0; i < keys.length; i++) assertEquals(actions[i], NativeBoardKeys.chordAction(keys[i]));
        assertNull(NativeBoardKeys.chordAction(32)); // D belongs to the OS.
        assertNull(NativeBoardKeys.chordAction(10)); // The old unobserved 3 mapping is gone.
    }
    @Test public void locksOnlyThePointerInterfaceOfTheSamePanel() {
        String keyboard = "InfraredMultiTouch-61 Touch Device,99-20P Keyboard";
        String touch = "InfraredMultiTouch-61 Touch Device,99-20P";
        assertTrue(NativeBoardKeys.pointerPeer(keyboard, 0x0483, 0xba50, touch, 0x0483, 0xba50));
        assertTrue(NativeBoardKeys.pointerPeer(keyboard, 0x0483, 0xba50, touch + " Stylus", 0x0483, 0xba50));
        assertFalse(NativeBoardKeys.pointerPeer(keyboard, 0x0483, 0xba50, "Dazzle Touch UART", 0, 0));
        assertFalse(NativeBoardKeys.pointerPeer(keyboard, 0x0483, 0xba50, touch, 0x0483, 0xba51));
    }
    @Test public void mirroredChannelsExecuteOnceInEitherArrivalOrderWithoutDroppingFastRealPresses() {
        NativeBoardKeys keys = new NativeBoardKeys();
        assertTrue(keys.accept("new", false, 1000));
        assertFalse(keys.accept("new", true, 1001));
        assertTrue(keys.accept("new", true, 1010));
        assertFalse(keys.accept("new", false, 1011));
        assertTrue(keys.accept("new", true, 1020));
        assertTrue(keys.accept("new", true, 1025));
        assertTrue(keys.accept("new", false, 1100));
        keys.reset();
        assertTrue(keys.accept("new", true, 1101));
    }
    @Test public void preservesSeparateLockUnlockAndPageActions() {
        assertEquals("lock", NativeBoardKeys.vendorAction(406));
        assertEquals("unlock", NativeBoardKeys.vendorAction(407));
        assertEquals("save", NativeBoardKeys.vendorAction(412));
        assertEquals("share", NativeBoardKeys.vendorAction(413));
        assertNull(NativeBoardKeys.vendorAction(7));
        assertNull(NativeBoardKeys.vendorAction(414));
        NativeBoardKeys keys = new NativeBoardKeys();
        assertTrue(keys.accept("lock", true, 1000));
        assertTrue(keys.accept("unlock", true, 1001));
    }
}
