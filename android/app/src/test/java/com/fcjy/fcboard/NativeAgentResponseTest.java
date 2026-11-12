package com.fcjy.fcboard;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;

public class NativeAgentResponseTest {
    @Test public void assemblesSplitFramesOnlyAfterCompletedAndKeepsReasoning() throws Exception {
        NativeAgentResponse response = new NativeAgentResponse();
        String frames = "data: {\"type\":\"response.output_item.done\",\"output_index\":1,\"item\":{\"type\":\"function_call\",\"call_id\":\"call\",\"name\":\"board_command\",\"arguments\":\"{}\"}}\r\n\r\n"
            + "data: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":{\"type\":\"reasoning\",\"encrypted_content\":\"preserve-exactly\"}}\n\n"
            + "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"real-response\",\"status\":\"completed\"}}\n\n";
        for (int index = 0; index < frames.length(); index += 7) response.accept(frames.substring(index, Math.min(frames.length(), index + 7)));
        JSONObject result = response.finish();
        assertEquals("real-response", result.getString("id"));
        assertEquals("preserve-exactly", result.getJSONArray("output").getJSONObject(0).getString("encrypted_content"));
        assertEquals("call", result.getJSONArray("output").getJSONObject(1).getString("call_id"));
    }
    @Test public void neverAcceptsPartialFunctionArgumentsAsAnExecutableResult() throws Exception {
        NativeAgentResponse response = new NativeAgentResponse();
        response.accept("data: {\"type\":\"response.function_call_arguments.delta\",\"delta\":\"{\"}\n\n");
        assertThrows(java.io.IOException.class, response::finish);
    }
    @Test public void providerErrorsAreTaskFailuresWithTheirActualMessage() {
        NativeAgentResponse response = new NativeAgentResponse();
        Exception error = assertThrows(java.io.IOException.class, () -> response.accept("data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"message\":\"model unavailable\"}}}\n\n"));
        assertEquals("model unavailable", error.getMessage());
    }
}
