package com.fcjy.fcboard;

import android.content.Intent;
import android.os.Build;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.Inet4Address;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

@CapacitorPlugin(name = "FcboardNetwork")
public class NetworkPlugin extends Plugin {
    private LanServer server;
    private boolean sharing;
    private List<String> addresses = new ArrayList<>();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private synchronized void ensureServer() throws Exception {
        if (server != null) return;
        addresses.clear();
        for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
            if (!network.isUp() || network.isLoopback()) continue;
            for (java.net.InetAddress address : Collections.list(network.getInetAddresses())) {
                if (address instanceof Inet4Address && address.isSiteLocalAddress()) addresses.add(address.getHostAddress());
            }
        }
        if (addresses.isEmpty()) throw new IllegalStateException("请先连接同一局域网的 Wi-Fi 或有线网络");
        server = new LanServer(path -> getContext().getAssets().open("public/" + path), text -> {
            try { notifyListeners("message", new JSObject(text)); } catch (Exception ignored) { }
        });
        server.start(30000, true);
        NetworkSessionService.stopSession = () -> {
            synchronized (NetworkPlugin.this) {
                if (server != null) server.stop();
                server = null; sharing = false;
                JSObject event = new JSObject(); event.put("kind", "ended"); notifyListeners("message", event);
            }
        };
        Intent intent = new Intent(getContext(), NetworkSessionService.class);
        if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(intent);
        else getContext().startService(intent);
    }

    private JSArray urls(String path) {
        JSArray urls = new JSArray();
        for (String ip : addresses) urls.put("http://" + ip + ":" + server.getListeningPort() + path);
        return urls;
    }
    private synchronized void releaseIfIdle() {
        if (sharing) return;
        if (server != null) { server.stop(); server = null; }
        NetworkSessionService.stopSession = null;
        getContext().stopService(new Intent(getContext(), NetworkSessionService.class));
    }

    @PluginMethod public void startCollaboration(PluginCall call) {
        worker.execute(() -> {
            try {
                ensureServer();
                String token = server.startRoom(call.getObject("scene", new JSObject())); sharing = true;
                JSObject result = new JSObject(); result.put("urls", urls("/#lan=" + token)); call.resolve(result);
            } catch (Exception error) { releaseIfIdle(); call.reject("无法开启协作：" + error.getMessage()); }
        });
    }
    @PluginMethod public void sendScene(PluginCall call) {
        worker.execute(() -> {
            try { if (server == null) throw new IllegalStateException("协作未开启"); server.publish(call.getString("message", ""), null); call.resolve(); }
            catch (Exception error) { call.reject("同步失败：" + error.getMessage()); }
        });
    }
    @PluginMethod public void getScene(PluginCall call) {
        worker.execute(() -> {
            try { if (server == null) throw new IllegalStateException("协作已结束"); call.resolve(new JSObject(server.snapshotRoom().toString())); }
            catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    @PluginMethod public synchronized void stopCollaboration(PluginCall call) {
        if (server != null) server.stopRoom(); sharing = false; releaseIfIdle(); call.resolve();
    }
    @Override protected synchronized void handleOnDestroy() {
        sharing = false; releaseIfIdle(); worker.shutdownNow();
    }
}
