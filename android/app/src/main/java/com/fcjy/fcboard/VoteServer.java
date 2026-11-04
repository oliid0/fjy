package com.fcjy.fcboard;

import fi.iki.elonen.NanoHTTPD;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** apkxa Vote IndexController: one current ballot per device; replacing a ballot never adds a voter. */
final class VoteServer extends NanoHTTPD {
    final String token = UUID.randomUUID().toString().replace("-", "");
    private final String page;
    private final String topic;
    private final JSONArray options;
    private final boolean multiple;
    private boolean accepting = true;
    private final Map<String, Set<Integer>> ballots = new HashMap<>();
    VoteServer(String page, String topic, JSONArray options, boolean multiple) throws Exception {
        super("0.0.0.0", 0);
        if (topic == null || topic.trim().isEmpty() || topic.length() > 200 || options == null || options.length() < 2 || options.length() > 8) throw new IllegalArgumentException("请填写主题和2–8个选项");
        for (int i = 0; i < options.length(); i++) {
            Object item = options.get(i);
            if (!(item instanceof String) || ((String) item).trim().isEmpty() || ((String) item).length() > 120) throw new IllegalArgumentException("每个选项须为1–120字");
        }
        this.page = page; this.topic = topic.trim(); this.options = new JSONArray(options.toString()); this.multiple = multiple;
    }
    synchronized void setAccepting(boolean value) { accepting = value; }
    synchronized JSONObject snapshot(String voter) throws Exception {
        JSONArray counts = new JSONArray();
        for (int i = 0; i < options.length(); i++) { int count = 0; for (Set<Integer> ballot : ballots.values()) if (ballot.contains(i)) count++; counts.put(count); }
        return new JSONObject().put("topic", topic).put("options", options).put("multiple", multiple).put("accepting", accepting)
            .put("participants", ballots.size()).put("counts", counts).put("selection", new JSONArray(ballots.getOrDefault(voter, java.util.Collections.emptySet())));
    }
    synchronized void submit(String voter, JSONArray choices) throws Exception {
        if (!accepting) throw new IllegalStateException("投票已结束");
        if (voter == null || !voter.matches("[a-f0-9]{32}")) throw new IllegalArgumentException("请重新打开投票页面");
        if (choices == null || choices.length() < 1 || choices.length() > options.length() || (!multiple && choices.length() != 1)) throw new IllegalArgumentException("请选择有效选项");
        Set<Integer> result = new HashSet<>();
        for (int i = 0; i < choices.length(); i++) {
            Object value = choices.get(i);
            if (!(value instanceof Number)) throw new IllegalArgumentException("选项无效");
            int choice = ((Number) value).intValue();
            if (((Number) value).doubleValue() != choice || choice < 0 || choice >= options.length() || !result.add(choice)) throw new IllegalArgumentException("选项无效");
        }
        if (!ballots.containsKey(voter) && ballots.size() >= 5000) throw new IllegalStateException("参与人数已达上限");
        ballots.put(voter, result);
    }
    private Response json(Response.Status status, JSONObject value) {
        Response response = newFixedLengthResponse(status, "application/json; charset=utf-8", value.toString());
        response.addHeader("Cache-Control", "no-store"); response.addHeader("X-Content-Type-Options", "nosniff"); return response;
    }
    private String cookie(IHTTPSession session) {
        for (String item : session.getHeaders().getOrDefault("cookie", "").split(";")) {
            String value = item.trim(); if (value.matches("fcvote=[a-f0-9]{32}")) return value.substring(7);
        }
        return null;
    }
    @Override public Response serve(IHTTPSession session) {
        String root = "/" + token;
        if (!session.getUri().equals(root) && !session.getUri().startsWith(root + "/")) return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found");
        try {
            String voter = cookie(session);
            String path = session.getUri().substring(root.length());
            if ((path.isEmpty() || path.equals("/")) && session.getMethod() == Method.GET) {
                Response response = newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", page);
                if (voter == null) response.addHeader("Set-Cookie", "fcvote=" + UUID.randomUUID().toString().replace("-", "") + "; Path=" + root + "; HttpOnly; SameSite=Strict");
                response.addHeader("Cache-Control", "no-store");
                response.addHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
                return response;
            }
            if (path.equals("/api") && session.getMethod() == Method.GET) return json(Response.Status.OK, snapshot(voter));
            if (path.equals("/vote") && session.getMethod() == Method.POST) {
                String origin = session.getHeaders().get("origin");
                if (origin != null && !origin.equals("http://" + session.getHeaders().get("host"))) throw new IllegalArgumentException("请求来源无效");
                int length = Integer.parseInt(session.getHeaders().getOrDefault("content-length", "0"));
                if (length < 1 || length > 4096) throw new IllegalArgumentException("请求大小无效");
                byte[] body = new byte[length]; int offset = 0;
                while (offset < length) { int count = session.getInputStream().read(body, offset, length - offset); if (count < 0) throw new IllegalArgumentException("请求不完整"); offset += count; }
                submit(voter, new JSONObject(new String(body, StandardCharsets.UTF_8)).getJSONArray("choices"));
                return json(Response.Status.OK, snapshot(voter));
            }
            return newFixedLengthResponse(Response.Status.METHOD_NOT_ALLOWED, "text/plain", "Method not allowed");
        } catch (Exception error) {
            try { return json(error instanceof IllegalStateException ? Response.Status.CONFLICT : Response.Status.BAD_REQUEST, new JSONObject().put("error", error.getMessage())); }
            catch (Exception ignored) { return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "Vote failed"); }
        }
    }
}
