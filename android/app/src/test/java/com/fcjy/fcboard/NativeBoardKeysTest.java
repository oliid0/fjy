package com.fcjy.fcboard;

import org.junit.Test;
import static org.junit.Assert.*;

public class NativeBoardKeysTest {
    @Test public void matchesOnlyTheCapturedDeviceCapabilities() {
        assertTrue(NativeBoardKeys.bsd("BSD_TouchScreen", 0x003f, 0));
        assertFalse(NativeBoardKeys.bsd("Other keyboard", 0x003f, 0));
        assertFalse(NativeBoardKeys.bsd("BSD_TouchScreen", 0x1234, 0));
        assertTrue(NativeBoardKeys.touchPlanet("TouchPlanet ETDV3 Keyboard", 0x0483, 0xba50));
        assertTrue(NativeBoardKeys.touchPlanet("TouchPlanet ETDV3", 0x0483, 0xba50));
        assertFalse(NativeBoardKeys.touchPlanet("TouchPlanet ETDV3", 0x0483, 0x1234));
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
        assertEquals("pages", NativeBoardKeys.vendorAction(412));
        assertEquals("pages", NativeBoardKeys.vendorAction(413));
        assertNull(NativeBoardKeys.vendorAction(7));
        assertNull(NativeBoardKeys.vendorAction(414));
        NativeBoardKeys keys = new NativeBoardKeys();
        assertTrue(keys.accept("lock", true, 1000));
        assertTrue(keys.accept("unlock", true, 1001));
    }
}
