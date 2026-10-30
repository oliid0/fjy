package com.fcjy.fcboard;

import java.util.Arrays;

/** Reference / SkizzePenManager report framing, without their short-buffer / byte overflow bugs. */
final class SkizzeProtocol {
    static final int VENDOR = 9761;
    static boolean matches(int vendor, int product) {
        return vendor == VENDOR && (product == 36867 || product == 36868);
    }

    static final class Packet {
        final int type;
        final byte[] data;
        Packet(int type, byte[] data) { this.type = type; this.data = data; }
    }

    static Packet decode(byte[] bytes, int length) {
        if (bytes == null || length < 1 || length > bytes.length) return null;
        int report = bytes[0] & 255;
        if (report == 5) {
            return length >= 12 ? new Packet(5, Arrays.copyOfRange(bytes, 1, 12)) : null;
        }
        if (report != 3 || length < 2) return null;
        int type = bytes[1] & 255;
        int size;
        switch (type) {
            case 1: case 7: size = 1; break;
            case 2: size = 20; break;
            case 3: size = 3; break;
            case 8: size = 2; break;
            default: return null;
        }
        return length >= size + 2 ? new Packet(type, Arrays.copyOfRange(bytes, 2, size + 2)) : null;
    }

    static byte[] featureRequest(int command, byte[] data) {
        if (data == null || data.length > 22) throw new IllegalArgumentException("Invalid Skizze feature length");
        byte[] buffer = new byte[26];
        buffer[0] = 3;
        buffer[1] = (byte) (data.length + 3);
        buffer[2] = (byte) command;
        System.arraycopy(data, 0, buffer, 4, data.length);
        return buffer;
    }

    static byte[] featureResponse(int command, byte[] bytes, int length) {
        if (bytes == null || length < 4 || length > bytes.length || bytes[0] != 3) return null;
        int size = bytes[1] & 255;
        if (size < 3 || size + 1 > length || (bytes[2] & 255) != command || bytes[3] != 1) return null;
        return Arrays.copyOfRange(bytes, 4, size + 1);
    }

    /** EVENT_ERASER_CLICK is a barrel click without tip contact: it advances the five-color palette. */
    static final class Barrel {
        private boolean pressed;
        private int count;
        synchronized boolean accept(byte flags) {
            if ((flags & 2) != 0) {
                if (!pressed) count = 1;
                else if (count > 0 && count < 600) count++;
                pressed = true;
                if ((flags & 1) != 0) count = 0;
                return false;
            }
            boolean click = pressed && count > 0 && count < 600;
            reset();
            return click;
        }
        synchronized void reset() { pressed = false; count = 0; }
    }
}
