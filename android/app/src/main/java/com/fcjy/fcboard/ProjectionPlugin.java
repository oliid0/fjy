package com.fcjy.fcboard;

import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiInfo;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import com.airplay.util.LocalTlsIdentityKt;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "FcboardProjection")
public class ProjectionPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private ProjectionServer server;
    private boolean background;
    private String requestedSession;
    private String url;
    private String address;

    @PluginMethod public synchronized void start(PluginCall call) {
        if (background) { call.reject("Board is in the background"); return; }
        String session = call.getString("session", "");
        if (session.isEmpty()) { call.reject("Projection session is required"); return; }
        requestedSession = session;
        worker.execute(() -> startServer(call, session));
    }

    private void startServer(PluginCall call, String session) {
        synchronized (this) {
            if (background || !session.equals(requestedSession)) { call.reject("Receiver session ended"); return; }
            if (ownsSession(call)) { call.resolve(info()); return; }
            stopServer();
        }
        String errorCode = "NETWORK";
        try {
            List<String> addresses = NetworkPlugin.lanAddresses(getContext());
            if (addresses.isEmpty()) {
                call.reject("Connect the board to Wi-Fi or Ethernet", "NETWORK");
                return;
            }
            String binding = addresses.get(0);
            errorCode = "START";
            ProjectionServer next = new ProjectionServer(binding,
                session,
                name -> getContext().getAssets().open("projection/" + name), (kind, signal) -> {
                    JSObject message = new JSObject();
                    message.put("kind", kind);
                    message.put("session", session);
                    message.put("sender", signal.optString("sender"));
                    if (signal.has("sdp")) message.put("sdp", signal.optString("sdp"));
                    notifyListeners("signal", message);
                });
            try {
                next.makeSecure(LocalTlsIdentityKt.projectionTlsContext(binding).getServerSocketFactory(),
                    android.os.Build.VERSION.SDK_INT >= 29
                        ? new String[] {"TLSv1.3", "TLSv1.2"}
                        : new String[] {"TLSv1.2"});
                next.start(120_000, true);
            } catch (Exception startError) {
                next.stop();
                throw startError;
            }
            synchronized (this) {
                if (background || !session.equals(requestedSession)) {
                    next.stop();
                    call.reject("Receiver session ended");
                    return;
                }
                server = next;
                address = binding;
                url = "https://" + binding + ":" + next.getListeningPort() + next.path;
                call.resolve(info());
            }
        } catch (Exception error) {
            call.reject("Could not start secure reception", errorCode, error);
        }
    }

    @PluginMethod public void network(PluginCall call) {
        try {
            List<String> addresses = NetworkPlugin.lanAddresses(getContext());
            String requested = call.getString("address", "");
            String ip = addresses.contains(requested) ? requested : addresses.isEmpty() ? "" : addresses.get(0);
            JSObject result = new JSObject().put("address", ip).put("name", "").put("transport", "");
            ConnectivityManager manager = getContext().getSystemService(ConnectivityManager.class);
            if (!ip.isEmpty() && manager != null) {
                for (Network network : manager.getAllNetworks()) {
                    LinkProperties link = manager.getLinkProperties(network);
                    NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
                    if (link == null || capabilities == null || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) ||
                        link.getLinkAddresses().stream().noneMatch(item -> ip.equals(item.getAddress().getHostAddress()))) continue;
                    if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                        result.put("transport", "wifi");
                        if (Build.VERSION.SDK_INT >= 29 && capabilities.getTransportInfo() instanceof WifiInfo) {
                            String ssid = ((WifiInfo) capabilities.getTransportInfo()).getSSID();
                            if (ssid != null && !ssid.equals("<unknown ssid>")) {
                                result.put("name", ssid.replaceAll("^\"|\"$", ""));
                            }
                        }
                    } else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
                        result.put("transport", "ethernet");
                    }
                    break;
                }
            }
            call.resolve(result);
        } catch (Exception failure) {
            call.reject("Could not read the local network", "NETWORK", failure);
        }
    }

    private JSObject info() {
        return new JSObject().put("session", server.id).put("url", url).put("address", address);
    }

    @PluginMethod public synchronized void answer(PluginCall call) {
        try {
            if (!ownsSession(call)) throw new IOException("The projection session ended");
            server.answer(call.getString("sender", ""), call.getString("sdp", ""));
            call.resolve();
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
        }
    }

    @PluginMethod public synchronized void disconnect(PluginCall call) {
        if (ownsSession(call)) server.disconnect(call.getString("sender", ""));
        call.resolve();
    }

    @PluginMethod public synchronized void stop(PluginCall call) {
        if (call.getString("session", "").equals(requestedSession)) requestedSession = null;
        if (ownsSession(call)) stopServer();
        call.resolve();
    }

    private boolean ownsSession(PluginCall call) {
        return server != null && server.id.equals(call.getString("session"));
    }

    private void stopServer() {
        ProjectionServer current = server;
        server = null;
        url = null;
        address = null;
        if (current != null) current.stop();
    }

    @Override protected synchronized void handleOnStart() { background = false; }
    @Override protected synchronized void handleOnStop() { releaseReception(); }
    @Override protected synchronized void handleOnDestroy() { releaseReception(); worker.shutdownNow(); }

    private void releaseReception() {
        background = true;
        requestedSession = null;
        stopServer();
    }
}
