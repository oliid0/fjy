package com.fcjy.fcboard;

import java.net.InetAddress;
import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;
import static org.junit.Assert.*;

public class LanDiscoveryTest {
    @Test public void newHumanCodesContainExactlyFourDigits() {
        for(int i=0;i<1000;i++) assertTrue(LanDiscovery.createCode().matches("[0-9]{4}"));
    }
    @Test public void resolutionUsesTheCurrentDnsAddressAndRejectsLocalPlaceholders() throws Exception {
        assertEquals("192.168.0.48",LanDiscovery.resolvedAddress(Arrays.asList(
            InetAddress.getByName("127.0.0.1"),InetAddress.getByName("169.254.1.1"),
            InetAddress.getByName("0.0.0.0"),InetAddress.getByName("192.168.0.48"))));
        assertNull(LanDiscovery.resolvedAddress(Collections.emptyList()));
    }
}
