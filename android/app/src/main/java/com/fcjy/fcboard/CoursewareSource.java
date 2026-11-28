package com.fcjy.fcboard;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import com.getcapacitor.JSObject;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Private, disk-backed courseware sources. No document bytes cross the plugin bridge. */
final class CoursewareSource {
    private static final String PREFIX = "/_fc_courseware/";
    private static final Pattern KEY = Pattern.compile("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}");
    private static final Pattern RANGE = Pattern.compile("bytes=(\\d*)-(\\d*)");

    private CoursewareSource() {}

    private static File directory(Context context) {
        return new File(context.getFilesDir(), "courseware");
    }

    static JSObject importSource(Context context, Uri document) throws Exception {
        File root = directory(context);
        if (!root.isDirectory() && !root.mkdirs()) {
            throw new IOException("Cannot create document storage");
        }
        String key = UUID.randomUUID().toString();
        File pending = new File(root, key + ".pending");
        File saved = new File(root, key);
        MessageDigest fingerprint = MessageDigest.getInstance("SHA-256");
        try {
            try (InputStream input = context.getContentResolver().openInputStream(document);
                 FileOutputStream output = new FileOutputStream(pending)) {
                if (input == null) throw new IOException("Cannot read document");
                byte[] buffer = new byte[65536];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    output.write(buffer, 0, count);
                    fingerprint.update(buffer, 0, count);
                }
            }
            if (pending.length() == 0 || !pending.renameTo(saved)) {
                throw new IOException("Cannot store selected document");
            }
            StringBuilder digest = new StringBuilder();
            for (byte value : fingerprint.digest()) {
                digest.append(Character.forDigit((value & 255) >> 4, 16));
                digest.append(Character.forDigit(value & 15, 16));
            }
            return new JSObject().put("key", key).put("size", saved.length())
                .put("fingerprint", digest.toString());
        } finally {
            pending.delete();
        }
    }

    static void discard(Context context, String key) {
        if (KEY.matcher(key).matches()) {
            new File(directory(context), key).delete();
        }
    }

    static WebResourceResponse intercept(Context context, Uri origin, WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getEncodedPath();
        if (path == null || !path.startsWith(PREFIX) ||
                !origin.getScheme().equals(url.getScheme()) ||
                !origin.getAuthority().equals(url.getAuthority())) {
            return null;
        }
        String[] parts = path.substring(PREFIX.length()).split("/", -1);
        String key = parts[0];
        if (!KEY.matcher(key).matches()) return empty(404, "Not Found", new HashMap<>());
        String method = request.getMethod().toUpperCase(Locale.ROOT);
        if (!"GET".equals(method) && !"HEAD".equals(method)) {
            return empty(405, "Method Not Allowed",
                java.util.Collections.singletonMap("Allow", "GET, HEAD"));
        }
        File file = new File(directory(context), key);
        if (!file.isFile()) return empty(404, "Not Found", new HashMap<>());
        if (parts.length != 1) {
            if ("HEAD".equals(method)) return empty(405, "Method Not Allowed", new HashMap<>());
            return pageResponse(context, file, parts);
        }
        String range = null;
        for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
            if ("Range".equalsIgnoreCase(header.getKey())) range = header.getValue();
        }
        return serve(file, range, "HEAD".equals(method));
    }

    private static WebResourceResponse pageResponse(Context context, File file, String[] parts) {
        File page = null;
        try {
            if (parts.length == 2 && "slides".equals(parts[1])) {
                return json(CoursewarePptx.metadata(file));
            }
            if (parts.length == 2 && "word".equals(parts[1])) {
                return json(new JSObject().put("count", CoursewareWord.pageCount(file)));
            }
            if (parts.length == 2 && "sheets".equals(parts[1])) {
                return json(CoursewareSheets.pages(file));
            }
            if (parts.length == 3 && "sheets".equals(parts[1]) && "styles".equals(parts[2])) {
                try (java.util.zip.ZipFile zip = new java.util.zip.ZipFile(file)) {
                    java.util.zip.ZipEntry styles = zip.getEntry("xl/styles.xml");
                    if (styles == null || styles.getSize() > 8L * 1024 * 1024) {
                        return empty(404, "Not Found", new HashMap<>());
                    }
                    try (InputStream input = zip.getInputStream(styles);
                         java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream()) {
                        byte[] buffer = new byte[8192];
                        int count;
                        while ((count = input.read(buffer)) != -1) {
                            if (bytes.size() + count > 8L * 1024 * 1024) {
                                throw new IOException("Oversized Excel styles");
                            }
                            bytes.write(buffer, 0, count);
                        }
                        return new WebResourceResponse("application/xml", "UTF-8", 200, "OK",
                            java.util.Collections.singletonMap("Cache-Control", "no-store"),
                            new ByteArrayInputStream(bytes.toByteArray()));
                    }
                }
            }
            if (parts.length == 3 && "sheets".equals(parts[1]) && parts[2].matches("[0-9]{1,9}")) {
                return json(CoursewareSheets.page(file, Integer.parseInt(parts[2])));
            }
            if (parts.length != 3 || !("slides".equals(parts[1]) || "word".equals(parts[1])) ||
                    !parts[2].matches("[0-9]{1,9}")) {
                return empty(404, "Not Found", new HashMap<>());
            }
            int index = Integer.parseInt(parts[2]);
            page = File.createTempFile("courseware-page-", ".zip", context.getCacheDir());
            try (FileOutputStream output = new FileOutputStream(page)) {
                if ("slides".equals(parts[1])) CoursewarePptx.page(file, index, output);
                else CoursewareWord.page(file, index, output);
            }
            File completed = page;
            InputStream input = new FilterInputStream(new FileInputStream(completed)) {
                @Override public void close() throws IOException {
                    try { super.close(); } finally { completed.delete(); }
                }
            };
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            headers.put("Content-Length", Long.toString(completed.length()));
            page = null;
            return new WebResourceResponse("application/zip", null, 200, "OK", headers, input);
        } catch (Exception error) {
            return empty(422, "Unable to read Office page", new HashMap<>());
        } finally {
            if (page != null) page.delete();
        }
    }

    private static WebResourceResponse json(Object result) {
        return new WebResourceResponse("application/json", "UTF-8", 200, "OK",
            java.util.Collections.singletonMap("Cache-Control", "no-store"),
            new ByteArrayInputStream(result.toString().getBytes(StandardCharsets.UTF_8)));
    }

    static WebResourceResponse serve(File file, String range, boolean head) {
        long size = file.length();
        Map<String, String> headers = new HashMap<>();
        headers.put("Accept-Ranges", "bytes");
        headers.put("Cache-Control", "no-store");
        headers.put("Content-Type", "application/octet-stream");
        long start = 0, end = size - 1;
        if (range != null) {
            Matcher matcher = RANGE.matcher(range.trim());
            try {
                if (!matcher.matches()) throw new NumberFormatException();
                String first = matcher.group(1), last = matcher.group(2);
                if (first.isEmpty()) {
                    long suffix = Long.parseLong(last);
                    if (suffix <= 0) throw new NumberFormatException();
                    start = Math.max(0, size - suffix);
                } else {
                    start = Long.parseLong(first);
                    if (!last.isEmpty()) end = Math.min(end, Long.parseLong(last));
                }
                if (start > end) throw new NumberFormatException();
            } catch (NumberFormatException invalid) {
                headers.put("Content-Range", "bytes */" + size);
                return empty(416, "Range Not Satisfiable", headers);
            }
            headers.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
        }
        long length = end - start + 1;
        headers.put("Content-Length", Long.toString(length));
        int status = range == null ? 200 : 206;
        String reason = range == null ? "OK" : "Partial Content";
        if (head) return empty(status, reason, headers);
        try {
            return new WebResourceResponse("application/octet-stream", null,
                status, reason, headers, new Slice(file, start, length));
        } catch (IOException unavailable) {
            return empty(404, "Not Found", new HashMap<>());
        }
    }

    private static WebResourceResponse empty(int status, String reason, Map<String, String> headers) {
        return new WebResourceResponse("application/octet-stream", null, status,
            reason, headers, new ByteArrayInputStream(new byte[0]));
    }

    private static final class Slice extends InputStream {
        private final RandomAccessFile source;
        private long remaining;

        Slice(File file, long start, long length) throws IOException {
            source = new RandomAccessFile(file, "r");
            try {
                source.seek(start);
            } catch (IOException error) {
                source.close();
                throw error;
            }
            remaining = length;
        }

        @Override public int read() throws IOException {
            if (remaining == 0) return -1;
            int value = source.read();
            if (value != -1) remaining--;
            return value;
        }

        @Override public int read(byte[] bytes, int offset, int length) throws IOException {
            if (length == 0) return 0;
            if (remaining == 0) return -1;
            int count = source.read(bytes, offset, (int)Math.min(remaining, length));
            if (count > 0) remaining -= count;
            return count;
        }

        @Override public void close() throws IOException {
            source.close();
        }
    }
}
