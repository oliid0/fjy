package com.fcjy.fcboard;

import static org.junit.Assert.*;
import org.junit.Test;

public class SkizzeProtocolTest {
    @Test public void acceptsOnlyReferenceDevicesAndCompleteReports() {
        assertTrue(SkizzeProtocol.matches(9761, 36867));
        assertTrue(SkizzeProtocol.matches(9761, 36868));
        assertFalse(SkizzeProtocol.matches(9762, 36868));
        assertFalse(SkizzeProtocol.matches(9761, 36866));
        int[][] sizes = {{1, 1}, {2, 20}, {3, 3}, {7, 1}, {8, 2}};
        for (int[] pair : sizes) {
            byte[] report = new byte[pair[1] + 2]; report[0] = 3; report[1] = (byte) pair[0];
            assertNotNull(SkizzeProtocol.decode(report, report.length));
            assertNull(SkizzeProtocol.decode(report, report.length - 1));
            assertEquals(pair[1], SkizzeProtocol.decode(report, report.length).data.length);
        }
        byte[] tip = new byte[12]; tip[0] = 5; tip[1] = 2;
        assertEquals(2, SkizzeProtocol.decode(tip, 12).data[0]);
        assertNull(SkizzeProtocol.decode(tip, 11));
        assertNull(SkizzeProtocol.decode(tip, 13));
        assertNull(SkizzeProtocol.decode(new byte[]{3}, 1));
        assertNull(SkizzeProtocol.decode(new byte[]{3, 99, 1}, 3));
        assertNull(SkizzeProtocol.decode(null, 0));
    }
    @Test public void encodesActualFeatureRequestsAndRejectsShortMismatchedResponses() {
        byte[] enable = SkizzeProtocol.featureRequest(0xa2, new byte[]{0});
        assertEquals(26, enable.length);
        assertArrayEquals(new byte[]{3, 4, (byte) 0xa2, 0, 0}, java.util.Arrays.copyOf(enable, 5));
        byte[] response = {3, 4, (byte) 0x81, 1, 1};
        assertArrayEquals(new byte[]{1}, SkizzeProtocol.featureResponse(0x81, response, 5));
        assertNull(SkizzeProtocol.featureResponse(0x81, response, 4));
        assertNull(SkizzeProtocol.featureResponse(0x85, response, 5));
        response[3] = 0;
        assertNull(SkizzeProtocol.featureResponse(0x81, response, 5));
        response[3] = 1; response[1] = (byte) 255;
        assertNull(SkizzeProtocol.featureResponse(0x81, response, 5));
        assertArrayEquals(new byte[0], SkizzeProtocol.featureResponse(0xa2, new byte[]{3, 3, (byte) 0xa2, 1}, 4));
        try { SkizzeProtocol.featureRequest(0xa2, new byte[23]); fail(); } catch (IllegalArgumentException expected) { }
    }
    @Test public void emitsOneBarrelClickWithoutTreatingWritingOrLongHeldInputAsColorChanges() {
        SkizzeProtocol.Barrel barrel = new SkizzeProtocol.Barrel();
        assertFalse(barrel.accept((byte) 2));
        assertTrue(barrel.accept((byte) 0));
        assertFalse(barrel.accept((byte) 0));
        barrel.accept((byte) 2); barrel.accept((byte) 3); barrel.accept((byte) 2);
        assertFalse(barrel.accept((byte) 0));
        for (int i = 0; i < 599; i++) barrel.accept((byte) 2);
        assertTrue(barrel.accept((byte) 0));
        for (int i = 0; i < 600; i++) barrel.accept((byte) 2);
        assertFalse(barrel.accept((byte) 0));
        barrel.accept((byte) 2); barrel.reset();
        assertFalse(barrel.accept((byte) 0));
    }
}
