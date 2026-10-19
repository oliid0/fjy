package com.fcjy.fcboard;

import fi.iki.elonen.NanoWSD;
import fi.iki.elonen.NanoWSD.WebSocketFrame.CloseCode;
import fi.iki.elonen.NanoWSD.WebSocketFrame.OpCode;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Map;
import java.util.HashMap;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/** One local server serves the bundled app, authenticated whiteboard rooms and Scrcpy streams. */
final class LanServer extends NanoWSD {
    interface Assets { InputStream open(String path) throws IOException; }
    private final Assets assets;
    private final Consumer<String> host;
    private final ScrcpyBridge scrcpy;
    private final Set<WebSocket> peers = ConcurrentHashMap.newKeySet();
    private final Map<WebSocket, java.util.concurrent.ThreadPoolExecutor> writers = new ConcurrentHashMap<>();
    private volatile LanRoom room;
    private volatile String roomToken;
    private volatile String remotePin;
    private volatile String remoteToken;
    private volatile long pinDeadline;
    private volatile WebSocket controller;
    private long attemptWindow;
    private int attempts;

    LanServer(Assets assets, Consumer<String> host, ScrcpyBridge scrcpy) {
        super("0.0.0.0", 0);
        this.assets = assets; this.host = host; this.scrcpy = scrcpy;
    }

    synchronized String startRoom(JSONObject initial) throws Exception {
        stopRoom();
        room = new LanRoom(); room.merge(initial);
        roomToken = UUID.randomUUID().toString().replace("-", "");
        return roomToken;
    }

    synchronized void stopRoom() {
        roomToken = null; room = null;
        for (WebSocket peer : peers) abortSocket(peer);
        peers.clear();
    }
    synchronized JSONObject snapshotRoom() throws Exception {
        if (room == null) throw new IllegalStateException("协作已结束");
        return room.snapshot();
    }

    synchronized String startRemote() {
        stopRemote();
        remotePin = String.format(java.util.Locale.ROOT, "%06d", new SecureRandom().nextInt(1000000));
        pinDeadline = System.currentTimeMillis() + 5 * 60 * 1000;
        attempts = 0; attemptWindow = System.currentTimeMillis();
        return remotePin;
    }

    synchronized void stopRemote() {
        remotePin = null; remoteToken = null; pinDeadline = 0;
        WebSocket old = controller; controller = null;
        if (old != null) abortSocket(old);
        if (scrcpy != null) scrcpy.close();
    }

    private static void closeSocket(WebSocket socket, String reason) {
        try { socket.close(CloseCode.NormalClosure, reason, false); } catch (IOException ignored) { }
    }
    private void abortSocket(WebSocket socket) {
        try { socket.getHandshakeRequest().getInputStream().close(); } catch (IOException ignored) { }
        java.util.concurrent.ThreadPoolExecutor writer = writers.remove(socket);
        if (writer != null) writer.shutdownNow();
        peers.remove(socket);
    }
    private void enqueue(WebSocket socket, String text) {
        java.util.concurrent.ThreadPoolExecutor writer = writers.get(socket);
        if (writer == null) return;
        try { writer.execute(() -> { try { socket.send(text); } catch (IOException error) { abortSocket(socket); } }); }
        catch (java.util.concurrent.RejectedExecutionException slow) { abortSocket(socket); }
    }

    private void notifyPeers() {
        host.accept("{\"kind\":\"peers\",\"count\":" + peers.size() + "}");
    }

    synchronized void publish(String text, WebSocket sender) throws Exception {
        if (text.length() > 20 * 1024 * 1024) throw new IllegalArgumentException("单次同步图片超过 20 MB，请缩小图片");
        LanRoom current = room;
        if (current == null) throw new IllegalStateException("协作未开启");
        JSONObject value = new JSONObject(text);
        if (!"scene".equals(value.optString("kind"))) throw new IllegalArgumentException("同步消息无效");
        String resolved = current.resolve(value).toString();
        for (WebSocket peer : peers) {
            enqueue(peer, resolved);
        }
        host.accept(resolved);
    }

    private boolean sameOrigin(IHTTPSession request) {
        String origin = request.getHeaders().get("origin");
        return origin == null || origin.equals("http://" + request.getHeaders().get("host"));
    }

