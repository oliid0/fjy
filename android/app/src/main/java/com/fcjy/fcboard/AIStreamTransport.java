package com.fcjy.fcboard;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Incremental UTF-8 HTTP transport. No model rules, credentials or responses are persisted. */
final class AIStreamTransport {
    interface Callback {
        void chunk(String text);
        void complete(int status, String data, boolean stream);
        void failed(Exception error);
    }
    private final Map<String, Request> active = new ConcurrentHashMap<>();
    private final ExecutorService workers = Executors.newFixedThreadPool(4);
    private boolean closed;

    private static final class Request {
        volatile HttpURLConnection connection;
        volatile boolean cancelled;
        void cancel() {
            cancelled = true;
            HttpURLConnection current = connection;
            if (current != null) current.disconnect();
        }
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
        if (closed || id == null || active.size() >= 4 || active.containsKey(id)) throw new IOException("AI transport unavailable");
        URL url = checkedURL(endpoint);
        if (body == null || body.length() > 24_000_000) throw new IOException("Invalid AI request");
        Request request = new Request();
        active.put(id, request);
        workers.execute(() -> {
            try {
                if (request.cancelled) throw new IOException("AI request cancelled");
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                request.connection = connection;
                connection.setInstanceFollowRedirects(false); // Never forward Authorization to a redirect target.
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(90000);
                connection.setDoOutput(true);
                for (Map.Entry<String, String> header : headers.entrySet()) connection.setRequestProperty(header.getKey(), header.getValue());
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(bytes.length);
                if (request.cancelled) throw new IOException("AI request cancelled");
                try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
                int status = connection.getResponseCode();
                String type = connection.getContentType();
                boolean stream = status >= 200 && status < 300 && type != null && type.contains("text/event-stream");
                InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                StringBuilder data = new StringBuilder();
                if (input != null) try (InputStreamReader reader = new InputStreamReader(input, StandardCharsets.UTF_8)) {
                    char[] buffer = new char[2048];
                    int count;
                    int total = 0;
                    while ((count = reader.read(buffer)) != -1) {
                        if (request.cancelled) throw new IOException("AI request cancelled");
                        total += count;
                        if (total > 8_000_000) throw new IOException("AI response too large");
                        String chunk = new String(buffer, 0, count);
                        if (stream) callback.chunk(chunk); else data.append(chunk);
                    }
                }
                if (request.cancelled) throw new IOException("AI request cancelled");
                callback.complete(status, data.toString(), stream);
            } catch (Exception error) { callback.failed(error); }
            finally {
                active.remove(id, request);
                request.cancel();
            }
        });
    }

    void cancel(String id) { Request request = id == null ? null : active.get(id); if (request != null) request.cancel(); }
    synchronized void close() {
        closed = true;
        for (Request request : active.values()) request.cancel();
        workers.shutdownNow();
        active.clear();
    }
}
