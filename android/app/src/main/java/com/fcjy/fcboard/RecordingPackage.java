package com.fcjy.fcboard;

import java.io.Closeable;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/** Bounded bridge chunks go to disk; video is never base64-encoded as one giant string. */
final class RecordingPackage implements Closeable {
    static final long MAX_BYTES = 512L * 1024 * 1024;
    final String id = UUID.randomUUID().toString();
    final File directory;
    final File media;
    final File archive;
    final String mime;
    final String transcript;
    final String summary;
    private final long expected;
    private final FileOutputStream output;
    private long received;
    private boolean complete;

    RecordingPackage(File cache, long size, String mime, String transcript, String summary) throws IOException {
        String normalized = mime.split(";", 2)[0];
        if (size < 1 || size > MAX_BYTES || !java.util.Arrays.asList("audio/webm", "video/webm", "audio/mp4", "video/mp4").contains(normalized)) throw new IOException("Invalid recording format or size");
        if (transcript == null || summary == null || transcript.length() > 2000000 || summary.length() > 2000000) throw new IOException("Invalid transcript or summary");
        this.mime = normalized;
        this.expected = size;
        this.transcript = transcript;
        this.summary = summary;
        directory = new File(cache, "recording-export-" + id);
        if (!directory.mkdirs()) throw new IOException("Cannot create recording export directory");
        media = new File(directory, normalized.endsWith("mp4") ? "recording.mp4" : "recording.webm");
        archive = new File(directory, "Fcboard-recording.zip");
        output = new FileOutputStream(media);
    }

    synchronized void append(long offset, byte[] bytes) throws IOException {
        if (complete || offset != received || bytes.length < 1 || bytes.length > 262144 || received + bytes.length > expected) throw new IOException("Invalid recording chunk order or length");
        output.write(bytes);
        received += bytes.length;
    }

    synchronized void finish() throws IOException {
        if (complete) return;
        if (received != expected) throw new IOException("Recording upload is incomplete");
        output.close();
        try (ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(archive))) {
            zip.setLevel(0);
            zip.putNextEntry(new ZipEntry(media.getName()));
            try (FileInputStream input = new FileInputStream(media)) {
                byte[] buffer = new byte[65536];
                int count;
                while ((count = input.read(buffer)) != -1) zip.write(buffer, 0, count);
            }
            zip.closeEntry();
            zip.setLevel(6);
            zip.putNextEntry(new ZipEntry("transcript.txt"));
            zip.write(transcript.getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
            zip.putNextEntry(new ZipEntry("summary.md"));
            zip.write(summary.getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
        }
        complete = true;
    }

    synchronized boolean isComplete() { return complete; }

    @Override public synchronized void close() throws IOException {
        output.close();
        media.delete();
        archive.delete();
        directory.delete();
    }
}
