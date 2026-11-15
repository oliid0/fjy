package com.fcjy.fcboard;

import org.json.JSONObject;

/** The whiteboard supplies translated visible strings; Android device locale is independent. */
final class PageLocalization {
    private static volatile JSONObject current;
    static void configure(JSONObject value) throws Exception {
        if (value == null || !value.optString("language").matches("[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*")) throw new IllegalArgumentException("Invalid page language");
        JSONObject strings = value.getJSONObject("strings");
        java.util.Iterator<String> keys = strings.keys();
        while (keys.hasNext()) {
            String key = keys.next(); Object text = strings.get(key);
            if (!key.matches("[A-Za-z][A-Za-z0-9_]*") || !(text instanceof String) || ((String)text).isEmpty() || ((String)text).length() > 4000) throw new IllegalArgumentException("Invalid page translation");
        }
        current = new JSONObject(value.toString());
    }
    static JSONObject snapshot() {
        JSONObject value = current;
        if (value == null) throw new IllegalStateException("Page language is not configured");
        return value;
    }
    static String language() { return snapshot().optString("language"); }
    static String text(String key, Object... values) {
        String text = snapshot().optJSONObject("strings").optString(key, "");
        if (text.isEmpty()) throw new IllegalArgumentException("Missing page translation: " + key);
        for (int i = 0; i + 1 < values.length; i += 2) text = text.replace("{{" + values[i] + "}}", String.valueOf(values[i + 1]));
        return text;
    }
    static String escape(String text) { return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;"); }
    static String html(String key, Object... values) { return escape(text(key, values)); }
    static String render(String template) {
        // JSON is data in a non-executable script element, including literal user-safe '<'.
        String json = snapshot().toString().replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026");
        return template.replace("__FCBOARD_PAGE_LOCALIZATION__", json);
    }
}
