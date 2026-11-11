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
    private String roomToken = "", roomCode = "";
    private List<String> addresses = new ArrayList<>();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private LanDiscovery discovery;
    @Override public void load() { discovery = new LanDiscovery(getContext()); }
    private final LanPeerClient clients = new LanPeerClient(event -> {
        try { notifyListeners("peer", new JSObject(event.toString())); }
        catch (org.json.JSONException error) { throw new IllegalStateException(error); }
    });

    @PluginMethod public void connectPeer(PluginCall call) {
        worker.execute(() -> {
            try { clients.connect(call.getString("id", ""), call.getString("url", "")); call.resolve(); }
            catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    @PluginMethod public void sendPeer(PluginCall call) {
        worker.execute(() -> {
            try { clients.send(call.getString("id", ""), call.getString("text", "")); call.resolve(); }
            catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    @PluginMethod public void closePeer(PluginCall call) {
        clients.disconnect(call.getString("id", "")); call.resolve();
    }
    @PluginMethod public void resolveCollaborationCode(PluginCall call) {
        discovery.resolve(call.getString("id", ""), call.getString("code", ""),
            url -> call.resolve(new JSObject().put("url", url)), error -> call.reject(error));
    }
    @PluginMethod public void cancelCollaborationLookup(PluginCall call) {
        discovery.cancel(call.getString("id", "")); call.resolve();
    }

    /** Prefer real Wi-Fi/Ethernet link addresses, never a VPN or cellular interface. */
    static List<String> lanAddresses(android.content.Context context) throws Exception {
        java.util.LinkedHashSet<String> result = new java.util.LinkedHashSet<>();
        android.net.ConnectivityManager manager = (android.net.ConnectivityManager) context.getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
        if (manager != null) {
            for (android.net.Network network : manager.getAllNetworks()) {
                android.net.NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
                android.net.LinkProperties link = manager.getLinkProperties(network);
                if (capabilities == null || link == null || capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN)
                        || !(capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI)
                        || capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET))) continue;
                for (android.net.LinkAddress linkAddress : link.getLinkAddresses()) {
                    java.net.InetAddress address = linkAddress.getAddress();
                    if (address instanceof Inet4Address && !address.isLoopbackAddress() && !address.isLinkLocalAddress() && !address.isAnyLocalAddress()) result.add(address.getHostAddress());
                }
            }
        }
        // Hotspot/tethering links are not always exposed as ConnectivityManager networks.
        for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
            if (!network.isUp() || network.isLoopback() || !network.getName().matches("(?i)(wlan|wifi|eth|en|ap|swlan|usb|rndis)[0-9_.:-]*")) continue;
            for (java.net.InetAddress address : Collections.list(network.getInetAddresses())) {
                if (address instanceof Inet4Address && address.isSiteLocalAddress()) result.add(address.getHostAddress());
            }
        }
        return new ArrayList<>(result);
    }

    private synchronized void ensureServer() throws Exception {
        addresses = lanAddresses(getContext());
        if (addresses.isEmpty()) throw new IllegalStateException("请先连接同一局域网的 Wi-Fi 或有线网络");
        if (server != null) return;
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
        if (discovery != null) discovery.stopAdvertising();
        if (server != null) { server.stop(); server = null; }
        NetworkSessionService.stopSession = null;
        getContext().stopService(new Intent(getContext(), NetworkSessionService.class));
    }

    @PluginMethod public void startCollaboration(PluginCall call) {
        worker.execute(() -> {
            try {
                ensureServer();
                String token = server.startRoom(call.getObject("scene", new JSObject())); sharing = true; roomToken = token;
                String code = LanDiscovery.createCode(); roomCode = code;
                JSObject result = new JSObject(); result.put("urls", urls("/#lan=" + token)); result.put("code", code);
                LanServer current = server;
                discovery.advertise(code, token, current.getListeningPort(), addresses.get(0),
                    () -> { if (sharing && server == current) call.resolve(result); else call.reject("协同已取消"); },
                    error -> { synchronized (NetworkPlugin.this) { if (server == current) { sharing = false; releaseIfIdle(); } } call.reject(error); });
            } catch (Exception error) { releaseIfIdle(); call.reject("无法开启协作：" + error.getMessage()); }
        });
    }
    @PluginMethod public void collaborationInfo(PluginCall call) {
        worker.execute(() -> {
            try {
                synchronized (NetworkPlugin.this) {
                    if (!sharing || server == null) { call.resolve(new JSObject().put("sharing", false).put("urls", new JSArray())); return; }
                    addresses = lanAddresses(getContext());
                    call.resolve(new JSObject().put("sharing", true).put("code", roomCode).put("urls", urls("/#lan=" + roomToken)));
                }
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    /** QRHttpPopu changes the existing share's password; it does not create a new room/link. */
    @PluginMethod public void setCollaborationPassword(PluginCall call) {
        worker.execute(() -> {
            try {
                if (server == null || !sharing) throw new IllegalStateException("协作已结束");
                server.setPassword(call.getString("password", "")); call.resolve();
            } catch (Exception error) { call.reject(error.getMessage()); }
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
        sharing = false; releaseIfIdle(); if (discovery != null) discovery.close(); clients.close(); worker.shutdownNow();
    }
}
