package com.fcjy.fcboard;

import fi.iki.elonen.NanoHTTPD;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** A bounded LAN poll runs inside the app; no vendor package or cloud account. */
final class ClassroomPollServer extends NanoHTTPD {
    final String token = UUID.randomUUID().toString().replace("-", "");
    final String question;
    final String[] options;
    private final Map<String, Integer> votes = new HashMap<>();
    private boolean closed;
    ClassroomPollServer(String question, JSONArray input) throws Exception {
        super("0.0.0.0", 0);
        if (question == null || question.trim().isEmpty() || question.length() > 500 || input == null || input.length() < 2 || input.length() > 10) throw new Exception("请输入投票问题和2至10个选项");
        this.question = question.trim(); options = new String[input.length()];
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (int i = 0; i < options.length; i++) {
            options[i] = input.getString(i).trim();
            if (options[i].isEmpty() || options[i].length() > 200 || !seen.add(options[i])) throw new Exception("投票选项必须非空且不重复");
        }
    }
    synchronized JSONObject snapshot() throws Exception {
        int[] counts = new int[options.length];
        for (int option : votes.values()) counts[option]++;
        return new JSONObject().put("question", question).put("options", new JSONArray(options)).put("counts", new JSONArray(counts)).put("total", votes.size()).put("closed", closed);
    }
    synchronized void closeVoting() { closed = true; }
    synchronized void vote(String voter, int choice) throws Exception {
        if (closed) throw new Exception("投票已结束");
        if (!voter.matches("[A-Za-z0-9-]{8,80}") || choice < 0 || choice >= options.length || (!votes.containsKey(voter) && votes.size() >= 1000)) throw new Exception("无效投票或人数已满");
        votes.put(voter, choice);
    }
    private static String escape(String text) { return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;"); }
    @Override public Response serve(IHTTPSession session) {
        String path = "/" + token + "/";
        if (!session.getUri().equals(path)) return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not found");
        try {
            if (session.getMethod() == Method.POST) {
                String origin = session.getHeaders().get("origin");
                if (origin != null && !origin.equals("http://" + session.getHeaders().get("host"))) return newFixedLengthResponse(Response.Status.FORBIDDEN, MIME_PLAINTEXT, "Forbidden");
                String length = session.getHeaders().get("content-length");
                if (length == null || Integer.parseInt(length) > 2048 || Integer.parseInt(length) < 1) throw new Exception("请求过大");
                session.parseBody(new HashMap<>());
                vote(session.getParms().getOrDefault("voter", ""), Integer.parseInt(session.getParms().getOrDefault("choice", "-1")));
                return newFixedLengthResponse(Response.Status.OK, "application/json", "{\"saved\":true}");
            }
            if (session.getMethod() != Method.GET) return newFixedLengthResponse(Response.Status.METHOD_NOT_ALLOWED, MIME_PLAINTEXT, "Method not allowed");
            StringBuilder page = new StringBuilder("<!doctype html><html lang='zh-CN'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>课堂投票</title><style>body{font:18px system-ui;max-width:600px;margin:32px auto;padding:16px}label{display:block;padding:14px;border:1px solid #ddd;margin:12px 0;border-radius:8px}button{font:inherit;padding:12px 24px}p{white-space:pre-wrap}</style><h1>课堂投票</h1><p>");
            page.append(escape(question)).append("</p><form id='poll'>");
            for (int i = 0; i < options.length; i++) page.append("<label><input required type='radio' name='choice' value='").append(i).append("'> ").append(escape(options[i])).append("</label>");
            page.append("<button>提交投票 / 修改选择</button></form><p id='status' role='status'></p><script>const f=document.getElementById('poll'),s=document.getElementById('status');let v=sessionStorage.getItem('fc-poll-voter');if(!v){v=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);sessionStorage.setItem('fc-poll-voter',v)}f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button');b.disabled=true;s.textContent='正在提交…';try{const d=new URLSearchParams(new FormData(f));d.set('voter',v);const r=await fetch(location.pathname,{method:'POST',body:d});if(!r.ok)throw Error(await r.text());s.textContent='已提交，可修改选择后再次提交';}catch(e){s.textContent=e.message}finally{b.disabled=false}};</script></html>");
            Response response = newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", page.toString());
            response.addHeader("Cache-Control", "no-store"); response.addHeader("X-Content-Type-Options", "nosniff"); return response;
        } catch (Exception error) { return newFixedLengthResponse(Response.Status.BAD_REQUEST, MIME_PLAINTEXT, error.getMessage() == null ? "Invalid vote" : error.getMessage()); }
    }
}
