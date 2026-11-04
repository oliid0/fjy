package com.fcjy.fcboard;

import static org.junit.Assert.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class VoteServerTest {
    private HttpURLConnection request(VoteServer server, String path, String cookie, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL("http://127.0.0.1:" + server.getListeningPort() + path).openConnection();
        connection.setConnectTimeout(3000); connection.setReadTimeout(3000);
        if (cookie != null) connection.setRequestProperty("Cookie", cookie);
        if (body != null) { connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json; charset=utf-8"); connection.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8)); }
        return connection;
    }
    private JSONObject json(HttpURLConnection connection) throws Exception { return new JSONObject(new String(connection.getInputStream().readAllBytes(), StandardCharsets.UTF_8)); }
    @Test public void phoneSubmissionsReplaceBallotsAndEndingRetainsActualResults() throws Exception {
        VoteServer server = new VoteServer("<h1>课堂投票</h1>", "惯性与质量", new JSONArray().put("有关").put("无关"), false);
        server.start(3000, true);
        try {
            String root = "/" + server.token;
            HttpURLConnection page = request(server, root, null, null);
            assertEquals(200, page.getResponseCode());
            String voter = page.getHeaderField("Set-Cookie").split(";")[0];
            assertTrue(page.getHeaderField("Set-Cookie").contains("HttpOnly"));
            assertEquals("惯性与质量", json(request(server, root + "/api", voter, null)).getString("topic"));
            JSONObject first = json(request(server, root + "/vote", voter, "{\"choices\":[0]}"));
            assertEquals(1, first.getInt("participants")); assertEquals("[1,0]", first.getJSONArray("counts").toString());
            JSONObject updated = json(request(server, root + "/vote", voter, "{\"choices\":[1]}"));
            assertEquals(1, updated.getInt("participants")); assertEquals("[0,1]", updated.getJSONArray("counts").toString());
            assertEquals(400, request(server, root + "/vote", voter, "{\"choices\":[0,1]}").getResponseCode());
            assertEquals(400, request(server, root + "/vote", null, "{\"choices\":[0]}").getResponseCode());
            server.setAccepting(false);
            assertEquals(409, request(server, root + "/vote", voter, "{\"choices\":[0]}").getResponseCode());
            assertEquals("[0,1]", server.snapshot("").getJSONArray("counts").toString());
            assertEquals(404, request(server, "/wrong/api", null, null).getResponseCode());
            assertEquals(405, request(server, root + "/admin", voter, "{}").getResponseCode());
        } finally { server.stop(); }
    }
    @Test public void validatesMultiChoiceAndCountsDistinctParticipants() throws Exception {
        VoteServer server = new VoteServer("", "请选择", new JSONArray().put("A").put("B").put("C"), true);
        String one = "0123456789abcdef0123456789abcdef", two = "abcdef0123456789abcdef0123456789";
        server.submit(one, new JSONArray().put(0).put(2)); server.submit(two, new JSONArray().put(2));
        assertEquals(2, server.snapshot("").getInt("participants"));
        assertEquals("[1,0,2]", server.snapshot("").getJSONArray("counts").toString());
        for (JSONArray choices : new JSONArray[]{new JSONArray(), new JSONArray().put(0).put(0), new JSONArray().put(0.5), new JSONArray().put(9)}) {
            try { server.submit(one, choices); fail("Invalid ballot must not change counts"); } catch (IllegalArgumentException expected) { }
        }
        assertEquals("[1,0,2]", server.snapshot("").getJSONArray("counts").toString());
    }
}
