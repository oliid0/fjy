package com.fcjy.fcboard;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import android.util.Base64;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import org.json.JSONObject;

/** Seeduplex 3.0 JSON protocol, separate from SAUC's binary ASR framing.
 * Reference: supplied speech PDF pp. 125–137 and the official web_duplex_demo. */
@CapacitorPlugin(name = "FcboardDuplexSpeech")
public class DuplexSpeechPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS).pingInterval(20, TimeUnit.SECONDS).build();
    private volatile Session active;
    private final java.util.Set<String> opening = java.util.concurrent.ConcurrentHashMap.newKeySet();
    private static final class Session {
        final String id;
        volatile boolean replyAllowed;
        final CountDownLatch ready = new CountDownLatch(1);
        volatile boolean closed;
        volatile String error;
        volatile WebSocket socket;
        volatile NativeVoiceAudio audio;
        Session(String id) { this.id = id; }
    }
    private void emit(Session session, JSONObject event) {
        if (!session.closed && active == session) {
            notifyListeners("event", new JSObject().put("session", session.id).put("event", event));
        }
    }
    private void fail(Session session, String message) {
        if (session.closed || session.error != null) return;
        session.error = message;
        emit(session, new JSObject().put("type", "error").put("message", message));
        session.ready.countDown();
        if (session.socket != null) session.socket.cancel();
        if (session.audio != null) session.audio.close();
    }
    @PluginMethod public void start(PluginCall call) {
        String id = call.getString("session", "");
        if (id.isEmpty() || !opening.add(id)) { call.reject("Invalid or duplicate voice session"); return; }
        startSession(call);
    }
    private void startSession(PluginCall call) {
        worker.execute(() -> {
            String id = call.getString("session", "");
            String key = call.getString("key", "").trim();
            JSObject configuration = call.getObject("configuration");
            if (id.isEmpty() || key.isEmpty() || key.contains("\n") || key.contains("\r")
                    || configuration == null || !"session.create".equals(configuration.optString("type"))) {
                opening.remove(id);
                call.reject("Enter a Doubao Speech API key with Seeduplex enabled"); return;
            }
            Session session = new Session(id);
            synchronized (this) {
                if (!opening.remove(id)) { call.reject("Native voice session cancelled"); return; }
                if (active != null && (active.closed || active.error != null)) release(active);
                if (active != null) { call.reject("A live speech session is already running"); return; }
                active = session;
            }
            try {
                NativeVoiceAudio nativeAudio = new NativeVoiceAudio(
                    (playing) -> emit(session, new JSObject().put("type", "audio.playing").put("playing", playing))
                );
                synchronized (this) {
                    if (session.closed) { nativeAudio.close(); throw new IOException("Native voice session cancelled"); }
                    session.audio = nativeAudio;
                }
                Request request = new Request.Builder()
                    .url("wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue")
                    .header("X-Api-Key", key).build();
                WebSocket connected = client.newWebSocket(request, new WebSocketListener() {
                    @Override public void onOpen(WebSocket socket, Response response) {
                        if (session.closed) { socket.cancel(); return; }
                        if (!socket.send(configuration.toString())) fail(session, "Unable to send live speech configuration");
                    }
                    @Override public void onMessage(WebSocket socket, String text) {
                        if (session.closed) return;
                        try {
                            if (text.length() > 2 * 1024 * 1024) throw new IOException("Live speech response is too large");
                            JSONObject event = new JSONObject(text);
                            String type = event.optString("type");
                            if ("response.done".equals(type)) session.replyAllowed = false;
                            if (session.audio != null) {
                                if ("response.output_audio.delta".equals(type)) {
                                    if (session.replyAllowed) session.audio.play(Base64.decode(event.optString("audio", event.optString("delta", "")), Base64.DEFAULT));
                                    return; // PCM is consumed natively; do not duplicate base64 traffic through WebView.
                                }
                            }
                            if ("error".equals(type)) {
                                JSONObject detail = event.optJSONObject("error");
                                String message = event.optString("message", detail == null ? "The live speech service returned an error" : detail.optString("message", "The live speech service returned an error"));
                                long code = event.optLong("status_code", event.optLong("code", detail == null ? 0 : detail.optLong("code", 0)));
                                fail(session, message + (code == 0 ? "" : " [" + code + "]")); return;
                            }
                            emit(session, event);
                            if ("session.created".equals(type)) session.ready.countDown();
                            if ("session.closed".equals(type)) fail(session, "The live speech session ended");
                        } catch (Exception error) { fail(session, error.getMessage()); }
                    }
                    @Override public void onFailure(WebSocket socket, Throwable error, Response response) {
                        fail(session, response == null ? "Live speech connection failed; check the network"
                            : "Live speech connection failed (HTTP " + response.code() + "); check the key and Seeduplex permissions");
                    }
                    @Override public void onClosing(WebSocket socket, int code, String reason) {
                        socket.close(code, null);
                        fail(session, "Live speech connection interrupted");
                    }
                });
                synchronized (this) {
                    if (session.closed) { connected.cancel(); throw new IOException("Native voice session cancelled"); }
                    session.socket = connected;
                }
                if (!session.ready.await(12, TimeUnit.SECONDS)) throw new IOException("Live speech connection timed out");
                if (session.error != null) throw new IOException(session.error);
                if (session.closed) throw new IOException("Native voice session cancelled");
                call.resolve(new JSObject().put("session", id));
            } catch (Exception error) { release(session); call.reject(error.getMessage()); }
        });
    }
    @PluginMethod public void interruptAudio(PluginCall call) {
        Session session = active;
        if (session != null && session.id.equals(call.getString("session")) && session.audio != null) session.audio.interrupt();
        call.resolve();
    }
    @PluginMethod public void send(PluginCall call) {
        worker.execute(() -> {
            try {
                Session session = active;
                if (session == null || session.closed || !session.id.equals(call.getString("session"))) throw new IOException("The live speech session ended");
                if (session.error != null) throw new IOException(session.error);
                JSObject event = call.getObject("event");
                if (event == null || event.toString().length() > 1024 * 1024) throw new IOException("Invalid live speech event");
                String type = event.optString("type");
                if (!("input_audio_mute.commit".equals(type) || "response.cancel".equals(type) ||
                      "speech_text_buffer.replacement.append".equals(type) || "speech_text_buffer.replacement.commit".equals(type))) {
                    throw new IOException("Only text speech output events are supported");
                }
                send(session, event); call.resolve();
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    private void send(Session session, JSONObject event) throws IOException {
        if (session != active || session.closed || session.error != null) throw new IOException("The live speech session ended");
        String type = event.optString("type");
        if ("response.cancel".equals(type)) { session.replyAllowed = false; if (session.audio != null) session.audio.interrupt(); }
        if ("speech_text_buffer.replacement.append".equals(type)) session.replyAllowed = true;
        if (session.socket.queueSize() > 320000 || !session.socket.send(event.toString())) throw new IOException("Live speech upload is too slow");
    }
    private synchronized void release(Session session) {
        if (session.closed) return;
        session.closed = true;
        session.ready.countDown();
        if (session.audio != null) session.audio.close();
        if (session.socket != null) session.socket.cancel();
        if (active == session) active = null;
    }
    @PluginMethod public synchronized void stop(PluginCall call) {
        String id = call.getString("session", "");
        opening.remove(id);
        Session session = active;
        if (session != null && session.id.equals(id)) {
            if (session.socket != null) session.socket.send("{\"type\":\"session.close\"}");
            release(session);
        }
        call.resolve();
    }
    @Override protected void handleOnDestroy() {
        opening.clear();
        if (active != null) release(active);
        worker.shutdownNow(); client.dispatcher().executorService().shutdown(); client.connectionPool().evictAll();
    }
}