    @Override protected WebSocket openWebSocket(IHTTPSession request) {
        String path = request.getUri();
        boolean board = roomToken != null && path.equals("/board/" + roomToken);
        boolean remote = remoteToken != null && path.equals("/control/" + remoteToken);
        return new WebSocket(request) {
            private boolean joined;
            @Override protected void onOpen() {
                if (!sameOrigin(request) || (!board && !remote) || (board && !path.equals("/board/" + roomToken)) || (remote && !path.equals("/control/" + remoteToken))) { closeSocket(this, "会话无效或已结束"); return; }
                try {
                    if (board) {
                        synchronized (LanServer.this) {
                            if (room == null || peers.size() >= 32) { closeSocket(this, "协作人数已满"); return; }
                            writers.put(this, new java.util.concurrent.ThreadPoolExecutor(1, 1, 0, java.util.concurrent.TimeUnit.MILLISECONDS, new java.util.concurrent.ArrayBlockingQueue<>(16), task -> { Thread thread = new Thread(task, "Fcdraw-peer"); thread.setDaemon(true); return thread; }));
                            enqueue(this, room.snapshot().toString());
                            peers.add(this); joined = true;
                        }
                        notifyPeers();
                    } else {
                        synchronized (LanServer.this) {
                            if (controller != null) { closeSocket(this, "已有设备正在控制，请先断开"); return; }
                            controller = this; joined = true;
                        }
                        scrcpy.stream((channel, data) -> {
                            byte[] packet = new byte[data.length + 1]; packet[0] = (byte)channel;
                            System.arraycopy(data, 0, packet, 1, data.length);
                            send(packet);
                        }, error -> {
                            try { send(new JSONObject().put("error", error).toString()); } catch (Exception ignored) { }
                            closeSocket(this, "投屏已断开");
                        });
                    }
                } catch (Exception error) { closeSocket(this, "连接失败：" + error.getMessage()); }
            }
            @Override protected void onMessage(WebSocketFrame message) {
                if (!joined) return;
                try {
                    if (message.getOpCode() == OpCode.Text && "ping".equals(message.getTextPayload())) { send("pong"); return; }
                    if (board && message.getOpCode() == OpCode.Text && "snapshot".equals(message.getTextPayload())) { send(snapshotRoom().toString()); return; }
                    if (board && path.equals("/board/" + roomToken) && message.getOpCode() == OpCode.Text) publish(message.getTextPayload(), this);
                    else if (remote && message.getOpCode() == OpCode.Binary && message.getBinaryPayload().length <= 65536) scrcpy.control(message.getBinaryPayload());
                } catch (Exception error) {
                    try { send(new JSONObject().put("error", error.getMessage()).toString()); } catch (Exception ignored) { }
                }
            }
            @Override protected void onClose(CloseCode code, String reason, boolean initiatedByRemote) {
                if (board) { abortSocket(this); notifyPeers(); }
                if (remote && controller == this) { controller = null; scrcpy.stopStream(); }
            }
            @Override protected void onPong(WebSocketFrame pong) { }
            @Override protected void onException(IOException error) { abortSocket(this); closeSocket(this, "连接已断开"); }
        };
    }

    private Response json(Response.Status status, JSONObject data) {
        Response result = newFixedLengthResponse(status, "application/json; charset=utf-8", data.toString());
        result.addHeader("Cache-Control", "no-store"); return result;
    }
    @Override protected Response serveHttp(IHTTPSession request) {
        try {
            String path = request.getUri();
            if (path.startsWith("/remote-api/")) {
                if (request.getMethod() != Method.POST || !sameOrigin(request) || !request.getHeaders().getOrDefault("content-type", "").startsWith("application/json")) {
                    return json(Response.Status.FORBIDDEN, new JSONObject().put("error", "请求来源无效"));
                }
                if (Integer.parseInt(request.getHeaders().getOrDefault("content-length", "0")) > 8192) throw new IllegalArgumentException("请求过大");
                Map<String,String> body = new HashMap<>(); request.parseBody(body);
                JSONObject input = new JSONObject(body.getOrDefault("postData", "{}"));
                if (path.equals("/remote-api/auth")) {
                    synchronized (this) {
                        long now = System.currentTimeMillis();
                        if (now - attemptWindow > 60000) { attempts = 0; attemptWindow = now; }
                        if (++attempts > 5 || remotePin == null || now > pinDeadline || !remotePin.equals(input.optString("pin"))) {
                            return json(Response.Status.FORBIDDEN, new JSONObject().put("error", "配对码错误、已过期或尝试过多，请在大屏重新开启控制"));
                        }
                        remoteToken = UUID.randomUUID().toString().replace("-", ""); remotePin = null;
                        host.accept("{\"kind\":\"remote\",\"state\":\"paired\"}");
                        return json(Response.Status.OK, new JSONObject().put("token", remoteToken));
                    }
                }
                if (remoteToken == null || !remoteToken.equals(request.getHeaders().get("x-fcboard-session"))) {
                    return json(Response.Status.FORBIDDEN, new JSONObject().put("error", "请先输入大屏配对码"));
                }
                if (path.equals("/remote-api/connect")) {
                    scrcpy.connect(input.optInt("pairPort"), input.optString("code"), input.getInt("port"));
                    host.accept("{\"kind\":\"remote\",\"state\":\"connected\"}");
                    return json(Response.Status.OK, new JSONObject().put("connected", true));
                }
                if (path.equals("/remote-api/disconnect")) {
                    scrcpy.close();
                    return json(Response.Status.OK, new JSONObject().put("connected", false));
                }
                return json(Response.Status.NOT_FOUND, new JSONObject().put("error", "入口不存在"));
            }
            if (request.getMethod() != Method.GET || path.contains("..") || path.contains("\\")) return newFixedLengthResponse(Response.Status.FORBIDDEN, MIME_PLAINTEXT, "Forbidden");
            String name = path.equals("/") ? "index.html" : path.substring(1);
            InputStream stream = assets.open(name);
            String mime = name.endsWith(".wasm") ? "application/wasm" : name.endsWith(".mjs") || name.endsWith(".js") ? "text/javascript" : getMimeTypeForFile(name);
            Response result = newChunkedResponse(Response.Status.OK, mime, stream);
            result.addHeader("X-Content-Type-Options", "nosniff");
            result.addHeader("Referrer-Policy", "no-referrer");
            result.addHeader("Cache-Control", "no-cache");
            return result;
        } catch (IOException missing) {
            return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not found");
        } catch (Exception error) {
            try { return json(Response.Status.BAD_REQUEST, new JSONObject().put("error", error.getMessage())); }
            catch (Exception ignored) { return newFixedLengthResponse(Response.Status.BAD_REQUEST, MIME_PLAINTEXT, "Request failed"); }
        }
    }
    @Override public void stop() { stopRoom(); stopRemote(); super.stop(); }
}
