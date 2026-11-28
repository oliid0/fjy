package com.fcjy.fcboard;

import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
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
@CapacitorPlugin(name = "FcboardCloudSpeech")
public class CloudSpeechPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
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
    }

    @PluginMethod public void start(PluginCall call) {
        worker.execute(() -> {
            if (active != null) { call.reject("A cloud speech task is already running"); return; }
            String key = call.getString("key", "").trim();
            String resource = call.getString("resource", "volc.seedasr.sauc.duration");
            if (key.isEmpty() || key.contains("\n") || key.contains("\r")
                    || !resource.matches("volc\\.(seedasr|bigasr)\\.sauc\\.(duration|concurrent)")) {
                call.reject("Enter an enabled Doubao Speech API key and resource ID in voice settings"); return;
            }
            boolean separateSpeakers = Boolean.TRUE.equals(call.getBoolean("separateSpeakers", false));
            Session session = new Session(); active = session;
            try {
                Request request = new Request.Builder()
                    .url("wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async")
                    .header("X-Api-Key", key).header("X-Api-Resource-Id", resource)
                    .header("X-Api-Request-Id", session.id).header("X-Api-Connect-Id", session.id).build();
                session.socket = client.newWebSocket(request, new WebSocketListener() {
                    @Override public void onOpen(WebSocket socket, Response response) {
                        try {
                            if (!socket.send(ByteString.of(DoubaoSpeechProtocol.frame(1, 1, DoubaoSpeechProtocol.configuration(separateSpeakers))))) {
                                throw new IOException("Unable to send speech configuration");
                            }
                            session.opened.countDown();
                        } catch (Exception error) { fail(session, "Unable to configure Doubao speech"); }
                    }
                    @Override public void onMessage(WebSocket socket, ByteString bytes) {
                        try {
                            DoubaoSpeechProtocol.Response response = DoubaoSpeechProtocol.parse(bytes.toByteArray());
                            synchronized (session) {
                                JSONArray lines = session.protocol.lines(response.body);
                                session.interim = DoubaoSpeechProtocol.interim(response.body);
                                session.activity |= session.interim != null;
                                if (session.pending.length() + lines.length() > 1000) { throw new IOException("Speech transcript consumption is too slow"); }
                                for (int i = 0; i < lines.length(); i++) { session.pending.put(lines.get(i)); }
                            }
                            session.opened.countDown();
                            if (response.last) {
                                session.ended.countDown();
                                if (!session.stopping) { fail(session, "Cloud speech ended; start a new session"); }
                            }
                        } catch (Exception error) { fail(session, error.getMessage()); }
                    }
                    @Override public void onFailure(WebSocket socket, Throwable error, Response response) {
                        fail(session, response == null ? "Speech connection failed; check the network"
                            : "Speech connection failed (HTTP " + response.code() + "); check the speech key and resource permissions");
                    }
                    @Override public void onClosing(WebSocket socket, int code, String reason) {
                        socket.close(code, null);
                        if (!session.stopping || session.ended.getCount() != 0) { fail(session, "Cloud speech connection interrupted"); }
                    }
                });
                if (!session.opened.await(12, TimeUnit.SECONDS)) { throw new IOException("Speech connection timed out"); }
                if (session.error != null) { throw new IOException(session.error); }
                JSObject result = new JSObject(); result.put("session", session.id); call.resolve(result);
            } catch (Exception error) {
                release(session); call.reject(error.getMessage());
            }
        });
    }

    private void fail(Session session, String message) {
        session.error = message; session.opened.countDown(); session.ended.countDown();
        if (session.socket != null) { session.socket.cancel(); }
    }
    private Session require(PluginCall call) throws IOException {
        Session session = active;
        if (session == null || !session.id.equals(call.getString("session"))) { throw new IOException("The cloud speech task ended"); }
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
                if (call.getInt("sampleRate", 0) != 16000 || encoded.length() > 44000) { throw new IOException("Cloud speech requires 16 kHz PCM audio"); }
                byte[] pcm = Base64.decode(encoded, Base64.DEFAULT);
                if (pcm.length == 0 || pcm.length % 2 != 0 || pcm.length > 32000) { throw new IOException("Invalid speech audio segment"); }
                if (session.socket.queueSize() > 320000 || !session.socket.send(ByteString.of(
                        DoubaoSpeechProtocol.frame(2, ++session.sequence, pcm)))) { throw new IOException("Speech upload is too slow; check the connection"); }
                call.resolve(drain(session));
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    @PluginMethod public void stop(PluginCall call) {
        worker.execute(() -> {
            Session session = active;
            if (session == null || !session.id.equals(call.getString("session"))) { call.reject("The cloud speech task ended"); return; }
            try {
                session.stopping = true;
                if (call.getBoolean("discard", false)) { call.resolve(new JSObject().put("lines", new JSArray())); return; }
                if (session.error != null) { throw new IOException(session.error); }
                if (!session.socket.send(ByteString.of(DoubaoSpeechProtocol.frame(2, -(++session.sequence), new byte[0])))
                        || !session.ended.await(5, TimeUnit.SECONDS)) { throw new IOException("Timed out while finalizing the cloud transcript"); }
                if (session.error != null) { throw new IOException(session.error); }
                call.resolve(drain(session));
            } catch (Exception error) { call.reject(error.getMessage()); }
            finally { release(session); }
        });
    }
    private void release(Session session) {
        session.stopping = true;
        if (session.socket != null) { session.socket.cancel(); }
        if (active == session) { active = null; }
    }
    @Override protected void handleOnDestroy() {
        Session session = active;
        if (session != null) { release(session); }
        worker.shutdownNow(); client.dispatcher().executorService().shutdown(); client.connectionPool().evictAll();
    }
}
