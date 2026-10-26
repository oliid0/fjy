package com.fcjy.fcboard;

import org.junit.Test;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import static org.junit.Assert.*;

public class DoubaoSpeechProtocolTest {
    @Test public void pcmConfigurationAndSignedGzipFramesMatchTheDocumentedProtocol() throws Exception {
        byte[] config = DoubaoSpeechProtocol.configuration();
        JSONObject request = new JSONObject(new String(config, StandardCharsets.UTF_8));
        assertEquals(16000, request.getJSONObject("audio").getInt("rate"));
        assertTrue(request.getJSONObject("request").getBoolean("enable_nonstream"));
        byte[] frame = DoubaoSpeechProtocol.frame(1, 1, config);
        assertEquals(0x11, frame[0]); assertEquals(0x11, frame[1]); assertEquals(1, ByteBuffer.wrap(frame, 4, 4).getInt());
        byte[] finalFrame = DoubaoSpeechProtocol.frame(9, -3, "{\"result\":{\"text\":\"完成\"}}".getBytes(StandardCharsets.UTF_8));
        DoubaoSpeechProtocol.Response response = DoubaoSpeechProtocol.parse(finalFrame);
        assertTrue(response.last); assertEquals("完成", response.body.getJSONObject("result").getString("text"));
        try { DoubaoSpeechProtocol.parse(Arrays.copyOf(finalFrame, finalFrame.length - 1)); fail(); }
        catch (java.io.IOException expected) { assertTrue(expected.getMessage().contains("长度")); }
    }

    @Test public void onlyStableUtterancesAreDeliveredOnceAndRepeatedCommandsRemainDistinct() throws Exception {
        DoubaoSpeechProtocol decoder = new DoubaoSpeechProtocol();
        JSONObject first = new JSONObject().put("text", "画一个圆").put("start_time", 0).put("end_time", 1200).put("definite", false);
        JSONObject body = new JSONObject().put("result", new JSONObject().put("utterances", new JSONArray().put(first)));
        assertEquals(0, decoder.lines(body).length());
        assertTrue(DoubaoSpeechProtocol.hasInterim(body));
        first.put("definite", true);
        assertFalse(DoubaoSpeechProtocol.hasInterim(body));
        assertEquals("画一个圆", decoder.lines(body).getJSONObject(0).getString("text"));
        assertEquals(0, decoder.lines(body).length());
        JSONObject second = new JSONObject(first.toString()).put("start_time", 2000).put("end_time", 3200);
        body.getJSONObject("result").getJSONArray("utterances").put(second);
        JSONArray next = decoder.lines(body);
        assertEquals(1, next.length()); assertEquals(2, next.getJSONObject(0).getDouble("time"), 0);
    }

    @Test public void errorFramesAndInvalidCompressionCannotBecomeCommands() throws Exception {
        byte[] frame = ByteBuffer.allocate(14).put(new byte[]{0x11, (byte)0xf0, 0x10, 0}).putInt(45000001).putInt(2).put(new byte[]{'{', '}'}).array();
        try { DoubaoSpeechProtocol.parse(frame); fail(); } catch (java.io.IOException expected) { assertTrue(expected.getMessage().contains("45000001")); }
        byte[] unsupported = DoubaoSpeechProtocol.frame(9, 1, "{}".getBytes(StandardCharsets.UTF_8)); unsupported[2] = 0x12;
        try { DoubaoSpeechProtocol.parse(unsupported); fail(); } catch (java.io.IOException expected) { }
    }
}
