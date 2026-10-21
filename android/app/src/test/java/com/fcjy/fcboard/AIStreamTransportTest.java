package com.fcjy.fcboard;

import static org.junit.Assert.*;
import fi.iki.elonen.NanoHTTPD;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;

public class AIStreamTransportTest {
    @Test
    public void streamsUtf8AndRetainsGatewayErrors() throws Exception {
        String frames = "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\ndata: [DONE]\n\n";
        NanoHTTPD server = new NanoHTTPD("127.0.0.1", 0) {
            @Override public Response serve(IHTTPSession session) {
                if (session.getUri().equals("/error")) return newFixedLengthResponse(Response.Status.UNAUTHORIZED, "application/json", "{\"error\":{\"message\":\"invalid key\"}}");
                return newChunkedResponse(Response.Status.OK, "text/event-stream", new ByteArrayInputStream(frames.getBytes(StandardCharsets.UTF_8)));
            }
        };
        server.start();
        AIStreamTransport transport = new AIStreamTransport();
        try {
            StringBuilder text = new StringBuilder();
            CountDownLatch complete = new CountDownLatch(1);
            java.util.concurrent.atomic.AtomicReference<Exception> failure = new java.util.concurrent.atomic.AtomicReference<>();
            transport.start("one", "http://127.0.0.1:" + server.getListeningPort() + "/stream", new HashMap<>(), "{}", new AIStreamTransport.Callback() {
                public void chunk(String chunk) { text.append(chunk); }
                public void complete(int status, String data, boolean stream) { if (status != 200 || !stream) failure.set(new Exception("Not streamed")); complete.countDown(); }
                public void failed(Exception error) { failure.set(error); complete.countDown(); }
            });
            assertTrue(complete.await(5, TimeUnit.SECONDS));
            assertNull(failure.get()); assertEquals(frames, text.toString());
            CountDownLatch rejected = new CountDownLatch(1);
            transport.start("two", "http://127.0.0.1:" + server.getListeningPort() + "/error", new HashMap<>(), "{}", new AIStreamTransport.Callback() {
                public void chunk(String chunk) { failure.set(new Exception("Streamed an HTTP error")); }
                public void complete(int status, String data, boolean stream) { if (status != 401 || stream || !data.contains("invalid key")) failure.set(new Exception("Lost gateway error")); rejected.countDown(); }
                public void failed(Exception error) { failure.set(error); rejected.countDown(); }
            });
            assertTrue(rejected.await(5, TimeUnit.SECONDS)); assertNull(failure.get());
        } finally { transport.close(); server.stop(); }
    }

    @Test
    public void rejectsUnsafeEndpointsBeforeSendingCredentials() throws Exception {
        assertEquals("192.168.1.2", AIStreamTransport.checkedURL("http://192.168.1.2:8080/chat").getHost());
        for (String url : new String[] {"http://public.example/chat", "https://key:secret@api.example/chat", "http://192.168.attacker.example/chat"}) {
            try { AIStreamTransport.checkedURL(url); fail("Accepted unsafe URL"); }
            catch (java.io.IOException expected) {}
        }
    }
}
