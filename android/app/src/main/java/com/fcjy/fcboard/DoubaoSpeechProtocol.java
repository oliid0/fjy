package com.fcjy.fcboard;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

/** SAUC v3 framing; see the supplied API reference pp. 98–109 and its Java demo. */
final class DoubaoSpeechProtocol {
    static final int MAX_PAYLOAD = 2 * 1024 * 1024;
    private final Set<String> delivered = new HashSet<>();
    private long latestEnd = -1;

    static byte[] frame(int type, int sequence, byte[] payload) throws IOException {
        ByteArrayOutputStream compressed = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(compressed)) { gzip.write(payload); }
        byte[] body = compressed.toByteArray();
        return ByteBuffer.allocate(12 + body.length)
            .put((byte) 0x11).put((byte) ((type << 4) | (sequence < 0 ? 3 : 1)))
            .put((byte) 0x11).put((byte) 0).putInt(sequence).putInt(body.length).put(body).array();
    }

    static byte[] configuration() throws Exception {
        return new JSONObject()
            .put("user", new JSONObject().put("uid", "fcboard"))
            .put("audio", new JSONObject().put("format", "pcm").put("codec", "raw")
                .put("rate", 16000).put("bits", 16).put("channel", 1))
            .put("request", new JSONObject().put("model_name", "bigmodel")
                .put("enable_nonstream", true).put("enable_itn", true)
                .put("show_utterances", true).put("result_type", "full")
                .put("end_window_size", 800))
            .toString().getBytes(StandardCharsets.UTF_8);
    }

    static final class Response {
        final JSONObject body;
        final boolean last;
        Response(JSONObject body, boolean last) { this.body = body; this.last = last; }
    }

    static Response parse(byte[] bytes) throws Exception {
        if (bytes.length < 8 || bytes.length > MAX_PAYLOAD || (bytes[0] >>> 4 & 15) != 1) {
            throw new IOException("无效的语音响应帧");
        }
        int header = (bytes[0] & 15) * 4;
        int type = bytes[1] >>> 4 & 15;
        int flags = bytes[1] & 15;
        int compression = bytes[2] & 15;
        if (header < 4 || header > bytes.length - 4 || (type != 9 && type != 15)
                || (compression != 0 && compression != 1)) {
            throw new IOException("不支持的语音响应协议");
        }
        ByteBuffer input = ByteBuffer.wrap(bytes); input.position(header);
        int extra = ((flags & 1) != 0 ? 4 : 0) + ((flags & 4) != 0 ? 4 : 0);
        if (input.remaining() < extra + (type == 15 ? 8 : 4)) { throw new IOException("语音响应不完整"); }
        input.position(input.position() + extra);
        int code = type == 15 ? input.getInt() : 0;
        int length = input.getInt();
        if (length < 0 || length != input.remaining()) { throw new IOException("语音响应长度错误"); }
        byte[] payload = new byte[length]; input.get(payload);
        if (compression == 1) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (GZIPInputStream gzip = new GZIPInputStream(new ByteArrayInputStream(payload))) {
                byte[] block = new byte[4096]; int size;
                while ((size = gzip.read(block)) != -1) {
                    if (output.size() + size > MAX_PAYLOAD) { throw new IOException("语音响应过大"); }
                    output.write(block, 0, size);
                }
            }
            payload = output.toByteArray();
        }
        if (code != 0) { throw new IOException("豆包语音错误 (" + code + ")"); }
        if ((bytes[2] >>> 4 & 15) != 1) { throw new IOException("语音响应不是 JSON"); }
        JSONObject body = new JSONObject(new String(payload, StandardCharsets.UTF_8));
        int status = body.optInt("code", 0);
        if (status != 0) {
            throw new IOException("豆包语音错误 (" + status + ")");
        }
        return new Response(body, (flags & 2) != 0);
    }

    JSONArray lines(JSONObject body) throws Exception {
        JSONArray lines = new JSONArray();
        Object results = body.opt("result");
        JSONArray array = results instanceof JSONArray ? (JSONArray) results
            : new JSONArray().put(results instanceof JSONObject ? results : new JSONObject());
        for (int i = 0; i < array.length(); i++) {
            JSONArray utterances = array.getJSONObject(i).optJSONArray("utterances");
            if (utterances == null) { continue; }
            for (int j = 0; j < utterances.length(); j++) {
                JSONObject utterance = utterances.getJSONObject(j);
                if (!utterance.optBoolean("definite", false)) { continue; }
                String text = utterance.optString("text", "").trim();
                long start = utterance.optLong("start_time", -1);
                long end = utterance.optLong("end_time", -1);
                String id = start + ":" + end;
                if (text.isEmpty() || start < 0 || end < start || end < latestEnd || !delivered.add(id)) { continue; }
                latestEnd = Math.max(latestEnd, end);
                if (delivered.size() > 1000) { delivered.clear(); delivered.add(id); }
                lines.put(new JSONObject().put("time", start / 1000.0).put("text", text));
            }
        }
        return lines;
    }

    static JSONObject interim(JSONObject body) throws Exception {
        Object results = body.opt("result");
        JSONArray array = results instanceof JSONArray ? (JSONArray) results
            : new JSONArray().put(results instanceof JSONObject ? results : new JSONObject());
        for (int i = 0; i < array.length(); i++) {
            JSONArray utterances = array.getJSONObject(i).optJSONArray("utterances");
            if (utterances == null) { continue; }
            for (int j = 0; j < utterances.length(); j++) {
                JSONObject utterance = utterances.getJSONObject(j);
                String text = utterance.optString("text", "").trim();
                long start = utterance.optLong("start_time", -1);
                if (!utterance.optBoolean("definite", false) && !text.isEmpty() && start >= 0) {
                    return new JSONObject().put("time", start / 1000.0).put("text", text);
                }
            }
        }
        return null;
    }

    static boolean hasInterim(JSONObject body) throws Exception { return interim(body) != null; }
}
