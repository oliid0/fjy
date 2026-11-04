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
import java.util.concurrent.ScheduledThreadPoolExecutor;
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
    private final ScheduledThreadPoolExecutor audio = new ScheduledThreadPoolExecutor(1);
    private final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS).pingInterval(20, TimeUnit.SECONDS).build();
    private volatile Session active;
    private static final class Session {
        final String id;
        final CountDownLatch ready = new CountDownLatch(1);
        volatile boolean closed;
        volatile String error;
        long nextAudioAt;
        WebSocket socket;
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
    }
    @PluginMethod public void start(PluginCall call) {
        worker.execute(() -> {
            if (active != null) { call.reject("已有实时语音会话正在运行"); return; }
            String id = call.getString("session", "");
            String key = call.getString("key", "").trim();
            JSObject configuration = call.getObject("configuration");
            if (id.isEmpty() || key.isEmpty() || key.contains("\n") || key.contains("\r")
                    || configuration == null || !"session.create".equals(configuration.optString("type"))) {
                call.reject("请填写已开通 Seeduplex 的豆包语音 API Key"); return;
            }
            Session session = new Session(id); active = session;
            try {
                Request request = new Request.Builder()
                    .url("wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue")
                    .header("X-Api-Key", key).build();
                session.socket = client.newWebSocket(request, new WebSocketListener() {
                    @Override public void onOpen(WebSocket socket, Response response) {
                        if (!socket.send(configuration.toString())) fail(session, "无法发送实时语音配置");
                    }
                    @Override public void onMessage(WebSocket socket, String text) {
                        if (session.closed) return;
                        try {
                            if (text.length() > 2 * 1024 * 1024) throw new IOException("实时语音响应过大");
                            JSONObject event = new JSONObject(text);
                            String type = event.optString("type");
                            if ("error".equals(type)) {
                                fail(session, event.optString("message", "实时语音服务返回错误")); return;
                            }
                            emit(session, event);
                            if ("session.created".equals(type)) session.ready.countDown();
                            if ("session.closed".equals(type)) fail(session, "实时语音会话已结束");
                        } catch (Exception error) { fail(session, error.getMessage()); }
                    }
                    @Override public void onFailure(WebSocket socket, Throwable error, Response response) {
                        fail(session, response == null ? "实时语音连接失败，请检查网络"
                            : "实时语音连接失败 (HTTP " + response.code() + ")，请检查密钥与 Seeduplex 权限");
                    }
                    @Override public void onClosing(WebSocket socket, int code, String reason) {
                        socket.close(code, null);
                        fail(session, "实时语音连接中断");
                    }
                });
                if (!session.ready.await(12, TimeUnit.SECONDS)) throw new IOException("实时语音连接超时");
                if (session.error != null) throw new IOException(session.error);
                call.resolve(new JSObject().put("session", id));
            } catch (Exception error) { release(session); call.reject(error.getMessage()); }
        });
    }
    @PluginMethod public void send(PluginCall call) {
        worker.execute(() -> {
            try {
                Session session = active;
                if (session == null || session.closed || !session.id.equals(call.getString("session"))) throw new IOException("实时语音会话已结束");
                if (session.error != null) throw new IOException(session.error);
                JSObject event = call.getObject("event");
                if (event == null || event.toString().length() > 1024 * 1024) throw new IOException("无效的实时语音事件");
                if ("input_audio_buffer.commit".equals(event.optString("type"))) {
                    // Commit follows every already accepted microphone frame.
                    audio.schedule(() -> {
                        try { send(session, event); call.resolve(); }
                        catch (Exception error) { call.reject(error.getMessage()); }
                    }, Math.max(0, session.nextAudioAt - System.nanoTime()), TimeUnit.NANOSECONDS);
                } else {
                    send(session, event); call.resolve();
                }
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    private void send(Session session, JSONObject event) throws IOException {
        if (session != active || session.closed || session.error != null) throw new IOException("实时语音会话已结束");
        if (session.socket.queueSize() > 320000 || !session.socket.send(event.toString())) throw new IOException("实时语音网络发送过慢");
    }
    /** One 100 ms bridge transfer, then the documented 640-byte frames paced at 20 ms.
     * Do not make 50 sequential UI/bridge round trips per second on a teaching display. */
    @PluginMethod public void pushAudio(PluginCall call) {
        worker.execute(() -> {
            try {
                Session session = active;
                if (session == null || session.closed || !session.id.equals(call.getString("session"))) throw new IOException("实时语音会话已结束");
                String encoded = call.getString("pcm", "");
                if (call.getInt("sampleRate", 0) != 16000 || encoded.length() > 8600) throw new IOException("实时语音需要16 kHz PCM");
                byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                if (bytes.length == 0 || bytes.length > 6400 || bytes.length % 2 != 0) throw new IOException("无效的实时音频片段");
                long now = System.nanoTime();
                if (session.nextAudioAt - now > TimeUnit.SECONDS.toNanos(2)) throw new IOException("实时音频发送积压，请检查网络后重新开始");
                for (int offset = 0; offset < bytes.length; offset += 640) {
                    byte[] frame = java.util.Arrays.copyOfRange(bytes, offset, Math.min(bytes.length, offset + 640));
                    JSONObject event = new JSObject().put("type", "input_audio_buffer.append")
                        .put("audio", Base64.encodeToString(frame, Base64.NO_WRAP));
                    long at = Math.max(now, session.nextAudioAt);
                    session.nextAudioAt = at + TimeUnit.MILLISECONDS.toNanos(20);
                    audio.schedule(() -> {
                        if (session == active && !session.closed && session.error == null) {
                            try { send(session, event); }
                            catch (Exception error) { fail(session, error.getMessage()); }
                        }
                    }, Math.max(0, at - System.nanoTime()), TimeUnit.NANOSECONDS);
                }
                call.resolve();
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    private void release(Session session) {
        session.closed = true;
        session.ready.countDown();
        if (session.socket != null) session.socket.cancel();
        if (active == session) active = null;
    }
    @PluginMethod public void stop(PluginCall call) {
        worker.execute(() -> {
            Session session = active;
            if (session != null && session.id.equals(call.getString("session"))) {
                session.socket.send("{\"type\":\"session.close\"}");
                release(session);
            }
            call.resolve();
        });
    }
    @Override protected void handleOnDestroy() {
        if (active != null) release(active);
        audio.shutdownNow();
        worker.shutdownNow(); client.dispatcher().executorService().shutdown(); client.connectionPool().evictAll();
    }
}
