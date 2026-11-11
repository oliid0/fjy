package com.fcjy.fcboard;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeMap;
import org.json.JSONArray;
import org.json.JSONObject;

/** Responses SSE is assembled on the native HTTP worker, never on WebView's UI loop. */
final class NativeAgentResponse {
    private final StringBuilder pending = new StringBuilder();
    private final List<String> data = new ArrayList<>();
    private final TreeMap<Integer, JSONObject> items = new TreeMap<>();
    private JSONObject completed;

    void accept(String chunk) throws Exception {
        pending.append(chunk);
        if (pending.length() > 4_000_000) throw new IOException("Agent response frame too large");
        int newline;
        while ((newline = pending.indexOf("\n")) >= 0) {
            String line = pending.substring(0, newline);
            pending.delete(0, newline + 1);
            if (line.endsWith("\r")) line = line.substring(0, line.length() - 1);
            if (line.isEmpty()) event();
            else if (line.startsWith("data:")) data.add(line.substring(5).replaceFirst("^ ", ""));
        }
    }

    private void event() throws Exception {
        if (data.isEmpty()) return;
        String text = String.join("\n", data); data.clear();
        if (text.equals("[DONE]")) return;
        JSONObject event = new JSONObject(text);
        String type = event.optString("type");
        if (type.equals("response.output_item.done")) {
            JSONObject item = event.optJSONObject("item");
            if (item != null && event.has("output_index")) items.put(event.getInt("output_index"), item);
        } else if (type.equals("response.completed")) completed = event.getJSONObject("response");
        else if (type.equals("response.failed") || type.equals("response.incomplete") || type.equals("error")) {
            JSONObject response = event.optJSONObject("response");
            JSONObject error = event.optJSONObject("error");
            if (error == null && response != null) error = response.optJSONObject("error");
            throw new IOException(error == null ? "Agent response did not complete" : error.optString("message", "Agent request failed"));
        }
    }

    JSONObject finish() throws Exception {
        accept("\n\n");
        if (completed == null) throw new IOException("Incomplete agent response; no actions were executed");
        if (completed.optJSONArray("output") == null) {
            JSONArray output = new JSONArray();
            for (JSONObject item : items.values()) output.put(item);
            completed.put("output", output);
        }
        return completed;
    }
}
