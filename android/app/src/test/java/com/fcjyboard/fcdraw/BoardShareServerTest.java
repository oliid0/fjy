package com.fcjy.fcboard;

import static org.junit.Assert.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import org.junit.Test;

public class BoardShareServerTest {
    private HttpURLConnection get(BoardShareServer server, String path) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL("http://127.0.0.1:" + server.getListeningPort() + path).openConnection();
        connection.setConnectTimeout(3000); connection.setReadTimeout(3000);
        return connection;
    }
    @Test public void servesChosenPagesOnlyWithTheUnpredictableShareLink() throws Exception {
        byte[] image = new byte[]{(byte)137, 80, 78, 71, 13, 10, 26, 10};
        BoardShareServer server = new BoardShareServer(Collections.singletonList(image), 60000);
        server.start(3000, true);
        try {
            assertEquals(404, get(server, "/").getResponseCode());
            assertEquals(404, get(server, "/wrong/page-0.png").getResponseCode());
            String base = "/" + server.token;
            HttpURLConnection page = get(server, base + "/");
            assertEquals(200, page.getResponseCode());
            assertTrue(new String(page.getInputStream().readAllBytes(), StandardCharsets.UTF_8).contains(base + "/page-0.png"));
            HttpURLConnection download = get(server, base + "/page-0.png?download=1");
            assertEquals("image/png", download.getContentType());
            assertArrayEquals(image, download.getInputStream().readAllBytes());
            assertTrue(download.getHeaderField("Content-Disposition").contains("attachment"));
            assertEquals(404, get(server, base + "/page-1.png").getResponseCode());
        } finally { server.stop(); }
    }
    @Test public void expiresTheLink() throws Exception {
        BoardShareServer server = new BoardShareServer(Collections.singletonList(new byte[]{1}), -1);
        server.start(3000, true);
        try { assertEquals(410, get(server, "/" + server.token + "/").getResponseCode()); }
        finally { server.stop(); }
    }
}
