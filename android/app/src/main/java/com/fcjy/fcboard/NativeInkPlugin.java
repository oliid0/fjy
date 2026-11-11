package com.fcjy.fcboard;

import android.graphics.RectF;
import android.view.ViewGroup;
import android.view.MotionEvent;
import android.view.KeyEvent;
import android.view.InputDevice;
import android.widget.FrameLayout;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;

@CapacitorPlugin(name = "FcboardNativeInk")
public class NativeInkPlugin extends Plugin {
    private FrameLayout layer;
    private final java.util.concurrent.ExecutorService publisher = java.util.concurrent.Executors.newSingleThreadExecutor(runnable -> new Thread(runnable, "native-ink-events"));
    private final Map<String, NativeInkView> surfaces = new HashMap<>();
    private final Map<NativeInkView, RectF> inputBounds = new HashMap<>();
    private final Map<NativeInputStream, NativeInkView> capturedDevices = new HashMap<>();
    private final Map<String, Boolean> shortcutSurfaces = new HashMap<>();
    private final NativeBoardKeys keys = new NativeBoardKeys();
    private boolean touchLocked;
    @Override public void load() { ((MainActivity)getActivity()).setInkInput(this); }
    void sceneCommitted(String owner) { NativeInkView view=surfaces.get(owner);if(view!=null)view.sceneCommitted(); }
    /** Route the real event before ViewGroup can cancel another device's stream. */
    boolean dispatchInput(MotionEvent event) {
        if (touchLocked && event.isFromSource(InputDevice.SOURCE_TOUCHSCREEN)) return true;
        NativeInputStream device = new NativeInputStream(event);
        int action = event.getActionMasked();
        NativeInkView captured = capturedDevices.get(device);
        if (captured != null && action == MotionEvent.ACTION_DOWN) {
            captured.cancelStream(device); capturedDevices.remove(device); captured = null;
        }
        if (captured != null) {
            RectF bounds = inputBounds.get(captured);
            if (bounds != null) captured.handleTouchEvent(event, bounds.left, bounds.top);
            if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) capturedDevices.remove(device);
            return true;
        }
        if (action != MotionEvent.ACTION_DOWN) return false;
        for (Map.Entry<NativeInkView, RectF> entry : inputBounds.entrySet()) {
            RectF bounds = entry.getValue();
            if (bounds.contains(event.getX(), event.getY()) && entry.getKey().handleTouchEvent(event, bounds.left, bounds.top)) {
                capturedDevices.put(device, entry.getKey()); return true;
            }
        }
        return false;
    }
    boolean dispatchKey(KeyEvent event) {
        InputDevice device = event.getDevice();
        if (device == null) return false;
        boolean bsd = NativeBoardKeys.bsd(device.getName(), device.getVendorId(), device.getProductId());
        boolean hid = NativeBoardKeys.touchPlanet(device.getName(), device.getVendorId(), device.getProductId());
        if (!bsd && !hid) return false;
        String owner = null;
        for (Map.Entry<String, Boolean> surface : shortcutSurfaces.entrySet()) {
            if (surface.getValue() || touchLocked) { owner = surface.getKey(); break; }
        }
        if (owner == null) return false;
        int key = event.getKeyCode();
        String action = bsd ? NativeBoardKeys.vendorAction(key) : null;
        if (hid) {
            if (key == KeyEvent.KEYCODE_PAGE_UP) action = "previous";
            else if (key == KeyEvent.KEYCODE_PAGE_DOWN) action = "next";
            else if (event.isCtrlPressed() && event.isAltPressed() && event.isMetaPressed()) {
                if (key == KeyEvent.KEYCODE_B) action = "red";
                else if (key == KeyEvent.KEYCODE_C) action = "new";
            }
        }
        if (action == null) return false;
        if (event.getAction() != KeyEvent.ACTION_DOWN || event.getRepeatCount() != 0) return true;
        if (!keys.accept(action, bsd, event.getEventTime())) return true;
        if (action.equals("lock")) {
            touchLocked = true;
            for (NativeInkView view : surfaces.values()) view.cancel();
            capturedDevices.clear();
        } else if (action.equals("unlock")) touchLocked = false;
        notifyListeners("shortcut", new JSObject().put("owner", owner).put("action", action));
        return true;
    }
    private void layer() {
        if (layer != null) return;
        layer = new FrameLayout(getActivity());
        ((ViewGroup)getActivity().findViewById(android.R.id.content)).addView(layer, new ViewGroup.LayoutParams(-1, -1));
    }
    @PluginMethod public void configure(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                String owner = call.getString("owner", ""), token = call.getString("token", "");
                if (owner.isEmpty() || owner.length() > 200 || token.length() > 10000) throw new IllegalArgumentException("Invalid native pen owner");
                double x = call.getDouble("x", Double.NaN), y = call.getDouble("y", Double.NaN), width = call.getDouble("width", Double.NaN), height = call.getDouble("height", Double.NaN), viewport = call.getDouble("viewportWidth", Double.NaN), penWidth = call.getDouble("penWidth", 4.0), opacity = call.getDouble("opacity", 1.0);
                if (!Double.isFinite(x + y + width + height + viewport + penWidth + opacity) || width <= 0 || height <= 0 || viewport <= 0 || viewport > 20000 || penWidth <= 0 || penWidth > 200 || opacity < 0 || opacity > 1) throw new IllegalArgumentException("Invalid native pen bounds");
                layer(); NativeInkView view = surfaces.get(owner);
                if (view == null) {
                    if (surfaces.size() >= 4) throw new IllegalStateException("Too many native pen surfaces");
                    view = new NativeInkView(getActivity(), event -> { event.put("owner", owner); notifyListeners("contact", event); }, publisher);
                    view.setRoutedInput();
                    surfaces.put(owner, view); layer.addView(view);
                }
                float scale = getBridge().getWebView().getWidth() / (float)viewport;
                if (!(scale > 0)) throw new IllegalStateException("Whiteboard viewport is not ready");
                List<RectF> blocked = new ArrayList<>(); JSONArray boxes = call.getArray("blocked");
                if (boxes != null) {
                    if (boxes.length() > 512) throw new IllegalArgumentException("Too many native input exclusions");
                    for (int i = 0; i < boxes.length(); i++) {
                        JSONArray box = boxes.getJSONArray(i); blocked.add(new RectF((float)box.getDouble(0), (float)box.getDouble(1), (float)box.getDouble(2), (float)box.getDouble(3)));
                    }
                }
                view.setMultiStroke(call.getBoolean("multiStroke", true));
                view.setRetainedScene(() -> ((MainActivity)getActivity()).nativeScene(owner), !"object".equals(call.getString("eraserMode", "stroke")));
                shortcutSurfaces.put(owner, call.getBoolean("shortcutsEnabled", false));
                view.configure(token, call.getBoolean("enabled", false), (float)x, (float)y, scale, (float)penWidth, call.getFloat("unit", 1f), (float)opacity, call.getString("color", "#000000"), call.getBoolean("dashed", false), call.getFloat("palm", 36f), blocked, call.getObject("thick"), call.getFloat("thickThreshold", 0f), call.getString("mode", "pen"), call.getBoolean("palmEnabled", true), call.getFloat("eraserSize", 60f), call.getObject("appearance"));
                int[] web = new int[2], overlay = new int[2]; getBridge().getWebView().getLocationInWindow(web); layer.getLocationInWindow(overlay);
                FrameLayout.LayoutParams bounds = new FrameLayout.LayoutParams(Math.max(1, Math.round((float)width * scale)), Math.max(1, Math.round((float)height * scale)));
                bounds.leftMargin = Math.round(web[0] - overlay[0] + (float)x * scale); bounds.topMargin = Math.round(web[1] - overlay[1] + (float)y * scale);
                inputBounds.put(view, new RectF(web[0] + (float)x * scale, web[1] + (float)y * scale,
                    web[0] + ((float)x + (float)width) * scale, web[1] + ((float)y + (float)height) * scale));
                ViewGroup.LayoutParams old = view.getLayoutParams();
                if (!(old instanceof FrameLayout.LayoutParams) || old.width != bounds.width || old.height != bounds.height || ((FrameLayout.LayoutParams)old).leftMargin != bounds.leftMargin || ((FrameLayout.LayoutParams)old).topMargin != bounds.topMargin) view.setLayoutParams(bounds);
                call.resolve();
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    @PluginMethod public void acknowledge(PluginCall call) {
        getActivity().runOnUiThread(() -> { NativeInkView view = surfaces.get(call.getString("owner", "")); if (view != null) view.acknowledge(call.getString("id", ""),call.getString("elementId", ""),call.getBoolean("complete",false)); call.resolve(); });
    }
    @PluginMethod public void remove(PluginCall call) {
        getActivity().runOnUiThread(() -> { String owner = call.getString("owner", ""); shortcutSurfaces.remove(owner); NativeInkView view = surfaces.remove(owner); if (view != null) { view.cancel(); inputBounds.remove(view); layer.removeView(view); } if (surfaces.isEmpty()) { touchLocked = false; keys.reset(); } call.resolve(); });
    }
    @Override protected void handleOnPause() { getActivity().runOnUiThread(() -> { for (NativeInkView view : surfaces.values()) view.cancel(); capturedDevices.clear(); touchLocked = false; keys.reset(); }); }
    @Override protected void handleOnDestroy() {
        getActivity().runOnUiThread(() -> { ((MainActivity)getActivity()).setInkInput(null); for (NativeInkView view : surfaces.values()) view.cancel(); surfaces.clear(); inputBounds.clear(); capturedDevices.clear(); publisher.shutdown(); if (layer != null) { ((ViewGroup)layer.getParent()).removeView(layer); layer = null; } });
    }
}
