package com.fcjy.fcboard;

import fi.iki.elonen.NanoHTTPD;
import java.io.ByteArrayInputStream;
import java.util.List;
import java.util.UUID;

/** Read-only, short-lived page sharing. No filesystem paths are exposed to the LAN. */
final class BoardShareServer extends NanoHTTPD {
    final String token = UUID.randomUUID().toString();
    private final List<byte[]> images;
    private final long expiresAt;
    private volatile String password = "";
    private final java.util.Set<String> authorized = java.util.concurrent.ConcurrentHashMap.newKeySet();

    BoardShareServer(List<byte[]> images, long lifetimeMillis) {
        super(0);
        this.images = java.util.Collections.unmodifiableList(new java.util.ArrayList<>(images));
        expiresAt = System.nanoTime() + lifetimeMillis * 1_000_000;
    }

    /** QRHttpPopu + ScreenshotPwdUtils: disabled by default, four numeric digits when enabled. */
    synchronized void setPassword(String value) {
        if (value == null || (!value.isEmpty() && !value.matches("[0-9]{4}"))) {
            throw new IllegalArgumentException("The password must contain four digits");
        }
        password = value;
        authorized.clear();
    }

    private boolean hasAccess(IHTTPSession session) {
        if (password.isEmpty()) return true;
        String cookies = session.getHeaders().get("cookie");
        if (cookies == null) return false;
        for (String cookie : cookies.split(";")) {
            String value = cookie.trim();
            if (value.startsWith("fcboard-share=") && authorized.contains(value.substring(14))) return true;
        }
        return false;
    }

    @Override public Response serve(IHTTPSession session) {
        if (session.getMethod() != Method.GET && session.getMethod() != Method.HEAD && session.getMethod() != Method.POST) {
            return newFixedLengthResponse(Response.Status.METHOD_NOT_ALLOWED, "text/plain", "Read only");
        }
        String root = "/" + token;
        String uri = session.getUri();
        if (!uri.equals(root) && !uri.startsWith(root + "/")) {
            return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found");
        }
        if (System.nanoTime() >= expiresAt) {
            return newFixedLengthResponse(Response.Status.GONE, "text/plain; charset=utf-8", "Sharing ended; scan a new QR code");
        }
        Response response;
        boolean isIndex = uri.equals(root) || uri.equals(root + "/");
        String cookie = null;
        boolean incorrect = false;
        if (session.getMethod() == Method.POST) {
            if (!isIndex) return newFixedLengthResponse(Response.Status.METHOD_NOT_ALLOWED, "text/plain", "Read only");
            try {
                session.parseBody(new java.util.HashMap<>());
                String value = session.getParms().get("password");
                synchronized (this) {
                    if (!password.isEmpty() && value != null && java.security.MessageDigest.isEqual(
                            password.getBytes(java.nio.charset.StandardCharsets.UTF_8), value.getBytes(java.nio.charset.StandardCharsets.UTF_8))) {
                        cookie = UUID.randomUUID().toString(); authorized.add(cookie);
                    } else if (!password.isEmpty()) incorrect = true;
                }
            } catch (Exception error) {
                return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain; charset=utf-8", "Invalid password format");
            }
        }
        // The reference photo.html shows this form only when protection is on.
        // Enforce that same choice on image requests as well, rather than exposing /getPhoto.
        if (cookie == null && !hasAccess(session)) {
            if (!isIndex) return newFixedLengthResponse(Response.Status.FORBIDDEN, "text/plain; charset=utf-8", PageLocalization.text("password"));
            response = newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8",
                "<!doctype html><html lang='" + PageLocalization.language() + "'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>" + PageLocalization.html("shareTitle") + "</title>"
                + "<form method='post'><label>" + PageLocalization.html("password") + "<input name='password' inputmode='numeric' pattern='[0-9]{4}' maxlength='4' autocomplete='off' required></label><button>" + PageLocalization.html("confirm") + "</button>"
                + (incorrect ? "<p role='alert'>" + PageLocalization.html("incorrectPassword") + "</p>" : "") + "</form></html>");
            response.addHeader("Cache-Control", "no-store");
            response.addHeader("Content-Security-Policy", "default-src 'none'; form-action 'self'; frame-ancestors 'none'");
            return response;
        }
        if (isIndex) {
            StringBuilder html = new StringBuilder("<!doctype html><html lang='" + PageLocalization.language() + "'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>" + PageLocalization.html("pageShareTitle") + "</title><style>body{margin:24px;font:18px system-ui;background:#f5f7fa;color:#17243c}img{display:block;max-width:100%;margin:16px 0;background:white}a{display:inline-block;padding:12px;color:#245bd6}section{margin-bottom:32px}</style><h1>" + PageLocalization.html("pageShareTitle") + "</h1><p>" + PageLocalization.html("shareExpiry") + "</p>");
            for (int index = 0; index < images.size(); index++) {
                String path = root + "/page-" + index + ".png";
                html.append("<section><h2>").append(PageLocalization.html("page", "number", index + 1)).append("</h2><a download='Fcboard-").append(index + 1).append(".png' href='").append(path).append("?download=1'>" + PageLocalization.html("downloadPage") + "</a><img alt='" + PageLocalization.html("boardPage") + "' src='").append(path).append("'></section>");
            }
            response = newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", html.append("</html>").toString());
            response.addHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'");
            if (cookie != null) response.addHeader("Set-Cookie", "fcboard-share=" + cookie + "; Path=" + root + "; HttpOnly; SameSite=Strict");
        } else {
            int index = -1;
            for (int candidate = 0; candidate < images.size(); candidate++) {
                if (uri.equals(root + "/page-" + candidate + ".png")) { index = candidate; break; }
            }
            if (index < 0) return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found");
            byte[] image = images.get(index);
            response = newFixedLengthResponse(Response.Status.OK, "image/png", new ByteArrayInputStream(image), image.length);
            if ("1".equals(session.getParms().get("download"))) response.addHeader("Content-Disposition", "attachment; filename=Fcboard-" + (index + 1) + ".png");
        }
        response.addHeader("Cache-Control", "no-store");
        response.addHeader("X-Content-Type-Options", "nosniff");
        return response;
    }
}
