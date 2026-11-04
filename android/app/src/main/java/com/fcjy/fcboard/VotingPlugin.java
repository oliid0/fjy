package com.fcjy.fcboard;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "FcboardVoting")
public class VotingPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private VoteServer server;
    private List<String> addresses;
    private void close() { if (server != null) server.stop(); server = null; }
    private JSObject state() throws Exception {
        if (server == null) return new JSObject().put("active", false);
        JSObject result = new JSObject(server.snapshot("").toString());
        JSArray urls = new JSArray();
        for (String ip : addresses) urls.put("http://" + ip + ":" + server.getListeningPort() + "/" + server.token);
        return result.put("active", true).put("urls", urls);
    }
    @PluginMethod public void start(PluginCall call) {
        worker.execute(() -> {
            VoteServer next = null;
            try {
                List<String> links = NetworkPlugin.lanAddresses(getContext());
                if (links.isEmpty()) throw new IllegalStateException("请先连接局域网Wi-Fi或有线网络");
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                try (InputStream input = getContext().getAssets().open("vote.html")) { byte[] buffer = new byte[8192]; int count; while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count); }
                next = new VoteServer(output.toString("UTF-8"), call.getString("topic"), call.getArray("options"), call.getBoolean("multiple", false));
                next.start(5000, true);
                close(); server = next; addresses = links; call.resolve(state());
            } catch (Exception error) { if (next != null && next != server) next.stop(); call.reject(error.getMessage(), error); }
        });
    }
    @PluginMethod public void read(PluginCall call) { worker.execute(() -> { try { call.resolve(state()); } catch (Exception error) { call.reject(error.getMessage(), error); } }); }
    @PluginMethod public void end(PluginCall call) { worker.execute(() -> { try { if (server == null) throw new IllegalStateException("请先发起投票"); server.setAccepting(false); call.resolve(state()); } catch (Exception error) { call.reject(error.getMessage(), error); } }); }
    @PluginMethod public void clear(PluginCall call) { worker.execute(() -> { close(); call.resolve(new JSObject().put("active", false)); }); }
    @Override protected void handleOnDestroy() { worker.execute(this::close); worker.shutdown(); }
}
