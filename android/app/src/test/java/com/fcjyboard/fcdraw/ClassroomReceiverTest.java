package com.fcjyboard.fcdraw;

import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import static org.junit.Assert.*;

/** Exercises the actual HTTP receiver without needing an Android device. */
public class ClassroomReceiverTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private ClassroomPlugin.Receiver receiver;
    private File directory;
    private String base;

    @Before public void start() throws Exception {
        directory = temporary.newFolder("uploads");
        receiver = new ClassroomPlugin.Receiver(directory);
        receiver.start(5000, true);
        base = "http://127.0.0.1:" + receiver.getListeningPort() + "/" + receiver.token + "/";
    }

    @After public void stop() { receiver.stop(); }

    @Test public void requiresTheCurrentPairingAddress() throws Exception {
        HttpURLConnection home = (HttpURLConnection) new URL(base).openConnection();
        assertEquals(200, home.getResponseCode());
        home.disconnect();
        HttpURLConnection unknown = (HttpURLConnection) new URL(base.replace(receiver.token, "invalid")).openConnection();
        assertEquals(404, unknown.getResponseCode());
        unknown.disconnect();
    }

    private int upload(String name, byte[] data) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(base + "upload?name=" + URLEncoder.encode(name, "UTF-8")).openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);
        connection.setRequestMethod("POST");
        connection.setRequestProperty("Content-Type", "application/octet-stream");
        connection.setDoOutput(true);
        connection.setFixedLengthStreamingMode(data.length);
        try (java.io.OutputStream output = connection.getOutputStream()) { output.write(data); }
        int status = connection.getResponseCode();
        connection.disconnect();
        return status;
    }

    @Test public void preservesUploadedBinaryBytes() throws Exception {
        byte[] data = new byte[] {80, 75, 3, 4, 0, -1, -128, 27, 13, 10};
        assertEquals(200, upload("课堂.pptx", data));
        File[] files = directory.listFiles();
        assertNotNull(files);
        assertEquals(1, files.length);
        assertTrue(files[0].getName().endsWith("_课堂.pptx"));
        assertArrayEquals(data, Files.readAllBytes(files[0].toPath()));
    }

    @Test public void rejectsUnsupportedTypesAndTraversal() throws Exception {
        byte[] data = "example".getBytes(StandardCharsets.UTF_8);
        assertEquals(400, upload("program.exe", data));
        assertEquals(400, upload("../escape.pptx", data));
        assertEquals(0, directory.listFiles().length);
    }
}
