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
        return product == 0 && (vendor == 0x003f && "BSD_TouchScreen".equals(name)
            || vendor == 0 && "BSD_UartTouch".equals(name));
    }
    static boolean hidPanel(String name, int vendor, int product) {
        return vendor == 0x0483 && (product == 0xba50 || product == 0xba51)
            && name != null && (name.startsWith("TouchPlanet ETDV3")
                || name.startsWith("InfraredMultiTouch-61 Touch Device,") && name.endsWith(" Keyboard"));
    }
    /** Captured Ctrl+Alt+Meta HID buttons, mapped only to application actions.
     * D remains unconsumed so the operating system owns source switching. */
    static String chordAction(int key) {
        switch (key) {
            case android.view.KeyEvent.KEYCODE_0: return "split";
            case android.view.KeyEvent.KEYCODE_A: return "tip";
            case android.view.KeyEvent.KEYCODE_B: return "red";
            case android.view.KeyEvent.KEYCODE_C: return "new";
            case android.view.KeyEvent.KEYCODE_7: return "toggleLock";
            case android.view.KeyEvent.KEYCODE_8: return "save";
            case android.view.KeyEvent.KEYCODE_9: return "share";
            default: return null;
        }
    }
    static boolean pointerPeer(String keyboard, int vendor, int product,
            String pointer, int pointerVendor, int pointerProduct) {
        if (vendor == 0 || vendor != pointerVendor || product != pointerProduct
                || keyboard == null || pointer == null) return false;
        return keyboard.replaceFirst(" (Keyboard|Stylus|Mouse)$", "")
            .equals(pointer.replaceFirst(" (Keyboard|Stylus|Mouse)$", ""));
    }
    // InputReader can merge the UART into another touchscreen (named "qwerty"
    // in the capture). Match the reported scan/key pair from its key layout.
    static boolean mergedPanelKey(int key, int scan) {
        switch (key) {
            case 400: return scan == 198;
            case 403: return scan == 203;
            case 405: return scan == 205;
            case 406: return scan == 206;
            case 407: return scan == 209;
            case 408: return scan == 210;
            case 409: return scan == 214;
            case 410: return scan == 211;
            case 411: return scan == 216;
            case 412: return scan == 218;
            case 413: return scan == 219;
            default: return false;
        }
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
            case 412: return "save";
            case 413: return "share";
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
