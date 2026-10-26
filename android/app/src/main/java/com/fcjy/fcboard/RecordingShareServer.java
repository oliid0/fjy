package com.fcjy.fcboard;

import fi.iki.elonen.NanoHTTPD;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.UUID;

/** Read-only, expiring access to this recording's three files and combined archive. */
final class RecordingShareServer extends NanoHTTPD {
    final String token = UUID.randomUUID().toString();
    private final RecordingPackage recording;
    private final long expires;
    RecordingShareServer(RecordingPackage recording) {
        super(0);
        this.recording = recording;
        expires = System.nanoTime() + 600000L * 1000000;
    }
    private static String escape(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
    @Override public Response serve(IHTTPSession session) {
        if (session.getMethod() != Method.GET && session.getMethod() != Method.HEAD) return newFixedLengthResponse(Response.Status.METHOD_NOT_ALLOWED, "text/plain", "Read only");
        String root = "/" + token + "/";
        String path = session.getUri();
        if (!path.startsWith(root)) return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found");
        if (System.nanoTime() >= expires) return newFixedLengthResponse(Response.Status.GONE, "text/plain", "Sharing expired");
        Response result;
        try {
            if (path.equals(root)) {
                String html = "<!doctype html><html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Fcboard</title><style>body{max-width:960px;margin:auto;padding:24px;font:17px/1.5 system-ui;color:#17243c}video{width:100%;max-height:60vh}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}a{display:inline-block;padding:10px;color:#0b6ff3}</style><h1>Fcboard</h1><a download href='Fcboard-recording.zip'>↓ ZIP</a><a download href='" + recording.media.getName() + "'>↓ " + recording.media.getName() + "</a><a download href='transcript.txt'>↓ transcript.txt</a><a download href='summary.md'>↓ summary.md</a><video controls preload='metadata' src='" + recording.media.getName() + "'></video><h2>summary.md</h2><pre>" + escape(recording.summary) + "</pre><h2>transcript.txt</h2><pre>" + escape(recording.transcript) + "</pre></html>";
                result = newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", html);
            } else if (path.equals(root + "transcript.txt") || path.equals(root + "summary.md")) {
                result = newFixedLengthResponse(Response.Status.OK, "text/plain; charset=utf-8", path.endsWith("transcript.txt") ? recording.transcript : recording.summary);
            } else {
                File file = path.equals(root + recording.media.getName()) ? recording.media : path.equals(root + "Fcboard-recording.zip") ? recording.archive : null;
                if (file == null) return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found");
                result = newFixedLengthResponse(Response.Status.OK, file == recording.media ? recording.mime : "application/zip", new FileInputStream(file), file.length());
                if (file == recording.archive) result.addHeader("Content-Disposition", "attachment; filename=Fcboard-recording.zip");
            }
        } catch (IOException error) { return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Recording unavailable"); }
        result.addHeader("Cache-Control", "no-store");
        result.addHeader("X-Content-Type-Options", "nosniff");
        result.addHeader("Content-Security-Policy", "default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        return result;
    }
}
