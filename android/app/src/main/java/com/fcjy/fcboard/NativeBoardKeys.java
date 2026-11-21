package com.fcjy.fcboard;

import java.util.HashMap;
import java.util.Map;

/** Verified BSD/TouchPlanet key meanings, independent of arbitrary keyboards. */
final class NativeBoardKeys {
    private static final class Press {
        final boolean bsd;
        final long time;
        Press(boolean bsd, long time) { this.bsd = bsd; this.time = time; }
    }
    private final Map<String, Press> presses = new HashMap<>();
    static boolean bsd(String name, int vendor, int product) {
        return "BSD_TouchScreen".equals(name) && vendor == 0x003f && product == 0;
    }
    static boolean touchPlanet(String name, int vendor, int product) {
        return name != null && name.startsWith("TouchPlanet ETDV3") && vendor == 0x0483 && product == 0xba50;
    }
    static String vendorAction(int key) {
        switch (key) {
            case 400: return "red";
            case 401: return "blue";
            case 402: return "green";
            case 403: return "black";
            case 404: return "white";
            case 405: return "clear";
            case 406: return "lock";
            case 407: return "unlock";
            case 408: return "new";
            case 409: return "previous";
            case 410: return "next";
            case 411: return "split";
            case 412: case 413: return "pages";
            default: return null;
        }
    }
    boolean accept(String action, boolean bsd, long time) {
        Press previous = presses.get(action);
        if (previous != null && previous.bsd != bsd && time >= previous.time && time - previous.time <= 40) {
            presses.remove(action);
            return false;
        }
        presses.put(action, new Press(bsd, time));
        return true;
    }
    void reset() { presses.clear(); }
}
