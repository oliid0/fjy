package com.fcjy.fcboard;

import java.io.IOException;
import org.json.JSONObject;

/** Capacitor 8 getLong only accepts Long, but JSON file sizes/offsets are usually Integer. */
final class BridgeNumbers {
    static long integer(JSONObject data, String name, long fallback) throws IOException {
        Object value = data.opt(name);
        if (value == null || value == JSONObject.NULL) return fallback;
        if (!(value instanceof Number)) throw new IOException("Invalid numeric field: " + name);
        double number = ((Number) value).doubleValue();
        if (!Double.isFinite(number) || number != Math.rint(number) || Math.abs(number) > 9007199254740991d) throw new IOException("Invalid integer field: " + name);
        return ((Number) value).longValue();
    }
}
