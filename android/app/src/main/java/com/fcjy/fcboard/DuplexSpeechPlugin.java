package com.fcjy.fcboard;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;
import android.Manifest;
import java.io.IOException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ScheduledFuture;
import android.util.Base64;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import org.json.JSONObject;

/** Seeduplex 3.0 JSON protocol, separate from SAUC's binary ASR framing.
 * Reference: supplied speech PDF pp. 125–137 and the official web_duplex_demo. */
@CapacitorPlugin(name = "FcboardDuplexSpeech", permissions = {
    @Permission(strings = {Manifest.permission.RECORD_AUDIO}, alias = "microphone")
})
public class DuplexSpeechPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ScheduledThreadPoolExecutor audio = new ScheduledThreadPoolExecutor(1);
    private final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS).pingInterval(20, TimeUnit.SECONDS).build();
    private volatile Session active;
    private final java.util.Set<String> opening = java.util.concurrent.ConcurrentHashMap.newKeySet();
    private static final class Session {
        final String id;
        final CountDownLatch ready = new CountDownLatch(1);
        volatile boolean closed;
        volatile String error;
        long nextAudioAt;
        volatile WebSocket socket;
        volatile NativeVoiceAudio audio;
        volatile boolean nativeCapture;
        final ArrayBlockingQueue<byte[]> input = new ArrayBlockingQueue<>(100);
        volatile long lastCapture;
        volatile ScheduledFuture<?> inputPump;
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
        if (session.inputPump != null) session.inputPump.cancel(false);
        session.input.clear();
        if (session.socket != null) session.socket.cancel();
        if (session.audio != null) session.audio.close();
    }
    @PluginMethod public void start(PluginCall call) {
        String id = call.getString("session", "");
        if (id.isEmpty() || !opening.add(id)) { call.reject("Invalid or duplicate voice session"); return; }
        if (call.getBoolean("capture", false) && getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermission"); return;
        }
        startSession(call);
    }
    @PermissionCallback private void microphonePermission(PluginCall call) {
        if (!opening.contains(call.getString("session", ""))) { call.reject("Native voice session cancelled"); return; }
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            opening.remove(call.getString("session", ""));
            call.reject("Microphone permission denied"); return;
        }
        startSession(call);
    }
    @PluginMethod public void audioCapabilities(PluginCall call) {
        call.resolve(new JSObject().put("nativeAudio", true));
    }
    private void startSession(PluginCall call) {
        worker.execute(() -> {
            String id = call.getString("session", "");
            String key = call.getString("key", "").trim();
            JSObject configuration = call.getObject("configuration");
            if (id.isEmpty() || key.isEmpty() || key.contains("\n") || key.contains("\r")
                    || configuration == null || !"session.create".equals(configuration.optString("type"))) {
                opening.remove(id);
                call.reject("请填写已开通 Seeduplex 的豆包语音 API Key"); return;
            }
            Session session = new Session(id);
            synchronized (this) {
                if (!opening.remove(id)) { call.reject("Native voice session cancelled"); return; }
                if (active != null && (active.closed || active.error != null)) release(active);
                if (active != null) { call.reject("已有实时语音会话正在运行"); return; }
                active = session;
            }
            try {
                if (call.getBoolean("playback", false)) {
                    NativeVoiceAudio nativeAudio = new NativeVoiceAudio(getContext(),
                        (pcm) -> {
                            session.lastCapture = System.nanoTime();
                            if (session.nativeCapture && session.socket != null && session.ready.getCount() == 0 && !session.closed && session.error == null) {
                                if (!session.input.offer(pcm)) fail(session, "Native microphone sending backlog");
                            }
                        },
                        (message) -> fail(session, message),
                        (playing) -> emit(session, new JSObject().put("type", "audio.playing").put("playing", playing))
                    );
                    synchronized (this) {
                        if (session.closed) { nativeAudio.close(); throw new IOException("Native voice session cancelled"); }
                        session.audio = nativeAudio;
                    }
                    if (call.getBoolean("capture", false)) {
                        session.nativeCapture = true;
                        session.audio.startCapture();
                    }
                }
                Request request = new Request.Builder()
                    .url("wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue")
                    .header("X-Api-Key", key).build();
                WebSocket connected = client.newWebSocket(request, new WebSocketListener() {
                    @Override public void onOpen(WebSocket socket, Response response) {
                        if (session.closed) { socket.cancel(); return; }
                        if (!socket.send(configuration.toString())) fail(session, "无法发送实时语音配置");
                    }
                    @Override public void onMessage(WebSocket socket, String text) {
                        if (session.closed) return;
                        try {
                            if (text.length() > 2 * 1024 * 1024) throw new IOException("实时语音响应过大");
                            JSONObject event = new JSONObject(text);
                            String type = event.optString("type");
                            if (session.audio != null) {
                                if ("conversation.item.input_audio_transcription.started".equals(type) || "response.canceled".equals(type)) session.audio.interrupt();
                                if ("response.output_audio.delta".equals(type)) {
                                    session.audio.play(Base64.decode(event.optString("audio", event.optString("delta", "")), Base64.DEFAULT));
                                    return; // PCM is consumed natively; do not duplicate base64 traffic through WebView.
                                }
                            }
                            if ("error".equals(type)) {
                                JSONObject detail = event.optJSONObject("error");
                                String message = event.optString("message", detail == null ? "实时语音服务返回错误" : detail.optString("message", "实时语音服务返回错误"));
                                long code = event.optLong("status_code", event.optLong("code", detail == null ? 0 : detail.optLong("code", 0)));
                                fail(session, message + (code == 0 ? "" : " [" + code + "]")); return;
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
                synchronized (this) {
                    if (session.closed) { connected.cancel(); throw new IOException("Native voice session cancelled"); }
                    session.socket = connected;
                }
                if (!session.ready.await(12, TimeUnit.SECONDS)) throw new IOException("实时语音连接超时");
                if (session.error != null) throw new IOException(session.error);
                if (session.closed) throw new IOException("Native voice session cancelled");
                synchronized (this) {
                    if (session.closed || session.error != null) throw new IOException("Native voice session unavailable");
                    if (session.audio != null) {
                        audio.setRemoveOnCancelPolicy(true);
                        session.inputPump = audio.scheduleAtFixedRate(() -> {
                            if (!session.nativeCapture || session.closed || session.error != null || active != session) return;
                            if (System.nanoTime() - session.lastCapture > TimeUnit.SECONDS.toNanos(12)) { fail(session, "Native microphone stopped providing PCM"); return; }
                            byte[] pcm = session.input.poll();
                            if (pcm == null) pcm = new byte[640];
                            try { send(session, new JSObject().put("type", "input_audio_buffer.append").put("audio", Base64.encodeToString(pcm, Base64.NO_WRAP))); }
                            catch (Exception error) { fail(session, error.getMessage()); }
                        }, 0, 20, TimeUnit.MILLISECONDS);
                    }
                }
                call.resolve(new JSObject().put("session", id));
            } catch (Exception error) { release(session); call.reject(error.getMessage()); }
        });
    }
    @PluginMethod public void interruptAudio(PluginCall call) {
        Session session = active;
        if (session != null && session.id.equals(call.getString("session")) && session.audio != null) session.audio.interrupt();
        call.resolve();
    }
    @PluginMethod public void captureMode(PluginCall call) {
        worker.execute(() -> {
            try {
                Session session = active;
                if (session == null || session.closed || session.error != null || !session.id.equals(call.getString("session")) || session.audio == null) throw new IOException("Native voice session unavailable");
                String mode = call.getString("mode", "");
                if (!mode.equals("native") && !mode.equals("shared") && !mode.equals("muted")) throw new IOException("Invalid microphone handoff");
                session.nativeCapture = false;
                session.input.clear();
                session.audio.stopCapture();
                send(session, new JSObject().put("type", mode.equals("muted") ? "input_audio_mute.commit" : "input_audio_unmute.commit"));
                if (mode.equals("native")) {
                    session.lastCapture = System.nanoTime();
                    session.nativeCapture = true;
                    session.audio.startCapture();
                }
                call.resolve();
            } catch (Exception error) { call.reject(error.getMessage()); }
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
    private synchronized void release(Session session) {
        if (session.closed) return;
        session.closed = true;
        session.ready.countDown();
        if (session.inputPump != null) session.inputPump.cancel(false);
        session.input.clear();
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
        audio.shutdownNow();
        worker.shutdownNow(); client.dispatcher().executorService().shutdown(); client.connectionPool().evictAll();
    }
}
