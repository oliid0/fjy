package com.fcjy.fcboard;

import java.io.InputStreamReader;
import java.io.IOException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Dispatcher;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/** Incremental UTF-8 HTTP transport. No model rules, credentials or responses are persisted. */
final class AIStreamTransport {
    interface Callback {
        void chunk(String text);
        void complete(int status, String data, boolean stream);
        void failed(Exception error);
    }
    private final Map<String, Call> active = new ConcurrentHashMap<>();
    private final OkHttpClient client;
    private boolean closed;

    AIStreamTransport() {
        Dispatcher dispatcher = new Dispatcher();
        dispatcher.setMaxRequests(64);
        dispatcher.setMaxRequestsPerHost(64);
        client = new OkHttpClient.Builder().dispatcher(dispatcher)
            .followRedirects(false).followSslRedirects(false)
            .retryOnConnectionFailure(false)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS).build();
    }

    static URL checkedURL(String value) throws Exception {
        URL url = new URL(value);
        String host = url.getHost();
        boolean local = "localhost".equals(host);
        String[] parts = host.split("\\.");
        if (parts.length == 4) {
            int[] octets = new int[4];
            boolean valid = true;
            for (int i = 0; i < 4; i++) {
                try { octets[i] = Integer.parseInt(parts[i]); }
                catch (NumberFormatException error) { valid = false; }
                if (octets[i] < 0 || octets[i] > 255) valid = false;
            }
            local |= valid && (octets[0] == 127 || octets[0] == 10 ||
                (octets[0] == 192 && octets[1] == 168) ||
                (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31));
        }
        if (!("https".equals(url.getProtocol()) || ("http".equals(url.getProtocol()) && local)) || url.getUserInfo() != null) {
            throw new IOException("Invalid AI endpoint");
        }
        return url;
    }

    synchronized void start(String id, String endpoint, Map<String, String> headers, String body, Callback callback) throws Exception {
        if (closed || id == null || active.containsKey(id)) throw new IOException("AI transport unavailable");
        URL url = checkedURL(endpoint);
        if (body == null || body.length() > 24_000_000) throw new IOException("Invalid AI request");
        Request.Builder builder = new Request.Builder().url(url)
            .post(RequestBody.create(body, MediaType.get("application/json; charset=utf-8")));
        for (Map.Entry<String, String> header : headers.entrySet()) builder.header(header.getKey(), header.getValue());
        Call request = client.newCall(builder.build());
        active.put(id, request);
        request.enqueue(new okhttp3.Callback() {
            @Override public void onFailure(Call call, IOException error) {
                active.remove(id, call);
                callback.failed(error);
            }
            @Override public void onResponse(Call call, Response response) {
                try (Response received = response) {
                    int status = received.code();
                    String type = received.header("Content-Type", "");
                    boolean stream = status >= 200 && status < 300 && type.contains("text/event-stream");
                    StringBuilder data = new StringBuilder();
                    if (received.body() != null) try (InputStreamReader reader = new InputStreamReader(received.body().byteStream(), StandardCharsets.UTF_8)) {
                        char[] buffer = new char[2048];
                        int count;
                        int total = 0;
                        while ((count = reader.read(buffer)) != -1) {
                            if (call.isCanceled()) throw new IOException("AI request cancelled");
                            total += count;
                            // Image generation shares this cancellable transport (bounded base64 PNG).
                            if (total > 32_000_000) throw new IOException("AI response too large");
                            String chunk = new String(buffer, 0, count);
                            if (stream) callback.chunk(chunk); else data.append(chunk);
                        }
                    }
                    if (call.isCanceled()) throw new IOException("AI request cancelled");
                    active.remove(id, call);
                    callback.complete(status, data.toString(), stream);
                } catch (Exception error) {
                    active.remove(id, call);
                    callback.failed(error);
                }
            }
        });
    }

    void cancel(String id) {
        Call request = id == null ? null : active.get(id);
        if (request != null) request.cancel();
    }
    synchronized void close() {
        closed = true;
        client.dispatcher().cancelAll();
        client.dispatcher().executorService().shutdown();
        client.connectionPool().evictAll();
        active.clear();
    }
}
