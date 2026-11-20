package com.airplay.dlna.transport;

import java.io.*;
import java.net.Socket;
import java.net.URI;
import java.util.*;

final class DlnaRequest {
    /** Longest request/header line kept in memory. */
    private static final int MAX_LINE_BYTES = 8192;
    /** Most header lines kept in memory. */
    private static final int MAX_HEADER_LINES = 100;
    /** Largest body (SOAP envelope) kept in memory. */
    private static final int MAX_BODY_BYTES = 1024 * 1024;

    /**
     * The peer sent more than this server is willing to buffer. Without
     * these caps, one LAN device holding a TCP connection open and dribbling
     * bytes with no line feed grows a ByteArrayOutputStream until the
     * foreground service is killed — and every cast running at the time dies
     * with it. Both cases answer 413 and drop the connection.
     */
    static final class RequestTooLarge extends IOException {
        RequestTooLarge(String what) {
            super("Request " + what + " too large");
        }
    }

    String method;
    URI uri;
    boolean http11;
    Map<String, List<String>> headers = new HashMap<>();
    byte[] body = new byte[0];

    static DlnaRequest read(Socket socket) throws IOException {
        InputStream raw = new BufferedInputStream(socket.getInputStream());

        String requestLine = readLine(raw);
        if (requestLine == null || requestLine.isEmpty()) {
            return null;
        }

        String[] parts = requestLine.split(" ");
        if (parts.length < 2) {
            return null;
        }

        DlnaRequest req = new DlnaRequest();
        req.method = parts[0].toUpperCase(Locale.ROOT);
        try {
            req.uri = URI.create(parts[1]);
        } catch (IllegalArgumentException e) {
            return null;
        }
        req.http11 = parts.length >= 3
                && parts[2].toUpperCase(Locale.ROOT).equals("HTTP/1.1");

        long contentLength = -1;
        int headerLines = 0;
        String line;
        while ((line = readLine(raw)) != null && !line.isEmpty()) {
            if (++headerLines > MAX_HEADER_LINES) {
                throw new RequestTooLarge("headers");
            }
            int colon = line.indexOf(':');
            if (colon > 0) {
                String name = line.substring(0, colon).trim();
                String value = line.substring(colon + 1).trim();
                if (name.equalsIgnoreCase("Content-Length")) {
                    try {
                        contentLength = Long.parseLong(value);
                    } catch (NumberFormatException ignored) {
                    }
                }
                req.headers.computeIfAbsent(name.toLowerCase(Locale.ROOT), k -> new ArrayList<>()).add(value);
            }
        }

        if (contentLength > MAX_BODY_BYTES) {
            throw new RequestTooLarge("body");
        }
        if (contentLength > 0) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            long remaining = contentLength;
            while (remaining > 0) {
                int n = raw.read(buf, 0, (int) Math.min(buf.length, remaining));
                if (n < 0) {
                    break;
                }
                bos.write(buf, 0, n);
                remaining -= n;
            }
            req.body = bos.toByteArray();
        }

        return req;
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') {
                break;
            }
            if (c != '\r') {
                if (bos.size() >= MAX_LINE_BYTES) {
                    throw new RequestTooLarge("line");
                }
                bos.write(c);
            }
        }
        if (bos.size() == 0 && c == -1) {
            return null;
        }
        return new String(bos.toByteArray(), "ISO-8859-1");
    }
    String header(String name) {
        List<String> values = headers.get(name);
        return values == null || values.size() != 1 ? "" : values.get(0);
    }
}
