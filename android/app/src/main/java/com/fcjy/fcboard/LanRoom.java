package com.fcjy.fcboard;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.LinkedHashMap;
import java.util.Map;

/** Same version/nonce conflict rule as the existing Fcboard reconcileElements. */
final class LanRoom {
    private final Map<String, JSONObject> elements = new LinkedHashMap<>();
    private final JSONObject files = new JSONObject();
    private JSONObject background;
    private JSONObject page;
    private JSONObject document;

    private static JSONObject document(JSONObject value, JSONObject previous) throws Exception {
        String id = value.getString("id"), name = value.getString("name"), mime = value.getString("mimeType");
        Object rawPage = value.get("page");
        double index = rawPage instanceof Number ? ((Number)rawPage).doubleValue() : -1;
        if (id.isEmpty() || id.length() > 128 || name.isEmpty() || name.length() > 512 || mime.length() > 128 ||
            index < 0 || index > 9007199254740991d || index != Math.floor(index)) throw new IllegalArgumentException("共享课件无效");
        String data = value.has("dataURL") ? value.getString("dataURL") :
            previous != null && id.equals(previous.getString("id")) ? previous.getString("dataURL") : "";
        if (!data.matches("^data:[^;,]*;base64,[A-Za-z0-9+/]*={0,2}$")) throw new IllegalArgumentException("共享课件内容无效");
        JSONObject result = new JSONObject().put("id", id).put("name", name).put("mimeType", mime).put("page", (long)index).put("dataURL", data);
        if (value.has("view")) {
            JSONObject view = value.getJSONObject("view");
            double zoom = view.getDouble("zoom"), scroll = view.getDouble("scroll"), animation = view.getDouble("animation");
            if (!Double.isFinite(zoom) || zoom < .5 || zoom > 3 || !Double.isFinite(scroll) || !Double.isFinite(animation) ||
                animation < 0 || animation > 9007199254740991d || animation != Math.floor(animation) || !(view.get("animate") instanceof Boolean)) throw new IllegalArgumentException("共享课件视图无效");
            result.put("view", view);
        }
        return result;
    }

    private JSONObject documentHeader() throws Exception {
        JSONObject header = new JSONObject(document.toString());
        header.remove("dataURL");
        return header;
    }

    private static JSONObject page(JSONObject message) throws Exception {
        if (!message.has("page")) return null;
        JSONObject value = message.getJSONObject("page");
        Object epoch = value.get("epoch");
        double number = epoch instanceof Number ? ((Number)epoch).doubleValue() : -1;
        if (value.getString("id").isEmpty() || value.getString("id").length() > 128 ||
            number < 0 || number > 9007199254740991d || number != Math.floor(number)) throw new IllegalArgumentException("白板页面无效");
        return new JSONObject().put("id", value.getString("id")).put("epoch", (long)number);
    }

    synchronized void merge(JSONObject message) throws Exception {
        JSONObject scope = page(message);
        JSONObject nextDocument = message.has("document") ? document(message.getJSONObject("document"), document) : document;
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
        page = scope;
        document = nextDocument;
    }

    synchronized JSONObject snapshot() throws Exception {
        JSONObject result = new JSONObject();
        result.put("kind", "initial");
        result.put("elements", new JSONArray(elements.values()));
        result.put("files", files);
        if (background != null) result.put("background", background);
        if (page != null) result.put("page", page);
        if (document != null) result.put("document", document);
        return result;
    }

    synchronized JSONObject resolve(JSONObject message) throws Exception {
        return resolve(message, false);
    }

    synchronized JSONObject resolve(JSONObject message, boolean owner) throws Exception {
        JSONObject incomingPage = page(message);
        boolean switched = (page == null) != (incomingPage == null) || (page != null && incomingPage != null &&
            (!page.getString("id").equals(incomingPage.getString("id")) || page.getLong("epoch") != incomingPage.getLong("epoch")));
        if (switched) {
            if (!owner || incomingPage == null || (page != null && incomingPage.getLong("epoch") <= page.getLong("epoch"))) return snapshot();
            LanRoom next = new LanRoom();
            if (message.has("document")) next.document = document;
            next.merge(message);
            elements.clear(); elements.putAll(next.elements);
            java.util.List<String> keys = new java.util.ArrayList<>();
            for (java.util.Iterator<String> it = files.keys(); it.hasNext();) keys.add(it.next());
            for (String key : keys) files.remove(key);
            for (java.util.Iterator<String> it = next.files.keys(); it.hasNext();) { String key = it.next(); files.put(key, next.files.get(key)); }
            background = next.background; page = next.page; document = next.document;
            return snapshot();
        }
        JSONObject acceptedMessage = message;
        if (!owner && message.has("document")) {
            acceptedMessage = new JSONObject(message.toString());
            acceptedMessage.remove("document");
        }
        merge(acceptedMessage);
        JSONArray accepted = new JSONArray();
        JSONArray requested = message.optJSONArray("elements");
        if (requested != null) for (int i = 0; i < requested.length(); i++) accepted.put(elements.get(requested.getJSONObject(i).getString("id")));
        JSONObject result = new JSONObject(); result.put("kind", "scene"); result.put("elements", accepted);
        JSONObject resolvedFiles = new JSONObject();
        JSONObject requestedFiles = message.optJSONObject("files");
        if (requestedFiles != null) for (java.util.Iterator<String> keys = requestedFiles.keys(); keys.hasNext();) { String id = keys.next(); resolvedFiles.put(id, files.get(id)); }
        result.put("files", resolvedFiles);
        if (message.has("background") && background != null) result.put("background", background);
        if (page != null) result.put("page", page);
        if (document != null) result.put("document", documentHeader());
        return result;
    }
}
