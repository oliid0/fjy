package com.fcjy.fcboard;

import static org.junit.Assert.*;
import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class RecordingShareServerTest {
    private HttpURLConnection get(RecordingShareServer server, String path) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL("http://127.0.0.1:" + server.getListeningPort() + path).openConnection();
        connection.setConnectTimeout(3000);connection.setReadTimeout(3000);return connection;
    }
    @Test public void sharesOnlyTheCompletedRecordingWithAnUnpredictableReadOnlyLink() throws Exception {
        File cache = Files.createTempDirectory("fcboard-recording-test").toFile();
        RecordingPackage item = new RecordingPackage(cache, 2, "video/webm", "[00:02] Words", "<script>unsafe()</script>");
        item.append(0, new byte[]{1,2});item.finish();
        RecordingShareServer server = new RecordingShareServer(item);server.start(3000, true);
        try {
            assertEquals(404, get(server, "/").getResponseCode());
            String root = "/" + server.token + "/";
            String html = new String(get(server, root).getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            assertTrue(html.contains("&lt;script&gt;"));assertFalse(html.contains("<script>"));
            assertTrue(html.contains("Fcboard-recording.zip"));
            assertEquals(item.transcript, new String(get(server, root + "transcript.txt").getInputStream().readAllBytes(), StandardCharsets.UTF_8));
            assertArrayEquals(new byte[]{1,2}, get(server, root + "recording.webm").getInputStream().readAllBytes());
            assertEquals("application/zip", get(server, root + "Fcboard-recording.zip").getContentType());
            assertEquals(404, get(server, root + "../private.txt").getResponseCode());
            HttpURLConnection post = get(server, root);post.setRequestMethod("POST");assertEquals(405, post.getResponseCode());
        } finally { server.stop();item.close();cache.delete(); }
    }
}
