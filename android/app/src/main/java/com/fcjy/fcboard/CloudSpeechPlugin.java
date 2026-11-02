package com.fcjy.fcboard;

import android.util.Base64;
import android.Manifest;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import com.getcapacitor.PermissionState;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;
import org.json.JSONArray;

/** Native WebSocket carries auth headers; PCM capture is shared with recording. */
@CapacitorPlugin(name = "FcboardCloudSpeech", permissions = {
    @Permission(strings = {Manifest.permission.RECORD_AUDIO}, alias = "microphone")
})
public class CloudSpeechPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService microphone = Executors.newSingleThreadExecutor();
    private final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS).pingInterval(20, TimeUnit.SECONDS).build();
    private volatile Session active;
    private static final class Session {
        final String id = UUID.randomUUID().toString();
        final CountDownLatch opened = new CountDownLatch(1);
        final CountDownLatch ended = new CountDownLatch(1);
        final DoubaoSpeechProtocol protocol = new DoubaoSpeechProtocol();
        final JSONArray pending = new JSONArray();
        volatile String error;
        volatile boolean stopping;
        boolean activity;
        org.json.JSONObject interim;
        WebSocket socket;
        int sequence = 1;
        volatile AudioRecord recorder;
        boolean capture;
    }

    @PluginMethod public void start(PluginCall call) {
        if (call.getBoolean("capture", false) && getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermission"); return;
        }
        worker.execute(() -> {
            if (active != null) { call.reject("已有云端语音任务正在运行"); return; }
            String key = call.getString("key", "").trim();
            String resource = call.getString("resource", "volc.seedasr.sauc.duration");
            if (key.isEmpty() || key.contains("\n") || key.contains("\r")
                    || !resource.matches("volc\\.(seedasr|bigasr)\\.sauc\\.(duration|concurrent)")) {
                call.reject("请在语音设置中填写豆包语音 API Key 与已开通的资源 ID"); return;
            }
            Session session = new Session(); session.capture = call.getBoolean("capture", false); active = session;
            try {
                Request request = new Request.Builder()
                    .url("wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async")
                    .header("X-Api-Key", key).header("X-Api-Resource-Id", resource)
                    .header("X-Api-Request-Id", session.id).header("X-Api-Connect-Id", session.id).build();
                session.socket = client.newWebSocket(request, new WebSocketListener() {
                    @Override public void onOpen(WebSocket socket, Response response) {
                        try {
                            if (!socket.send(ByteString.of(DoubaoSpeechProtocol.frame(1, 1, DoubaoSpeechProtocol.configuration())))) {
                                throw new IOException("无法发送语音配置");
                            }
                            session.opened.countDown();
                        } catch (Exception error) { fail(session, "无法配置豆包语音"); }
                    }
                    @Override public void onMessage(WebSocket socket, ByteString bytes) {
                        try {
                            DoubaoSpeechProtocol.Response response = DoubaoSpeechProtocol.parse(bytes.toByteArray());
                            synchronized (session) {
                                JSONArray lines = session.protocol.lines(response.body);
                                session.interim = DoubaoSpeechProtocol.interim(response.body);
                                session.activity |= session.interim != null;
                                if (session.pending.length() + lines.length() > 1000) { throw new IOException("语音文稿接收过慢"); }
                                for (int i = 0; i < lines.length(); i++) { session.pending.put(lines.get(i)); }
                                if (session.capture) notifyListeners("transcript", drain(session).put("session", session.id));
                            }
                            session.opened.countDown();
                            if (response.last) {
                                session.ended.countDown();
                                if (!session.stopping) { fail(session, "云端语音连接已结束，请重新开启"); }
                            }
                        } catch (Exception error) { fail(session, error.getMessage()); }
                    }
                    @Override public void onFailure(WebSocket socket, Throwable error, Response response) {
                        fail(session, response == null ? "豆包语音连接失败，请检查网络"
                            : "豆包语音连接失败 (HTTP " + response.code() + ")，请检查语音密钥与资源权限");
                    }
                    @Override public void onClosing(WebSocket socket, int code, String reason) {
                        socket.close(code, null);
                        if (!session.stopping || session.ended.getCount() != 0) { fail(session, "云端语音连接中断"); }
                    }
                });
                if (!session.opened.await(12, TimeUnit.SECONDS)) { throw new IOException("豆包语音连接超时"); }
                if (session.error != null) { throw new IOException(session.error); }
                if (session.capture) startMicrophone(session);
                JSObject result = new JSObject(); result.put("session", session.id); call.resolve(result);
            } catch (Exception error) {
                release(session); call.reject(error.getMessage());
            }
        });
    }

    @PermissionCallback private void microphonePermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) start(call);
        else call.reject("请允许麦克风权限后开启语音助手");
    }

    /** Voice-only capture runs independently of WebView rendering and agent work.
     * Recording sessions retain the shared PCM input supplied by the web recorder.
     */
    @android.annotation.SuppressLint("MissingPermission") // start() and microphonePermission() check RECORD_AUDIO before capture.
    private void startMicrophone(Session session) throws Exception {
        int minimum = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (minimum <= 0) throw new IOException("设备不支持16kHz麦克风采集");
        AudioRecord input = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(12800, minimum * 2));
        session.recorder = input;
        if (input.getState() != AudioRecord.STATE_INITIALIZED) throw new IOException("无法初始化麦克风");
        input.startRecording();
        if (input.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) throw new IOException("麦克风没有开始录音");
        microphone.execute(() -> {
            byte[] block = new byte[3200];
            try {
                while (!session.stopping && session.error == null && active == session) {
                    int count = input.read(block, 0, block.length, AudioRecord.READ_BLOCKING);
                    if (session.stopping) break;
                    if (count <= 0 || count % 2 != 0) throw new IOException("麦克风采集失败 (" + count + ")");
                    synchronized (session) {
                        if (!session.stopping && (session.socket.queueSize() > 320000 || !session.socket.send(ByteString.of(
                            DoubaoSpeechProtocol.frame(2, ++session.sequence, java.util.Arrays.copyOf(block, count)))))) {
                            throw new IOException("语音网络发送过慢，请检查连接");
                        }
                    }
                }
            } catch (Exception error) { if (!session.stopping) fail(session, error.getMessage()); }
        });
    }

    private void fail(Session session, String message) {
        if (session.error != null || session.stopping) return;
        session.error = message; session.opened.countDown(); session.ended.countDown();
        if (session.capture) notifyListeners("transcript", new JSObject().put("session", session.id).put("error", message));
        if (session.socket != null) { session.socket.cancel(); }
    }
    private Session require(PluginCall call) throws IOException {
        Session session = active;
        if (session == null || !session.id.equals(call.getString("session"))) { throw new IOException("云端语音任务已结束"); }
        if (session.error != null) { throw new IOException(session.error); }
        return session;
    }
    private JSObject drain(Session session) throws Exception {
        synchronized (session) {
            JSObject result = new JSObject(); result.put("lines", new JSArray(session.pending.toString()));
            result.put("activity", session.activity); session.activity = false;
            result.put("interim", session.interim == null ? org.json.JSONObject.NULL : session.interim);
            while (session.pending.length() > 0) { session.pending.remove(0); }
            return result;
        }
    }
    @PluginMethod public void push(PluginCall call) {
        worker.execute(() -> {
            try {
                Session session = require(call);
                String encoded = call.getString("pcm", "");
                if (call.getInt("sampleRate", 0) != 16000 || encoded.length() > 44000) { throw new IOException("云端语音需要 16 kHz PCM 音频"); }
                byte[] pcm = Base64.decode(encoded, Base64.DEFAULT);
                if (pcm.length == 0 || pcm.length % 2 != 0 || pcm.length > 32000) { throw new IOException("无效的语音片段"); }
                if (session.socket.queueSize() > 320000 || !session.socket.send(ByteString.of(
                        DoubaoSpeechProtocol.frame(2, ++session.sequence, pcm)))) { throw new IOException("语音网络发送过慢，请检查连接"); }
                call.resolve(drain(session));
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    @PluginMethod public void stop(PluginCall call) {
        worker.execute(() -> {
            Session session = active;
            if (session == null || !session.id.equals(call.getString("session"))) { call.reject("云端语音任务已结束"); return; }
            try {
                session.stopping = true;
                stopMicrophone(session);
                if (call.getBoolean("discard", false)) { call.resolve(); return; }
                if (session.error != null) { throw new IOException(session.error); }
                boolean sent;
                synchronized (session) { sent = session.socket.send(ByteString.of(DoubaoSpeechProtocol.frame(2, -(++session.sequence), new byte[0]))); }
                if (!sent
                        || !session.ended.await(5, TimeUnit.SECONDS)) { throw new IOException("云端文稿收尾超时"); }
                if (session.error != null) { throw new IOException(session.error); }
                call.resolve(drain(session));
            } catch (Exception error) { call.reject(error.getMessage()); }
            finally { release(session); }
        });
    }
    private void release(Session session) {
        session.stopping = true;
        stopMicrophone(session);
        if (session.socket != null) { session.socket.cancel(); }
        if (active == session) { active = null; }
    }
    private void stopMicrophone(Session session) {
        AudioRecord input = session.recorder; session.recorder = null;
        if (input != null) {
            try { input.stop(); } catch (Exception ignored) { }
            input.release();
        }
    }
    @Override protected void handleOnDestroy() {
        Session session = active;
        if (session != null) { release(session); }
        worker.shutdownNow(); microphone.shutdownNow(); client.dispatcher().executorService().shutdown(); client.connectionPool().evictAll();
    }
}
