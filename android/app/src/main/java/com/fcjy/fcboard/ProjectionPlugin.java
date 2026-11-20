package com.fcjy.fcboard;

import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiInfo;
import android.os.Build;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.net.InetAddress;
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
    private Integer priorBarsBehavior;
    private int priorVisibleBars;

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
            errorCode = "CERTIFICATE";
            ProjectionTls tls = new ProjectionTls(getContext());
            errorCode = "HOST";
            String binding = null;
            for (InetAddress resolved : InetAddress.getAllByName(tls.host)) {
                if (addresses.contains(resolved.getHostAddress())) {
                    binding = resolved.getHostAddress();
                    break;
                }
            }
            if (binding == null) throw new IOException("Managed projection hostname does not resolve to this board");

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
                next.makeSecure(tls.context().getServerSocketFactory(),
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
                url = "https://" + tls.host + ":" + next.getListeningPort() + next.path;
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

    @PluginMethod public void immersive(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            setImmersive(call.getBoolean("active", false));
            call.resolve();
        });
    }

    private void setImmersive(boolean active) {
        android.view.Window window = getActivity().getWindow();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (active && priorBarsBehavior == null) {
            WindowInsetsCompat insets = androidx.core.view.ViewCompat.getRootWindowInsets(window.getDecorView());
            if (insets == null) return;
            priorVisibleBars = 0;
            for (int type : new int[] { WindowInsetsCompat.Type.statusBars(), WindowInsetsCompat.Type.navigationBars(),
                    WindowInsetsCompat.Type.captionBar() }) {
                if (insets.isVisible(type)) priorVisibleBars |= type;
            }
            priorBarsBehavior = controller.getSystemBarsBehavior();
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            controller.hide(WindowInsetsCompat.Type.systemBars());
        } else if (!active && priorBarsBehavior != null) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
            controller.show(priorVisibleBars);
            controller.setSystemBarsBehavior(priorBarsBehavior);
            priorBarsBehavior = null;
        }
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
        getActivity().runOnUiThread(() -> setImmersive(false));
    }
}
