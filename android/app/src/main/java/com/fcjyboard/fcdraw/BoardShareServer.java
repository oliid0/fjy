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

    BoardShareServer(List<byte[]> images, long lifetimeMillis) {
        super(0);
        this.images = java.util.Collections.unmodifiableList(new java.util.ArrayList<>(images));
        expiresAt = System.nanoTime() + lifetimeMillis * 1_000_000;
    }

    @Override public Response serve(IHTTPSession session) {
        if (session.getMethod() != Method.GET && session.getMethod() != Method.HEAD) {
            return newFixedLengthResponse(Response.Status.METHOD_NOT_ALLOWED, "text/plain", "Read only");
        }
        String root = "/" + token;
        String uri = session.getUri();
        if (!uri.equals(root) && !uri.startsWith(root + "/")) {
            return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found");
        }
        if (System.nanoTime() >= expiresAt) {
            return newFixedLengthResponse(Response.Status.GONE, "text/plain; charset=utf-8", "分享已结束，请重新扫码");
        }
        Response response;
        if (uri.equals(root) || uri.equals(root + "/")) {
            StringBuilder html = new StringBuilder("<!doctype html><html lang='zh-CN'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Fcboard 页面分享</title><style>body{margin:24px;font:18px system-ui;background:#f5f7fa;color:#17243c}img{display:block;max-width:100%;margin:16px 0;background:white}a{display:inline-block;padding:12px;color:#245bd6}section{margin-bottom:32px}</style><h1>Fcboard 页面分享</h1><p>本次分享有效期十分钟，请及时下载。</p>");
            for (int index = 0; index < images.size(); index++) {
                String path = root + "/page-" + index + ".png";
                html.append("<section><h2>第 ").append(index + 1).append(" 页</h2><a download='Fcboard-").append(index + 1).append(".png' href='").append(path).append("?download=1'>下载本页</a><img alt='白板页面' src='").append(path).append("'></section>");
            }
            response = newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", html.append("</html>").toString());
            response.addHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'");
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
