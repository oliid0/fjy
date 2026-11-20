package com.fcjy.fcboard;

import android.Manifest;
import android.app.AlertDialog;
import android.content.pm.PackageManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.airplay.BoardReceiver;
import com.airplay.castplus.CastPlusSupport;
import java.util.HashMap;
import java.util.Map;

@CapacitorPlugin(name = "FcboardNativeProjection", permissions = {
    @Permission(alias = "nearby", strings = { Manifest.permission.NEARBY_WIFI_DEVICES }),
    @Permission(alias = "castLocation", strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION })
})
public class ProjectionNativePlugin extends Plugin {
    private static final java.util.List<String> PROTOCOLS = java.util.Arrays.asList("airplay", "miracast", "dlna", "cast", "castplus");
    private final Map<String, BoardReceiver> engines = new HashMap<>();
    private final Map<String, String> owners = new HashMap<>();

    private volatile boolean background;
    private AlertDialog castPlusConsent;
    private String consentToken = "";

    private boolean hasWifiDirect() {
        return getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_WIFI_DIRECT);
    }

    private String p2pPermission() {
        return Build.VERSION.SDK_INT >= 33 ? "nearby" : "castLocation";
    }

    @PluginMethod public void start(PluginCall call) {
        String protocol = call.getString("protocol", "");
        String session = call.getString("session", "");
        if (!PROTOCOLS.contains(protocol)) {
            call.reject("Unknown receiver");
            return;
        }
        if (session.isEmpty()) { call.reject("Projection session is required"); return; }
        getActivity().runOnUiThread(() -> {
            if (background) { call.reject("Board is in the background"); return; }
            if (!session.equals(owners.put(protocol, session))) stopEngine(protocol);
            if ("castplus".equals(protocol)) { startCastPlus(call); return; }
            if (!"miracast".equals(protocol)) { begin(call, protocol); return; }
            if (!hasWifiDirect()) {
                call.reject("Wi-Fi Display is unavailable", "UNAVAILABLE");
                return;
            }
            if (getPermissionState(p2pPermission()) != PermissionState.GRANTED) {
                requestPermissionForAlias(p2pPermission(), call, "nearbyResult");
                return;
            }
            begin(call, protocol);
        });
    }

    private void startCastPlus(PluginCall call) {
        if (!CastPlusSupport.isAvailable()) {
            call.reject("Cast+ SDK unavailable on this device", "UNAVAILABLE");
            return;
        }
        if (!hasCastLocation() || (Build.VERSION.SDK_INT >= 33 && getPermissionState("nearby") != PermissionState.GRANTED)) {
            String[] permissions = Build.VERSION.SDK_INT >= 33
                ? new String[] { "castLocation", "nearby" } : new String[] { "castLocation" };
            requestPermissionForAliases(permissions, call, "castPlusResult");
            return;
        }
        begin(call, "castplus");
    }

    private boolean hasCastLocation() {
        return getContext().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @PermissionCallback private void castPlusResult(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (hasCastLocation() && (Build.VERSION.SDK_INT < 33 || getPermissionState("nearby") == PermissionState.GRANTED))
                begin(call, "castplus");
            else call.reject("Cast+ permissions are required", "PERMISSION");
        });
    }

    @PermissionCallback private void nearbyResult(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (getPermissionState(p2pPermission()) == PermissionState.GRANTED) begin(call, "miracast");
            else call.reject("Nearby devices permission is required", "PERMISSION");
        });
    }

    private void begin(PluginCall call, String protocol) {
        if (background || !owns(call, protocol)) { call.reject("Receiver session ended"); return; }
        BoardReceiver engine = engines.get(protocol);
        if (engine != null && !"error".equals(engine.getState())) {
            call.resolve();
            return;
        }
        stopEngine(protocol);
        try {
            BoardReceiver next = new BoardReceiver(getBridge().getWebView(), protocol,
                "castplus".equals(protocol) ? this::showCastPlusConsent : null);
            engines.put(protocol, next);
            next.start();
            call.resolve();
        } catch (Exception error) {
            stopEngine(protocol);
            android.util.Log.e("FcboardProjection", protocol + " receiver could not start", error);
            call.reject("Receiver could not start", "START", error);
        }
    }

    private void showCastPlusConsent(String token, String sender, String pin, boolean accepted) {
        if (castPlusConsent != null) {
            castPlusConsent.dismiss();
            castPlusConsent = null;
        }
        consentToken = token;
        BoardReceiver receiver = engines.get("castplus");
        if (token.isEmpty() || background || receiver == null || (accepted && pin.isEmpty())) return;
        String message = getContext().getString(R.string.projection_castplus_request,
            sender.isEmpty() ? "Cast+" : sender);
        if (!pin.isEmpty()) message += "\n\n" + getContext().getString(R.string.projection_castplus_pin, pin);
        AlertDialog.Builder dialog = new AlertDialog.Builder(getActivity())
            .setTitle(R.string.projection_castplus_title).setMessage(message)
            .setNegativeButton(android.R.string.cancel, (value, which) -> {
                if (consentToken.equals(token)) {
                    receiver.authorize(token, false);
                }
            }).setOnCancelListener(value -> {
                if (consentToken.equals(token)) {
                    receiver.authorize(token, false);
                }
            });
        if (!accepted) dialog.setPositiveButton(R.string.projection_castplus_allow,
            (value, which) -> { if (consentToken.equals(token)) receiver.authorize(token, true); });
        castPlusConsent = dialog.show();
    }

    private boolean owns(PluginCall call, String protocol) {
        return call.getString("session", "").equals(owners.get(protocol));
    }

    private void stopEngine(String protocol) {
        BoardReceiver engine = engines.remove(protocol);
        if (engine != null) engine.stop();
    }

    @PluginMethod public void status(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject result = new JSObject();
            for (String protocol : PROTOCOLS) {
                BoardReceiver engine = owns(call, protocol) ? engines.get(protocol) : null;
                String idle = ("miracast".equals(protocol) && !hasWifiDirect() ||
                    "castplus".equals(protocol) && !CastPlusSupport.isAvailable()) ? "unavailable" : "off";
                result.put(protocol, new JSObject().put("state", engine == null ? idle : engine.getState())
                    .put("hasFrames", engine != null && engine.getHasFrames())
                    .put("audio", engine != null && engine.getAudioOnly())
                    .put("title", engine == null ? "" : engine.getTitle())
                    .put("width", engine == null ? 0 : engine.getWidth())
                    .put("height", engine == null ? 0 : engine.getHeight())
                    .put("revision", engine == null ? 0 : engine.getRevision())
                    .put("name", engine == null ? "" : engine.getDisplayName()));
            }
            call.resolve(result);
        });
    }

    @PluginMethod public void position(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            BoardReceiver engine = engines.get(call.getString("protocol", ""));
            if (engine != null && engine.getRevision() == call.getInt("revision", -1)) {
                JSObject data = call.getData();
                engine.position(data.optDouble("cx"), data.optDouble("cy"), data.optDouble("width"),
                    data.optDouble("height"), data.optDouble("angle"), data.optDouble("viewport"));
            }
            call.resolve();
        });
    }

    @PluginMethod public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String protocol = call.getString("protocol", "");
            if (owns(call, protocol)) {
                owners.remove(protocol);
                stopEngine(protocol);
            }
            call.resolve();
        });
    }

    @PluginMethod public void disconnect(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String protocol = call.getString("protocol", "");
            if (!owns(call, protocol) || !engines.containsKey(protocol)) { call.resolve(); return; }
            stopEngine(protocol);
            begin(call, protocol);
        });
    }

    @Override protected void handleOnStart() { background = false; }
    @Override protected void handleOnStop() { releaseEngines(); }
    @Override protected void handleOnDestroy() { releaseEngines(); }

    private void releaseEngines() {
        background = true;
        getActivity().runOnUiThread(() -> {
            owners.clear();
            for (BoardReceiver engine : engines.values()) engine.stop();
            engines.clear();
        });
    }
}
