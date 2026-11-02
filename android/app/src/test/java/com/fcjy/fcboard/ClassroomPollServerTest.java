package com.fcjy.fcboard;

import static org.junit.Assert.*;
import org.json.JSONArray;
import org.junit.Test;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class ClassroomPollServerTest {
    @Test public void countsEachVoterOnceAllowsCorrectionAndFreezesWhenClosed() throws Exception {
        ClassroomPollServer poll = new ClassroomPollServer("是否理解？", new JSONArray(new String[]{"理解", "不理解"}));
        poll.vote("student-001", 0); poll.vote("student-002", 0); poll.vote("student-001", 1);
        assertEquals(2, poll.snapshot().getInt("total"));
        assertEquals(1, poll.snapshot().getJSONArray("counts").getInt(0));
        assertEquals(1, poll.snapshot().getJSONArray("counts").getInt(1));
        poll.closeVoting();
        assertThrows(Exception.class, () -> poll.vote("student-003", 0));
        assertEquals(2, poll.snapshot().getInt("total"));
    }
    @Test public void servesTheRealEscapedMobileFormOnlyAtItsSessionLink() throws Exception {
        ClassroomPollServer poll = new ClassroomPollServer("<script>question</script>", new JSONArray(new String[]{"<a>", "B"}));
        poll.start(3000, true);
        try {
            String address = "http://127.0.0.1:" + poll.getListeningPort();
            HttpURLConnection wrong = (HttpURLConnection) new URL(address + "/").openConnection();
            wrong.setReadTimeout(3000); assertEquals(404, wrong.getResponseCode());
            HttpURLConnection request = (HttpURLConnection) new URL(address + "/" + poll.token + "/").openConnection();
            request.setReadTimeout(3000);
            String html = new String(request.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            assertTrue(html.contains("&lt;script&gt;question&lt;/script&gt;"));
            assertTrue(html.contains("name='choice'")); assertTrue(html.contains("&lt;a&gt;"));
        } finally { poll.stop(); }
    }
}
