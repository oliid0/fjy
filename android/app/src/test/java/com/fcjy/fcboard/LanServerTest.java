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
    @Test public void coursewareRetainsOriginalFileAcrossPagesAndRejectsGuestReplacement() throws Exception {
        LanServer server = new LanServer(path -> null, ignored -> {}); server.start(5000, true);
        try {
            JSONObject document = new JSONObject().put("id", "original").put("name", "lesson.pptx").put("mimeType", "application/octet-stream")
                .put("page", 0).put("dataURL", "data:application/octet-stream;base64,YQ==");
            JSONObject first = new JSONObject().put("id", "document:original:0").put("epoch", 0);
            String token = server.startRoom(scene(element("ink", 1, 1, false)).put("page", first).put("document", document));
            try (Client guest = new Client(server.getListeningPort(), "/board/" + token)) {
                assertEquals(document.toString(), new JSONObject(guest.read()).getJSONObject("document").toString());
                guest.send(scene(element("ink", 2, 1, false)).put("page", first).put("document", new JSONObject(document.toString()).put("name", "forged.pptx")).toString());
                assertEquals("lesson.pptx", new JSONObject(guest.read()).getJSONObject("document").getString("name"));
                JSONObject nextDocument = new JSONObject(document.toString()).put("page", 1); nextDocument.remove("dataURL");
                JSONObject second = new JSONObject().put("id", "document:original:1").put("epoch", 1);
                server.publish(new JSONObject().put("kind", "scene").put("elements", new JSONArray()).put("files", new JSONObject()).put("page", second).put("document", nextDocument).toString(), null);
                JSONObject changed = new JSONObject(guest.read());
                assertEquals(0, changed.getJSONArray("elements").length());
                assertEquals(1, changed.getJSONObject("document").getInt("page"));
                assertEquals(document.getString("dataURL"), changed.getJSONObject("document").getString("dataURL"));
                guest.send(scene(element("late", 9, 1, false)).put("page", first).toString());
                assertEquals(0, new JSONObject(guest.read()).getJSONArray("elements").length());
                server.publish(new JSONObject().put("kind", "scene").put("elements", new JSONArray()).put("files", new JSONObject()).put("page", new JSONObject().put("id", "board").put("epoch", 2)).toString(), null);
                assertFalse(new JSONObject(guest.read()).has("document"));
            }
        } finally { server.stop(); }
    }
    @Test public void pageEpochsReplaceScenesAndRejectLateOrGuestTransitions() throws Exception {
        LanServer server = new LanServer(path -> null, ignored -> {}); server.start(5000, true);
        try {
            JSONObject first = new JSONObject().put("id", "first").put("epoch", 0);
            String token = server.startRoom(scene(element("old", 1, 1, false)).put("page", first));
            try (Client guest = new Client(server.getListeningPort(), "/board/" + token)) {
                guest.read();
                JSONObject second = new JSONObject().put("id", "second").put("epoch", 1);
                server.publish(new JSONObject().put("kind", "scene").put("page", second).put("elements", new JSONArray()).put("files", new JSONObject()).toString(), null);
                JSONObject switched = new JSONObject(guest.read());
                assertEquals("initial", switched.getString("kind")); assertEquals(0, switched.getJSONArray("elements").length());
                guest.send(scene(element("late", 9, 1, false)).put("page", first).toString());
                assertEquals(0, new JSONObject(guest.read()).getJSONArray("elements").length());
                guest.send(scene(element("forged", 9, 1, false)).put("page", new JSONObject().put("id", "forged").put("epoch", 99)).toString());
                assertEquals("second", new JSONObject(guest.read()).getJSONObject("page").getString("id"));
                assertEquals(0, server.snapshotRoom().getJSONArray("elements").length());
            }
        } finally { server.stop(); }
    }
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
    @Test public void passwordSwitchUpdatesTheSameRoomAndCanBeDisabledWhileAGuestIsWaiting() throws Exception {
        LanServer server=new LanServer(path->new ByteArrayInputStream(new byte[0]),ignored->{});server.start(5000,true);
        try {
            String token=server.startRoom(scene(element("private-board",1,5,false)));
            // Default off: the QR link immediately opens the board.
            try (Client first = new Client(server.getListeningPort(), "/board/" + token)) {
                assertEquals("initial", new JSONObject(first.read()).getString("kind"));
            }
            server.setPassword("0123");
            try(Client guest=new Client(server.getListeningPort(),"/board/"+token)){
                JSONObject required=new JSONObject(guest.read());assertEquals("auth",required.getString("kind"));assertFalse(required.has("elements"));
                for (int attempt = 0; attempt < 4; attempt++) {
                    guest.send("{\"kind\":\"join\",\"password\":\"9999\"}");assertTrue(new JSONObject(guest.read()).getBoolean("incorrect"));
                }
                server.setPassword("2345");
                guest.send("{\"kind\":\"join\",\"password\":\"0123\"}");assertTrue(new JSONObject(guest.read()).getBoolean("incorrect"));
                guest.send("{\"kind\":\"join\",\"password\":\"2345\"}");JSONObject initial=new JSONObject(guest.read());assertEquals("initial",initial.getString("kind"));assertEquals("private-board",initial.getJSONArray("elements").getJSONObject(0).getString("id"));
                guest.send(scene(element("guest-ink",1,8,false)).toString());assertEquals("guest-ink",new JSONObject(guest.read()).getJSONArray("elements").getJSONObject(0).getString("id"));
            }
            try (Client waiting = new Client(server.getListeningPort(), "/board/" + token)) {
                assertEquals("auth", new JSONObject(waiting.read()).getString("kind"));
                server.setPassword("");
                assertEquals("initial", new JSONObject(waiting.read()).getString("kind"));
            }
            try (Client next = new Client(server.getListeningPort(), "/board/" + token)) {
                assertEquals("initial", new JSONObject(next.read()).getString("kind"));
            }
            try { server.setPassword("123456"); fail("Four digits only"); }
            catch (IllegalArgumentException expected) { }
        }finally{server.stop();}
    }
    @Test public void drawingDeletionBinaryAndLateJoinReachBothDevices() throws Exception {
        List<String> nativeMessages = new CopyOnWriteArrayList<>();
        LanServer server = new LanServer(path -> new ByteArrayInputStream("Fcboard".getBytes(StandardCharsets.UTF_8)), nativeMessages::add);
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
        LanServer server = new LanServer(path -> null, text -> {}); server.start(5000, true);
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
        LanServer server = new LanServer(path -> { throw new java.io.FileNotFoundException(path); }, text -> {}); server.start(5000, true);
        try (Socket socket = new Socket("127.0.0.1", server.getListeningPort())) {
            socket.setSoTimeout(3000);
            socket.getOutputStream().write(("GET /board/invalid HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            assertTrue(new String(socket.getInputStream().readNBytes(100), StandardCharsets.UTF_8).contains("404"));
        } finally { server.stop(); }
    }

}
