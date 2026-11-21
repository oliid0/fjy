package com.fcjy.fcboard;

import fi.iki.elonen.NanoWSD;
import fi.iki.elonen.NanoWSD.WebSocketFrame.CloseCode;
import fi.iki.elonen.NanoWSD.WebSocketFrame.OpCode;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Locale;
import java.io.InputStream;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BiConsumer;
import org.json.JSONObject;

/** HTTPS sender page and single-sender signaling. Media stays on the WebRTC peer connection. */
final class ProjectionServer extends NanoWSD {
    private static final int MAX_SIGNAL_SIZE = 64 * 1024;
    private final LanServer.Assets assets;
    private final BiConsumer<String, JSONObject> events;
    private final AtomicReference<Sender> active = new AtomicReference<>();
    final String path = "/" + UUID.randomUUID() + "/";
    final String id;
    private final String template;
    private final JSONObject languages;

    ProjectionServer(String address, String id, LanServer.Assets assets, BiConsumer<String, JSONObject> events) throws Exception {
        super(address, 0);
        this.id = id;
        this.assets = assets;
        this.events = events;
        template = readAsset("sender.html");
        languages = new JSONObject(readAsset("messages.json"));
    }

    private String readAsset(String name) throws IOException {
        try (InputStream in = assets.open(name); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) bytes.write(buf, 0, n);
            return bytes.toString("UTF-8");
        }
    }

    private String language(String header) {
        if (header != null && header.length() < 4096) {
            try {
                for (Locale.LanguageRange range : Locale.LanguageRange.parse(header)) {
                    if (range.getWeight() == 0) continue;
                    String tag = range.getRange();
                    if (languages.has(tag)) return tag;
                    Locale locale = Locale.forLanguageTag(tag);
                    String base = locale.getLanguage();
                    if ("zh".equals(base)) {
                        String script = locale.getScript();
                        String region = locale.getCountry();
                        if ("HK".equals(region) && !"Hans".equals(script)) return "zh-hk";
                        return "Hant".equals(script) || (script.isEmpty() &&
                            ("HK".equals(region) || "TW".equals(region) || "MO".equals(region))) ? "zh-tw" : "zh-cn";
                    }
                    if (languages.has(base)) return base;
                }
            } catch (IllegalArgumentException ignored) { }
        }
        return "en";
    }

    private Response senderPage(String header) {
        String lang = language(header);
        JSONObject strings = languages.optJSONObject(lang);
        String html = template.replace("__LANG__", lang)
            .replace("__TITLE__", PageLocalization.escape(strings.optString("title")))
            .replace("__CHOOSE__", PageLocalization.escape(strings.optString("choose")))
            .replace("__STOP__", PageLocalization.escape(strings.optString("stop")))
            .replace("__READY__", PageLocalization.escape(strings.optString("ready")))
            .replace("__MESSAGES__", strings.toString().replace("<", "\\u003c"));
        Response response = newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", html);
        response.addHeader("Content-Language", lang);
        response.addHeader("Vary", "Accept-Language");
        return response;
    }

    @Override public Response serve(IHTTPSession request) {
        if (isWebsocketRequested(request)) {
            String origin = request.getHeaders().get("origin");
            if (!request.getUri().equals(path + "signal") ||
                !("https://" + request.getHeaders().get("host")).equals(origin)) {
                return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not found");
            }
        }
        return super.serve(request);
    }

    @Override protected Response serveHttp(IHTTPSession request) {
        String uri = request.getUri();
        String file = uri.startsWith(path) ? uri.substring(path.length()) : null;
        if (request.getMethod() != Method.GET || file == null) {
            return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not found");
        }
        try {
            Response response;
            if (file.isEmpty()) {
                response = senderPage(request.getHeaders().get("accept-language"));
            } else if (file.equals("sender.js")) {
                response = newChunkedResponse(Response.Status.OK, "text/javascript; charset=utf-8",
                    assets.open(file));
            } else {
                return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not found");
            }
            response.addHeader("Cache-Control", "no-store");
            response.addHeader("Referrer-Policy", "no-referrer");
            response.addHeader("X-Content-Type-Options", "nosniff");
            response.addHeader("Content-Security-Policy",
                "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' wss:; frame-ancestors 'none'; base-uri 'none'");
            return response;
        } catch (IOException error) {
            return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, "Sender page unavailable");
        }
    }

    @Override protected WebSocket openWebSocket(IHTTPSession request) {
        return new Sender(request);
    }

    void answer(String sender, String sdp) throws Exception {
        Sender socket = active.get();
        if (socket == null || !socket.id.equals(sender) || sdp.length() > MAX_SIGNAL_SIZE) {
            throw new IOException("The sender disconnected");
        }
        if (!socket.awaitingAnswer.compareAndSet(true, false)) throw new IOException("No pending offer");
        socket.send(new JSONObject().put("kind", "answer").put("sdp", sdp).toString());
    }

    void disconnect(String sender) {
        Sender socket = active.get();
        if (socket != null && socket.id.equals(sender)) {
            socket.finish();
            socket.closeWith(CloseCode.NormalClosure, "Disconnected by the board");
        }
    }

    @Override public void stop() {
        Sender socket = active.get();
        if (socket != null) socket.finish();
        super.stop();
    }

    private final class Sender extends WebSocket {
        private final String id = UUID.randomUUID().toString();
        private boolean offered;
        private final AtomicBoolean awaitingAnswer = new AtomicBoolean();

        Sender(IHTTPSession request) { super(request); }

        @Override protected void onOpen() {
            if (!active.compareAndSet(null, this)) {
                closeWith(CloseCode.PolicyViolation, "The board is already receiving a projection");
            }
        }

        @Override protected void onMessage(WebSocketFrame frame) {
            if (active.get() != this) return;
            try {
                if (frame.getOpCode() != OpCode.Text || frame.getBinaryPayload().length > MAX_SIGNAL_SIZE) {
                    throw new IOException("Invalid signal");
                }
                String payload = frame.getTextPayload();
                if ("ping".equals(payload)) return;
                JSONObject signal = new JSONObject(payload);
                String sdp = signal.getString("sdp");
                String kind = signal.optString("kind");
                if (!(offered ? "restart" : "offer").equals(kind) || !sdp.startsWith("v=0") ||
                    !awaitingAnswer.compareAndSet(false, true)) {
                    throw new IOException("Invalid offer");
                }
                offered = true;
                events.accept(kind, new JSONObject().put("sender", id).put("sdp", sdp));
            } catch (Exception invalid) {
                closeWith(CloseCode.PolicyViolation, "Invalid signaling message");
            }
        }

        private void closeWith(CloseCode code, String reason) {
            try { close(code, reason, false); }
            catch (IOException ignored) { finish(); }
        }

        private void finish() {
            if (active.compareAndSet(this, null)) {
                try { events.accept("left", new JSONObject().put("sender", id)); }
                catch (org.json.JSONException ignored) { }
            }
        }

        @Override protected void onClose(CloseCode code, String reason, boolean initiatedByRemote) { finish(); }
        @Override protected void onException(IOException error) { finish(); }
        @Override protected void onPong(WebSocketFrame pong) { }
    }
}
