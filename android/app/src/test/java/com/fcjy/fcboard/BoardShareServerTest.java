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
    @Test public void passwordSwitchKeepsTheLinkAndFourDigitChangesReachTheScanner() throws Exception {
        byte[] image = new byte[]{(byte)137, 80, 78, 71};
        BoardShareServer server = new BoardShareServer(Collections.singletonList(image), 60000);
        server.start(3000, true);
        try {
            String root = "/" + server.token + "/";
            assertFalse(new String(get(server, root).getInputStream().readAllBytes(), StandardCharsets.UTF_8).contains("name='password'"));
            server.setPassword("0123");
            assertTrue(new String(get(server, root).getInputStream().readAllBytes(), StandardCharsets.UTF_8).contains("name='password'"));
            assertEquals(403, get(server, root + "page-0.png").getResponseCode());
            server.setPassword("2345");
            HttpURLConnection wrong = get(server, root);
            wrong.setRequestMethod("POST"); wrong.setDoOutput(true);
            wrong.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            wrong.getOutputStream().write("password=0123".getBytes(StandardCharsets.UTF_8));
            assertTrue(new String(wrong.getInputStream().readAllBytes(), StandardCharsets.UTF_8).contains("密码错误"));
            HttpURLConnection correct = get(server, root);
            correct.setRequestMethod("POST"); correct.setDoOutput(true);
            correct.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            correct.getOutputStream().write("password=2345".getBytes(StandardCharsets.UTF_8));
            assertEquals(200, correct.getResponseCode());
            assertNotNull(correct.getHeaderField("Set-Cookie"));
            HttpURLConnection imageRequest = get(server, root + "page-0.png");
            imageRequest.setRequestProperty("Cookie", correct.getHeaderField("Set-Cookie").split(";")[0]);
            assertArrayEquals(image, imageRequest.getInputStream().readAllBytes());
            server.setPassword("");
            assertArrayEquals(image, get(server, root + "page-0.png").getInputStream().readAllBytes());
            try { server.setPassword("abcd"); fail("Numeric digits only"); }
            catch (IllegalArgumentException expected) { }
        } finally { server.stop(); }
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
