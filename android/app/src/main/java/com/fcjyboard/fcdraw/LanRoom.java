package com.fcjy.fcboard;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.LinkedHashMap;
import java.util.Map;

/** Same version/nonce conflict rule as the existing Excalidraw reconcileElements. */
final class LanRoom {
    private final Map<String, JSONObject> elements = new LinkedHashMap<>();
    private final JSONObject files = new JSONObject();
    private JSONObject background;

    synchronized void merge(JSONObject message) throws Exception {
        JSONArray incoming = message.optJSONArray("elements");
        if (incoming != null) {
            if (incoming.length() > 50000) throw new IllegalArgumentException("白板元素过多");
            for (int i = 0; i < incoming.length(); i++) {
                JSONObject next = incoming.getJSONObject(i);
                String id = next.getString("id");
                if (id.length() > 128 || !next.has("version") || !next.has("versionNonce")) throw new IllegalArgumentException("白板数据无效");
                JSONObject old = elements.get(id);
                if (old == null || next.getLong("version") > old.getLong("version") ||
                    (next.getLong("version") == old.getLong("version") && next.getLong("versionNonce") < old.getLong("versionNonce"))) {
                    elements.put(id, next);
                }
            }
        }
        JSONObject images = message.optJSONObject("files");
        if (images != null) {
            for (java.util.Iterator<String> keys = images.keys(); keys.hasNext();) {
                String id = keys.next();
                if (!files.has(id)) files.put(id, images.getJSONObject(id));
            }
        }
        JSONObject color = message.optJSONObject("background");
        if (color != null && (background == null || color.getLong("clock") > background.getLong("clock") ||
            (color.getLong("clock") == background.getLong("clock") && color.getString("client").compareTo(background.getString("client")) > 0))) {
            background = color;
        }
    }

    synchronized JSONObject snapshot() throws Exception {
        JSONObject result = new JSONObject();
        result.put("kind", "initial");
        result.put("elements", new JSONArray(elements.values()));
        result.put("files", files);
        if (background != null) result.put("background", background);
        return result;
    }

    synchronized JSONObject resolve(JSONObject message) throws Exception {
        merge(message);
        JSONArray accepted = new JSONArray();
        JSONArray requested = message.optJSONArray("elements");
        if (requested != null) for (int i = 0; i < requested.length(); i++) accepted.put(elements.get(requested.getJSONObject(i).getString("id")));
        JSONObject result = new JSONObject(); result.put("kind", "scene"); result.put("elements", accepted);
        JSONObject resolvedFiles = new JSONObject();
        JSONObject requestedFiles = message.optJSONObject("files");
        if (requestedFiles != null) for (java.util.Iterator<String> keys = requestedFiles.keys(); keys.hasNext();) { String id = keys.next(); resolvedFiles.put(id, files.get(id)); }
        result.put("files", resolvedFiles);
        if (message.has("background") && background != null) result.put("background", background);
        return result;
    }
}
