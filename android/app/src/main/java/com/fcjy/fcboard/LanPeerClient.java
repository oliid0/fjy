package com.fcjy.fcboard;

import java.net.URI;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import org.json.JSONObject;

/** Native LAN transport keeps the bundled HTTPS WebView on its own origin. */
final class LanPeerClient implements AutoCloseable {
    private final Consumer<JSONObject> events;
    private final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS).build();
    private final ConcurrentHashMap<String, Peer> peers = new ConcurrentHashMap<>();
    private static final class Peer { volatile WebSocket socket; volatile boolean open; }
    LanPeerClient(Consumer<JSONObject> events) { this.events = events; }

    private void emit(String id, String type, String text, int code) {
        try { events.accept(new JSONObject().put("id", id).put("type", type).put("text", text).put("code", code)); }
        catch (org.json.JSONException error) { throw new IllegalStateException(error); }
    }
    void connect(String id, String url) throws Exception {
        URI address = new URI(url);
        if (id == null || id.isEmpty() || id.length() > 200 || address.getHost() == null
            || !("ws".equals(address.getScheme()) || "wss".equals(address.getScheme()))
            || address.getUserInfo() != null || address.getRawQuery() != null || address.getRawFragment() != null
            || !address.getPath().matches("/board/[a-f0-9]{32}")) throw new IllegalArgumentException("Invalid collaboration connection");
        Peer peer = new Peer();
        if (peers.size() >= 4 || peers.putIfAbsent(id, peer) != null) throw new IllegalStateException("Collaboration connection already exists");
        try {
            peer.socket = client.newWebSocket(new Request.Builder().url(url).build(), new WebSocketListener() {
                private void finish(int code, String reason) {
                    if (peers.remove(id, peer)) { peer.open = false; emit(id, "close", reason, code); }
                }
                @Override public void onOpen(WebSocket socket, Response response) {
                    peer.socket = socket;
                    if (peers.get(id) != peer) { socket.cancel(); return; }
                    peer.open = true; emit(id, "open", "", 0);
                }
                @Override public void onMessage(WebSocket socket, String text) {
                    if (text.length() > 20 * 1024 * 1024) { socket.cancel(); finish(1009, "Collaboration message is too large"); return; }
                    if (peers.get(id) == peer) emit(id, "message", text, 0);
                }
                @Override public void onClosing(WebSocket socket, int code, String reason) { socket.close(code, reason); }
                @Override public void onClosed(WebSocket socket, int code, String reason) { finish(code, reason); }
                @Override public void onFailure(WebSocket socket, Throwable error, Response response) {
                    finish(1006, error.getMessage() == null ? "Collaboration connection failed" : error.getMessage());
                }
            });
        } catch (Exception error) { peers.remove(id, peer); throw error; }
    }
    void send(String id, String text) {
        Peer peer = peers.get(id);
        if (peer == null || !peer.open || peer.socket == null) throw new IllegalStateException("Collaboration connection is not open");
        if (text == null || text.length() > 20 * 1024 * 1024 || !peer.socket.send(text)) throw new IllegalStateException("Collaboration send failed");
    }
    void disconnect(String id) {
        Peer peer = peers.remove(id);
        if (peer != null && peer.socket != null) { peer.open = false; peer.socket.cancel(); }
    }
    @Override public void close() {
        for (String id : peers.keySet()) disconnect(id);
        client.dispatcher().executorService().shutdown(); client.connectionPool().evictAll();
    }
}
