package com.fcjy.fcboard;

import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Locale;
import org.json.JSONObject;

/** Exact lookup in the checksum-pinned MIT ECDICT projection; no model weights.
 * Only sourced known terms return here. Unknown terms continue to native OPUS. */
final class NativeLexicon {
    private final JSONObject entries;
    NativeLexicon(Context context) throws Exception {
        try (InputStream input = context.getAssets().open("dictionary/en-zh.json"); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16384]; int count;
            while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
            JSONObject data = new JSONObject(bytes.toString("UTF-8"));
            if (data.getInt("version") != 1) throw new IllegalStateException("Unsupported local dictionary");
            entries = data.getJSONObject("entries");
        }
    }
    String lookup(String text) {
        String key = text.trim().toLowerCase(Locale.ROOT);
        if (key.matches("[\\p{P}\\p{N}\\s]+")) return text;
        if (key.length() > 100 || !key.matches("[a-z][a-z '\\-]*")) return null;
        String value = entries.optString(key, "");
        return value.isEmpty() ? null : value;
    }
}
