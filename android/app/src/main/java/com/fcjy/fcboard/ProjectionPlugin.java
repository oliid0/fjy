package com.fcjy.fcboard;

import android.util.Base64;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.List;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;

@CapacitorPlugin(name = "FcboardProjection")
public class ProjectionPlugin extends Plugin {
    private ProjectionServer server;
    private boolean background;
    private String url;
    private Integer priorBarsBehavior;
    private int priorVisibleBars;

    @PluginMethod public synchronized void start(PluginCall call) {
        if (background) { call.reject("Board is in the background"); return; }
        if (server != null) {
            call.resolve(info());
            return;
        }
        boolean resume = call.getBoolean("resume", false);
        ProjectionIdentity configuration = new ProjectionIdentity(getContext());
        char[] password = null;
        byte[] pkcs12 = null;
        String errorCode = "CERTIFICATE";
        try {
            org.json.JSONObject identity = resume ? configuration.load() : new org.json.JSONObject()
                .put("certificate", call.getString("certificate", ""))
                .put("password", call.getString("password", ""))
                .put("host", call.getString("host", "").trim());
            if (identity == null) {
                call.reject("Set up the sender certificate first", "NOT_CONFIGURED");
                return;
            }
            String data = identity.getString("certificate");
            if (data.isEmpty() || data.length() > 512 * 1024) throw new IOException("Invalid certificate file");
            password = identity.getString("password").toCharArray();
            errorCode = "NETWORK";
            List<String> addresses = NetworkPlugin.lanAddresses(getContext());
            if (addresses.isEmpty()) {
                call.reject("Connect the board to Wi-Fi or Ethernet", "NETWORK");
                return;
            }
            String host = identity.getString("host");
            errorCode = "HOST";
            String address = addresses.get(0);
            if (host.isEmpty()) host = address;
            if (host.length() > 253 || !host.matches("[a-zA-Z0-9][a-zA-Z0-9.\\-]*")) {
                call.reject("Enter the certificate's DNS name or LAN IPv4 address", "HOST");
                return;
            }
            if (addresses.contains(host)) {
                address = host;
            } else {
                address = null;
                for (InetAddress resolved : InetAddress.getAllByName(host)) {
                    if (addresses.contains(resolved.getHostAddress())) {
                        address = resolved.getHostAddress();
                        break;
                    }
                }
                if (address == null) {
                    call.reject("The certificate hostname must resolve to this board on the LAN", "HOST");
                    return;
                }
            }

            errorCode = "CERTIFICATE";
            pkcs12 = Base64.decode(data, Base64.DEFAULT);
            KeyStore store = KeyStore.getInstance("PKCS12");
            store.load(new ByteArrayInputStream(pkcs12), password);
            KeyStore selected = KeyStore.getInstance("PKCS12");
            selected.load(null, password);
            for (String alias : java.util.Collections.list(store.aliases())) {
                Certificate certificate = store.getCertificate(alias);
                if (!store.isKeyEntry(alias) || !(certificate instanceof X509Certificate)) continue;
                X509Certificate leaf = (X509Certificate) certificate;
                if (!matchesHost(leaf, host)) continue;
                leaf.checkValidity();
                selected.setKeyEntry("projection", store.getKey(alias, password), password, store.getCertificateChain(alias));
                break;
            }
            if (selected.size() == 0) throw new IOException("The certificate must cover the sender URL");
            KeyManagerFactory keys = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
            keys.init(selected, password);
            SSLContext tls = SSLContext.getInstance("TLS");
            tls.init(keys.getKeyManagers(), null, null);

            errorCode = "START";
            String session = java.util.UUID.randomUUID().toString();
            ProjectionServer next = new ProjectionServer(address,
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
                next.makeSecure(tls.getServerSocketFactory(),
                    android.os.Build.VERSION.SDK_INT >= 29
                        ? new String[] {"TLSv1.3", "TLSv1.2"}
                        : new String[] {"TLSv1.2"});
                next.start(120_000, true);
                if (!resume) configuration.save(identity);
            } catch (Exception startError) {
                next.stop();
                throw startError;
            }
            server = next;
            url = "https://" + host + ":" + next.getListeningPort() + next.path;
            call.resolve(info());
        } catch (Exception error) {
            call.reject("Could not start secure reception", errorCode);
        } finally {
            if (password != null) Arrays.fill(password, '\0');
            if (pkcs12 != null) Arrays.fill(pkcs12, (byte) 0);
        }
    }

    private static boolean matchesHost(X509Certificate certificate, String host) throws Exception {
        java.util.Collection<List<?>> names = certificate.getSubjectAlternativeNames();
        if (names == null) return false;
        boolean ip = host.matches("[0-9.]+");
        for (List<?> entry : names) {
            if (entry.size() < 2 || !Integer.valueOf(ip ? 7 : 2).equals(entry.get(0)) ||
                !(entry.get(1) instanceof String)) continue;
            String name = (String) entry.get(1);
            if (host.equalsIgnoreCase(name)) return true;
            int dot = host.indexOf('.');
            if (!ip && dot > 0 && name.startsWith("*.") && name.indexOf('.', 2) > 2 &&
                host.substring(dot + 1).equalsIgnoreCase(name.substring(2))) return true;
        }
        return false;
    }

    private JSObject info() {
        return new JSObject().put("session", server.id).put("url", url);
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
        if (current != null) current.stop();
    }

    @Override protected synchronized void handleOnStart() { background = false; }
    @Override protected synchronized void handleOnStop() { releaseReception(); }
    @Override protected synchronized void handleOnDestroy() { releaseReception(); }

    private void releaseReception() {
        background = true;
        stopServer();
        getActivity().runOnUiThread(() -> setImmersive(false));
    }
}
