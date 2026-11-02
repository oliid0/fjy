package com.fcjy.fcboard;

import static org.junit.Assert.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import fi.iki.elonen.NanoHTTPD;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Exercises production React UI, native HTTP/SSE bridge, IndexedDB and opaque-origin lesson frame. */
@RunWith(AndroidJUnit4.class)
public class GeneratedResourceTest {
    private String title;
    private String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, result -> {
            value.set(result); done.countDown();
        }));
        assertTrue("WebView evaluation must complete", done.await(5, TimeUnit.SECONDS));
        return value.get();
    }

    private void until(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        for (int attempt = 0; attempt < 100; attempt++) {
            if ("true".equals(evaluate(scenario, script))) return;
            Thread.sleep(300);
        }
        fail("Production UI did not reach the expected state: " + script + "; visible feedback: " +
            evaluate(scenario, "Array.from(document.querySelectorAll('[role=alert],[role=status]')).map(n=>n.textContent).join(' | ')"));
    }

    private JSONObject requestFrame(ActivityScenario<MainActivity> scenario, JSONObject request) throws Exception {
        evaluate(scenario, "window.__fcResourceReply=null;(()=>{const f=document.querySelector('iframe[title=\"" + title + "\"]');const c=new MessageChannel();c.port1.onmessage=e=>{window.__fcResourceReply=e.data;c.port1.close();};f.contentWindow.postMessage({type:'fc-resource-control-v1',request:" + request + "},'*',[c.port2]);})();true");
        until(scenario, "window.__fcResourceReply!==null");
        JSONObject reply = new JSONObject(evaluate(scenario, "window.__fcResourceReply"));
        assertTrue(reply.toString(), reply.getBoolean("ok"));
        return reply.getJSONObject("state");
    }

    @Test public void generatedStreamedHtmlRunsAndItsControlsChangeTheActualExperiment() throws Exception { generate(false); }
    @Test public void generatedCssAnimationPlaysWithoutAuthoredJavaScript() throws Exception { generate(true); }

    private void generate(boolean animation) throws Exception {
        title = animation ? "Native animation lesson" : "Native stream lesson";
        String scene = animation
            ? "<style>@keyframes travel{to{transform:translateX(300px)}}circle{animation:travel 4s linear infinite}</style><h1>牛顿第一定律演示</h1><p>无外力时保持匀速直线运动</p><svg viewBox='0 0 400 100'><circle cx='20' cy='50' r='10' fill='teal'/></svg>"
            : "<h1>牛顿第二定律演示</h1><label>Force (N)<input id='force' type='range' min='0' max='20' value='4'></label><svg viewBox='0 0 400 100'><rect id='block' y='20' width='40' height='40' fill='teal'/></svg><output id='acceleration'></output><script>const force=document.getElementById('force');function update(){const a=Number(force.value)/2;document.getElementById('acceleration').textContent=a+' m/s²';document.getElementById('block').setAttribute('x',String(a*30));}force.addEventListener('input',update);update();</script>";
        String html = "<!doctype html><html><head><title>" + title + "</title></head><body>" + scene + "</body></html>";
        String lesson = animation ? html : new JSONObject().put("title", title).put("html", html).toString();
        String frames = "data: " + new JSONObject().put("choices", new JSONArray().put(new JSONObject().put("delta", new JSONObject().put("content", lesson)))) + "\n\n" +
            "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
        AtomicReference<JSONObject> sent = new AtomicReference<>();
        AtomicReference<Exception> serverError = new AtomicReference<>();
        NanoHTTPD server = new NanoHTTPD("127.0.0.1", 0) {
            @Override public Response serve(IHTTPSession session) {
                try {
                    HashMap<String, String> body = new HashMap<>();
                    session.parseBody(body); sent.set(new JSONObject(body.get("postData")));
                    return newChunkedResponse(Response.Status.OK, "text/event-stream; charset=utf-8", new ByteArrayInputStream(frames.getBytes(StandardCharsets.UTF_8)));
                } catch (Exception error) {
                    serverError.set(error);
                    return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "application/json", "{}");
                }
            }
        };
        server.start();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            try {
                until(scenario, "!!document.querySelector('.fc-unified-toolbar')");
                JSONObject settings = new JSONObject().put("endpoint", "http://127.0.0.1:" + server.getListeningPort() + "/chat")
                    .put("apiKey", "native-test-only").put("model", "native-test-model").put("speech", "system");
                evaluate(scenario, "window.__fcBeforeReload=true;localStorage.setItem('fcboard-settings'," + JSONObject.quote(settings.toString()) + ");sessionStorage.removeItem('fcboard-keys');localStorage.setItem('fcboard-language','zh-CN');location.reload();true");
                until(scenario, "!window.__fcBeforeReload && !!document.querySelector('.fc-unified-toolbar')");
                evaluate(scenario, "document.querySelector('[data-board-insert]').click();true");
                until(scenario, "Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='教学资源')");
                evaluate(scenario, "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='教学资源').click();true");
                until(scenario, "!!document.querySelector('.fc-resource-library input')");
                evaluate(scenario, "(()=>{const input=document.querySelector('.fc-resource-library input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'牛顿第一定律演示');input.dispatchEvent(new Event('input',{bubbles:true}));})();true");
                until(scenario, "document.querySelector('.fc-resource-generation button')?.disabled===false");
                evaluate(scenario, "document.querySelector('.fc-resource-generation button').click();true");
                until(scenario, "!!document.querySelector('iframe[title=\"" + title + "\"]') && !document.querySelector('.fc-resource-library')");
                assertNull(serverError.get()); assertNotNull("The real native bridge must send the request", sent.get());
                assertEquals("native-test-model", sent.get().getString("model")); assertTrue(sent.get().getBoolean("stream"));
                assertTrue(sent.get().getJSONArray("messages").getJSONObject(1).getString("content").contains("牛顿第一定律演示"));
                assertEquals("\"allow-scripts\"", evaluate(scenario, "document.querySelector('iframe[title=\"" + title + "\"]').getAttribute('sandbox')"));
                // Wait for the production runtime, then inspect via its actual scoped MessageChannel.
                Thread.sleep(500);
                JSONObject state = requestFrame(scenario, new JSONObject().put("type", "inspect"));
                if (animation) {
                    double first = circleX(state);
                    Thread.sleep(400);
                    assertTrue("The CSS animation must actually move the illustrated object", Math.abs(first - circleX(requestFrame(scenario, new JSONObject().put("type", "inspect")))) > 1);
                } else {
                    assertEquals("2 m/s²", state.getJSONArray("outputs").getString(0));
                    JSONArray controls = state.getJSONArray("controls"); String control = null;
                    for (int i = 0; i < controls.length(); i++) if ("range".equals(controls.getJSONObject(i).getString("type"))) control = controls.getJSONObject(i).getString("id");
                    assertNotNull(control);
                    JSONObject changed = requestFrame(scenario, new JSONObject().put("type", "set").put("version", state.getString("version")).put("control", control).put("value", 10));
                    assertEquals("5 m/s²", changed.getJSONArray("outputs").getString(0));
                }
                evaluate(scenario, "window.__fcBeforeReload=true;location.reload();true");
                until(scenario, "!window.__fcBeforeReload && !!document.querySelector('iframe[title=\"" + title + "\"]')");
            } finally {
                evaluate(scenario, "localStorage.removeItem('fcboard-settings');sessionStorage.removeItem('fcboard-keys');true");
            }
        } finally { server.stop(); }
    }

    private double circleX(JSONObject state) throws Exception {
        JSONArray controls = state.getJSONArray("controls");
        for (int i = 0; i < controls.length(); i++) {
            JSONObject control = controls.getJSONObject(i);
            if ("circle".equals(control.optString("kind"))) return control.getJSONObject("bounds").getDouble("x");
        }
        throw new AssertionError("The generated animated circle must be inspectable");
    }
}
