package com.fcjy.fcboard;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.Build;
import java.net.InetAddress;
import java.net.Inet4Address;
import java.util.List;
import java.util.Collections;
import android.os.Looper;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.function.Consumer;

/** DNS-SD resolves a human code on the current network, not a saved TXT IP. */
final class LanDiscovery implements AutoCloseable {
    private static final String TYPE = "_fcboard._tcp.";
    private final Handler main = new Handler(Looper.getMainLooper());
    private final NsdManager manager;
    private final WifiManager.MulticastLock multicast;
    private final Map<String, Lookup> lookups = new HashMap<>();
    private Advertisement advertisement;
    LanDiscovery(Context context) {
        manager = (NsdManager)context.getSystemService(Context.NSD_SERVICE);
        WifiManager wifi = (WifiManager)context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        multicast = wifi == null ? null : wifi.createMulticastLock("Fcboard-collaboration");
        if (multicast != null) multicast.setReferenceCounted(true);
    }
    static String createCode() {
        String alphabet = "0123456789";
        SecureRandom random = new SecureRandom(); StringBuilder code = new StringBuilder(4);
        for (int i = 0; i < 4; i++) code.append(alphabet.charAt(random.nextInt(alphabet.length())));
        return code.toString();
    }
    private void acquire() { if (multicast != null) multicast.acquire(); }
    private void release() { if (multicast != null && multicast.isHeld()) multicast.release(); }
    void advertise(String code, String token, int port, String address, Runnable success, Consumer<String> failure) {
        main.post(() -> {
            stopAdvertisement();
            Advertisement next = new Advertisement(success, failure); advertisement = next;
            try {
                if (manager == null) throw new IllegalStateException("局域网服务发现不可用");
                acquire(); next.locked = true;
                NsdServiceInfo info = new NsdServiceInfo();
                info.setServiceName("Fcboard-" + token.substring(0, 8)); info.setServiceType(TYPE); info.setPort(port);
                info.setAttribute("code", code); info.setAttribute("token", token); info.setAttribute("address", address);
                manager.registerService(info, NsdManager.PROTOCOL_DNS_SD, next);
            } catch (Exception error) { next.fail(error.getMessage()); }
        });
    }
    private final class Advertisement implements NsdManager.RegistrationListener {
        final Runnable success; final Consumer<String> failure; boolean locked, completed;
        Advertisement(Runnable success, Consumer<String> failure) { this.success = success; this.failure = failure; }
        void fail(String message) {
            if (advertisement != this || completed) return;
            completed = true; stopAdvertisement(); failure.accept(message);
        }
        public void onServiceRegistered(NsdServiceInfo info) { main.post(() -> {
            if (advertisement == this && !completed) { completed = true; success.run(); }
        }); }
        public void onRegistrationFailed(NsdServiceInfo info, int error) { main.post(() -> fail("无法发布协同码：" + error)); }
        public void onServiceUnregistered(NsdServiceInfo info) { }
        public void onUnregistrationFailed(NsdServiceInfo info, int error) { }
    }
    private void stopAdvertisement() {
        Advertisement old = advertisement; advertisement = null;
        if (old != null) {
            try { manager.unregisterService(old); } catch (RuntimeException ignored) { }
            if (old.locked) { old.locked = false; release(); }
            if (!old.completed) { old.completed = true; old.failure.accept("协同已取消"); }
        }
    }
    void stopAdvertising() { main.post(this::stopAdvertisement); }
    void resolve(String id, String code, Consumer<String> success, Consumer<String> failure) {
        main.post(() -> {
            if (id == null || id.isEmpty() || id.length() > 200 || !code.matches("[0-9A-Za-z]{4}") || lookups.containsKey(id)) {
                failure.accept("请输入四位协同码"); return;
            }
            Lookup lookup = new Lookup(id, code, success, failure); lookups.put(id, lookup); lookup.start();
        });
    }
    void cancel(String id) { main.post(() -> { Lookup lookup = lookups.get(id); if (lookup != null) lookup.finish(null, "协同已取消"); }); }
    private final class Lookup implements NsdManager.DiscoveryListener {
        final String id, code; final Consumer<String> success, failure;
        final ArrayDeque<NsdServiceInfo> queue = new ArrayDeque<>();
        final HashSet<String> seen = new HashSet<>();
        final Runnable timeout = () -> finish(null, "找不到该协同码，请确认设备位于同一局域网");
        boolean finished, started, resolving, locked;
        Lookup(String id, String code, Consumer<String> success, Consumer<String> failure) {
            this.id = id; this.code = code; this.success = success; this.failure = failure;
        }
        void start() {
            try {
                if (manager == null) throw new IllegalStateException("局域网服务发现不可用");
                acquire(); locked = true; main.postDelayed(timeout, 8000);
                manager.discoverServices(TYPE, NsdManager.PROTOCOL_DNS_SD, this); started = true;
            } catch (Exception error) { finish(null, error.getMessage()); }
        }
        void finish(String url, String error) {
            if (finished) return;
            finished = true; lookups.remove(id, this); main.removeCallbacks(timeout); queue.clear();
            if (started) { try { manager.stopServiceDiscovery(this); } catch (RuntimeException ignored) { } }
            if (locked) { locked = false; release(); }
            if (url != null) success.accept(url); else failure.accept(error);
        }
        void next() {
            if (finished || resolving || queue.isEmpty()) return;
            resolving = true;
            try { manager.resolveService(queue.removeFirst(), new NsdManager.ResolveListener() {
                public void onResolveFailed(NsdServiceInfo info, int error) { main.post(() -> { resolving = false; next(); }); }
                public void onServiceResolved(NsdServiceInfo info) { main.post(() -> {
                    resolving = false;
                    if (finished) return;
                    Map<String, byte[]> attributes = info.getAttributes();
                    String found = attribute(attributes, "code"), token = attribute(attributes, "token");
                    List<InetAddress> hosts = Build.VERSION.SDK_INT >= 34 ? info.getHostAddresses() : info.getHost() == null ? Collections.emptyList() : Collections.singletonList(info.getHost());
                    String address = resolvedAddress(hosts);
                    if (code.equals(found) && token.matches("[a-f0-9]{32}") && address != null && info.getPort() > 0 && info.getPort() <= 65535) {
                        finish("http://" + address + ":" + info.getPort() + "/#lan=" + token, null);
                    } else next();
                }); }
            }); } catch (RuntimeException error) { resolving = false; next(); }
        }
        public void onDiscoveryStarted(String type) { }
        public void onStartDiscoveryFailed(String type, int error) { main.post(() -> finish(null, "局域网服务发现失败：" + error)); }
        public void onStopDiscoveryFailed(String type, int error) { }
        public void onDiscoveryStopped(String type) { }
        public void onServiceLost(NsdServiceInfo info) { }
        public void onServiceFound(NsdServiceInfo info) { main.post(() -> {
            if (!finished && info.getServiceName().startsWith("Fcboard-") && seen.add(info.getServiceName())) { queue.add(info); next(); }
        }); }
    }
    private static String attribute(Map<String, byte[]> values, String key) {
        byte[] value = values.get(key); return value == null ? "" : new String(value, StandardCharsets.UTF_8);
    }
    static String resolvedAddress(List<InetAddress> addresses) {
        for (InetAddress address : addresses) {
            if (address instanceof Inet4Address && !address.isLoopbackAddress() && !address.isLinkLocalAddress() && !address.isAnyLocalAddress()) return address.getHostAddress();
        }
        return null;
    }
    @Override public void close() { main.post(() -> {
        stopAdvertisement();
        for (Lookup lookup : new java.util.ArrayList<>(lookups.values())) lookup.finish(null, "协同已取消");
    }); }
}
