package com.fcjy.fcboard;

import android.Manifest;
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
import java.util.HashMap;
import java.util.Map;

@CapacitorPlugin(name = "FcboardNativeProjection", permissions = {
    @Permission(alias = "nearby", strings = { Manifest.permission.NEARBY_WIFI_DEVICES })
})
public class ProjectionNativePlugin extends Plugin {
    private final Map<String, BoardReceiver> engines = new HashMap<>();

    private volatile boolean background;
    private volatile long lifecycleRevision;

    private boolean canAdvertise() {
        return Build.VERSION.SDK_INT >= 34 &&
            getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_WIFI_DIRECT) &&
            getContext().checkSelfPermission(Manifest.permission.CONFIGURE_WIFI_DISPLAY) == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod public void start(PluginCall call) {
        String protocol = call.getString("protocol", "");
        if (!"airplay".equals(protocol) && !"miracast".equals(protocol) && !"dlna".equals(protocol)) {
            call.reject("Unknown receiver");
            return;
        }
        if ("miracast".equals(protocol)) {
            if (!canAdvertise()) {
                call.reject("Wi-Fi Display is unavailable", "UNAVAILABLE");
                return;
            }
            if (getPermissionState("nearby") != PermissionState.GRANTED) {
                call.getData().put("lifecycleRevision", lifecycleRevision);
                requestPermissionForAlias("nearby", call, "nearbyResult");
                return;
            }
        }
        begin(call, protocol);
    }

    @PermissionCallback private void nearbyResult(PluginCall call) {
        if (call.getData().optLong("lifecycleRevision", -1) != lifecycleRevision) { call.reject("Receiver session ended"); return; }
        if (getPermissionState("nearby") == PermissionState.GRANTED) begin(call, "miracast");
        else call.reject("Nearby devices permission is required", "PERMISSION");
    }

    private void begin(PluginCall call, String protocol) {
        getActivity().runOnUiThread(() -> {
            if (background) { call.reject("Board is in the background"); return; }
            BoardReceiver engine = engines.get(protocol);
            if (engine != null && !"error".equals(engine.getState())) {
                call.resolve();
                return;
            }
            if (engine != null) engine.stop();
            BoardReceiver next = new BoardReceiver(getBridge().getWebView(), protocol);
            engines.put(protocol, next);
            try {
                next.start();
                call.resolve();
            } catch (Exception error) {
                engines.remove(protocol);
                next.stop();
                call.reject("Receiver could not start", "START", error);
            }
        });
    }

    @PluginMethod public void status(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject result = new JSObject();
            for (String protocol : new String[] { "airplay", "miracast", "dlna" }) {
                BoardReceiver engine = engines.get(protocol);
                String idle = "miracast".equals(protocol) && !canAdvertise() ? "unavailable" : "off";
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
            BoardReceiver engine = engines.remove(call.getString("protocol", ""));
            if (engine != null) engine.stop();
            call.resolve();
        });
    }

    @Override protected void handleOnStart() { background = false; }
    @Override protected void handleOnStop() { releaseEngines(); }
    @Override protected void handleOnDestroy() { releaseEngines(); }

    private void releaseEngines() {
        background = true;
        lifecycleRevision++;
        getActivity().runOnUiThread(() -> {
            for (BoardReceiver engine : engines.values()) engine.stop();
            engines.clear();
        });
    }
}
