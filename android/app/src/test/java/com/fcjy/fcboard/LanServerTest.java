package com.fcjy.fcboard;

import org.junit.Test;
import org.json.JSONObject;
import org.json.JSONArray;
import java.net.Socket;
import java.io.DataInputStream;
import java.io.OutputStream;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import static org.junit.Assert.*;

/** Two real socket clients exercise the APK's actual relay, including conflict acknowledgements. */
public class LanServerTest {
    private static class Client implements AutoCloseable {
        final Socket socket;
        final DataInputStream input;
        final OutputStream output;
        Client(int port, String path) throws Exception {
            socket = new Socket("127.0.0.1", port); socket.setSoTimeout(3000);
            input = new DataInputStream(socket.getInputStream()); output = socket.getOutputStream();
            output.write(("GET " + path + " HTTP/1.1\r\nHost: 127.0.0.1:" + port + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n").getBytes(StandardCharsets.US_ASCII)); output.flush();
            StringBuilder response = new StringBuilder();
            while (!response.toString().endsWith("\r\n\r\n")) response.append((char)input.readUnsignedByte());
            assertTrue(response.toString().contains("101"));
            assertTrue(response.toString().contains("s3pPLMBiTxaQ9kYGzzhZRbK+xOo="));
        }
        void send(String value) throws Exception {
            byte[] text = value.getBytes(StandardCharsets.UTF_8); output.write(0x81);
            if (text.length < 126) output.write(0x80 | text.length);
            else { output.write(0x80 | 126); output.write(text.length >> 8); output.write(text.length & 255); }
            byte[] mask = {1,2,3,4}; output.write(mask);
            for (int i = 0; i < text.length; i++) output.write(text[i] ^ mask[i % 4]);
            output.flush();
        }
        String read() throws Exception {
            int opcode = input.readUnsignedByte() & 15;
            int length = input.readUnsignedByte() & 127;
            if (length == 126) length = input.readUnsignedShort();
            else if (length == 127) length = (int)input.readLong();
            byte[] data = new byte[length]; input.readFully(data);
            assertEquals("Expected a text data frame", 1, opcode);
            return new String(data, StandardCharsets.UTF_8);
        }
        public void close() throws Exception { socket.close(); }
    }
    private JSONObject element(String id, int version, int nonce, boolean deleted) throws Exception {
        return new JSONObject().put("id", id).put("version", version).put("versionNonce", nonce).put("isDeleted", deleted).put("type", "freedraw").put("points", new JSONArray("[[0,0],[20,30]]"));
    }
    private JSONObject scene(JSONObject element) throws Exception {
        return new JSONObject().put("kind", "scene").put("elements", new JSONArray().put(element)).put("files", new JSONObject());
    }
    @Test public void drawingDeletionBinaryAndLateJoinReachBothDevices() throws Exception {
        List<String> nativeMessages = new CopyOnWriteArrayList<>();
        LanServer server = new LanServer(path -> new ByteArrayInputStream("Fcboard".getBytes(StandardCharsets.UTF_8)), nativeMessages::add, null);
        server.start(5000, true);
        try {
            String room = server.startRoom(new JSONObject());
            try (Client first = new Client(server.getListeningPort(), "/board/" + room); Client second = new Client(server.getListeningPort(), "/board/" + room)) {
                assertEquals("initial", new JSONObject(first.read()).getString("kind")); second.read();
                JSONObject drawing = scene(element("ink", 1, 50, false));
                drawing.put("files", new JSONObject().put("image", new JSONObject().put("dataURL", "data:image/png;base64,AQID")));
                first.send(drawing.toString());
                assertEquals("ink", new JSONObject(second.read()).getJSONArray("elements").getJSONObject(0).getString("id"));
                first.read();
                second.send(scene(element("ink", 2, 20, true)).toString());
                assertTrue(new JSONObject(first.read()).getJSONArray("elements").getJSONObject(0).getBoolean("isDeleted")); second.read();
                try (Client late = new Client(server.getListeningPort(), "/board/" + room)) {
                    JSONObject snapshot = new JSONObject(late.read());
                    assertTrue(snapshot.getJSONArray("elements").getJSONObject(0).getBoolean("isDeleted"));
                    assertEquals("data:image/png;base64,AQID", snapshot.getJSONObject("files").getJSONObject("image").getString("dataURL"));
                }
                assertTrue(nativeMessages.stream().anyMatch(value -> value.contains("data:image/png")));
            }
        } finally { server.stop(); }
    }
    @Test public void concurrentLoserReceivesWinningNonceInsteadOfDiverging() throws Exception {
        LanServer server = new LanServer(path -> null, text -> {}, null); server.start(5000, true);
        try {
            String room = server.startRoom(scene(element("same", 3, 1, false)));
            try (Client client = new Client(server.getListeningPort(), "/board/" + room)) {
                client.read(); client.send(scene(element("same", 3, 99, true)).toString());
                JSONObject accepted = new JSONObject(client.read()).getJSONArray("elements").getJSONObject(0);
                assertEquals(1, accepted.getInt("versionNonce")); assertFalse(accepted.getBoolean("isDeleted"));
                client.send("ping"); assertEquals("pong", client.read());
            }
        } finally { server.stop(); }
    }
    @Test public void unknownRoomCannotJoin() throws Exception {
        LanServer server = new LanServer(path -> { throw new java.io.FileNotFoundException(path); }, text -> {}, null); server.start(5000, true);
        try (Socket socket = new Socket("127.0.0.1", server.getListeningPort())) {
            socket.setSoTimeout(3000);
            socket.getOutputStream().write(("GET /board/invalid HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            assertTrue(new String(socket.getInputStream().readNBytes(100), StandardCharsets.UTF_8).contains("404"));
        } finally { server.stop(); }
    }
    private java.net.HttpURLConnection request(LanServer server, String path, JSONObject body, String token) throws Exception {
        java.net.HttpURLConnection request = (java.net.HttpURLConnection)new java.net.URL("http://127.0.0.1:" + server.getListeningPort() + "/remote-api/" + path).openConnection();
        request.setRequestMethod("POST"); request.setDoOutput(true); request.setRequestProperty("Content-Type", "application/json");
        if (token != null) request.setRequestProperty("X-Fcboard-Session", token);
        request.getOutputStream().write(body.toString().getBytes(StandardCharsets.UTF_8));
        return request;
    }
    @Test public void screenPinIsSingleUseAndEndingInvalidatesTheController() throws Exception {
        LanServer server = new LanServer(path -> null, text -> {}, null); server.start(5000, true);
        try {
            String pin = server.startRemote();
            java.net.HttpURLConnection wrong = request(server, "auth", new JSONObject().put("pin", "invalid"), null);
            assertEquals(403, wrong.getResponseCode()); wrong.disconnect();
            java.net.HttpURLConnection pair = request(server, "auth", new JSONObject().put("pin", pin), null);
            assertEquals(200, pair.getResponseCode());
            String token = new JSONObject(new String(pair.getInputStream().readAllBytes(), StandardCharsets.UTF_8)).getString("token"); pair.disconnect();
            assertEquals(32, token.length());
            java.net.HttpURLConnection reused = request(server, "auth", new JSONObject().put("pin", pin), null);
            assertEquals(403, reused.getResponseCode()); reused.disconnect();
            server.stopRemote();
            java.net.HttpURLConnection ended = request(server, "connect", new JSONObject().put("port", 5555), token);
            assertEquals(403, ended.getResponseCode()); ended.disconnect();
        } finally { server.stop(); }
    }
}
