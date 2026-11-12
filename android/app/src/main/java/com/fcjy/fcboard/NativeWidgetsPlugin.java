package com.fcjy.fcboard;

import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashMap;
import java.util.Map;

/** Native object surfaces share the whiteboard's saved geometry and history.
 * Only completed gestures cross the bridge; in-flight movement stays in Views. */
@CapacitorPlugin(name = "FcboardNativeWidgets")
public class NativeWidgetsPlugin extends Plugin {
    private FrameLayout layer;
    private final Map<String, Entry> entries = new HashMap<>();
    private static final class Entry {
        String instance, objectId;
        NativeCalculatorView view;
        float x, y, width, height, scale, startX, startY, startWidth, startHeight;
        boolean gesturing, hostDark;
    }
    private void layer() {
        if (layer != null) return;
        layer = new FrameLayout(getActivity());
        layer.setClipChildren(true); layer.setClipToPadding(true);
        ((ViewGroup)getActivity().findViewById(android.R.id.content)).addView(layer, new ViewGroup.LayoutParams(-1, -1));
    }
    private void place(Entry entry) {
        int[] web = new int[2], overlay = new int[2];
        getBridge().getWebView().getLocationInWindow(web); layer.getLocationInWindow(overlay);
        FrameLayout.LayoutParams bounds = new FrameLayout.LayoutParams(Math.max(1, Math.round(entry.width * entry.scale)), Math.max(1, Math.round(entry.height * entry.scale)));
        bounds.leftMargin = Math.round(web[0] - overlay[0] + entry.x * entry.scale);
        bounds.topMargin = Math.round(web[1] - overlay[1] + entry.y * entry.scale);
        entry.view.setLayoutParams(bounds);
    }
    @PluginMethod public void upsert(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                String instance = call.getString("instance", ""), id = call.getString("objectId", "");
                double x = call.getDouble("x", Double.NaN), y = call.getDouble("y", Double.NaN), width = call.getDouble("width", Double.NaN), height = call.getDouble("height", Double.NaN), viewport = call.getDouble("viewportWidth", Double.NaN);
                if (!instance.matches("[a-fA-F0-9-]{36}") || id.isEmpty() || id.length() > 200 ||
                    !Double.isFinite(x + y + width + height + viewport) || width <= 0 || height <= 0 || width > 20000 || height > 20000 || viewport <= 0 || viewport > 20000) throw new IllegalArgumentException("Invalid native object bounds");
                layer();
                Entry entry = entries.get(instance);
                if (entry == null) {
                    if (entries.size() >= 8) throw new IllegalStateException("Too many visible native objects");
                    entry = new Entry(); entry.instance = instance; entry.objectId = id;
                    final Entry created = entry;
                    entry.view = new NativeCalculatorView(getActivity(), (type, dx, dy) -> action(created, type, dx, dy));
                    entries.put(instance, entry); layer.addView(entry.view);
                }
                entry.scale = getBridge().getWebView().getWidth() / (float)viewport;
                if (!(entry.scale > 0)) throw new IllegalStateException("Whiteboard viewport is not ready");
                if (!entry.gesturing) { entry.x = (float)x; entry.y = (float)y; entry.width = (float)width; entry.height = (float)height; place(entry); }
                boolean dark = call.getBoolean("dark", false);
                if (dark != entry.hostDark) { entry.hostDark = dark; entry.view.theme(dark); }
                entry.view.interactionEnabled(call.getBoolean("interactive", true));
                entry.view.setVisibility(call.getBoolean("visible", true) ? View.VISIBLE : View.INVISIBLE);
                call.resolve();
            } catch (Exception error) { call.reject("Native calculator unavailable: " + error.getMessage(), error); }
        });
    }
    private void action(Entry entry, String type, float dx, float dy) {
        if (type.equals("close")) {
            entry.view.setVisibility(View.GONE);
            notifyListeners("action", new JSObject().put("instance", entry.instance).put("type", "close")); return;
        }
        if (type.endsWith("-start")) {
            entry.gesturing = true; entry.startX = entry.x; entry.startY = entry.y; entry.startWidth = entry.width; entry.startHeight = entry.height; return;
        }
        if (type.equals("cancel")) {
            entry.gesturing = false; entry.x = entry.startX; entry.y = entry.startY; entry.width = entry.startWidth; entry.height = entry.startHeight; place(entry); return;
        }
        if (!entry.gesturing) return;
        float cssX = dx / entry.scale, cssY = dy / entry.scale;
        if (type.startsWith("move")) { entry.x = entry.startX + cssX; entry.y = entry.startY + cssY; }
        else { entry.width = Math.max(72, entry.startWidth + cssX); entry.height = Math.max(144, entry.startHeight + cssY); }
        place(entry);
        if (type.endsWith("-end")) {
            entry.gesturing = false;
            notifyListeners("action", new JSObject().put("instance", entry.instance).put("type", "bounds")
                .put("dx", entry.x - entry.startX).put("dy", entry.y - entry.startY)
                .put("dw", entry.width - entry.startWidth).put("dh", entry.height - entry.startHeight));
        }
    }
    @PluginMethod public void remove(PluginCall call) {
        getActivity().runOnUiThread(() -> { Entry entry = entries.remove(call.getString("instance", "")); if (entry != null && layer != null) layer.removeView(entry.view); call.resolve(); });
    }
    @PluginMethod public void control(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                Entry entry = entries.values().stream().filter(value -> value.objectId.equals(call.getString("objectId")) && value.view.isShown()).findFirst().orElseThrow(() -> new IllegalStateException("Native calculator is not visible"));
                String type = call.getString("type", "inspect");
                if (type.equals("click")) entry.view.pressControl(call.getString("version", ""), call.getString("control", ""));
                else if (!type.equals("inspect")) throw new IllegalArgumentException("Unsupported native calculator action");
                call.resolve(entry.view.state(entry.scale));
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    @Override protected void handleOnPause() { if (layer != null) getActivity().runOnUiThread(() -> layer.setVisibility(View.GONE)); }
    @Override protected void handleOnResume() { if (layer != null) getActivity().runOnUiThread(() -> layer.setVisibility(View.VISIBLE)); }
    @Override protected void handleOnDestroy() {
        getActivity().runOnUiThread(() -> { entries.clear(); if (layer != null) { ((ViewGroup)layer.getParent()).removeView(layer); layer = null; } });
    }
}
