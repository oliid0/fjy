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
    private FrameLayout overlay;
    private final java.util.concurrent.ExecutorService publisher = java.util.concurrent.Executors.newSingleThreadExecutor(runnable -> new Thread(runnable, "native-ink-events"));
    private final Map<String, NativeInkView> surfaces = new HashMap<>();
    private final Map<NativeInkView, RectF> inputBounds = new HashMap<>();
    private final NativeInputRouter inputRouter = new NativeInputRouter(inputBounds);
    private final Map<String, Boolean> shortcutSurfaces = new HashMap<>();
    private final NativeBoardKeys keys = new NativeBoardKeys();
    private boolean touchLocked;
    private android.hardware.input.InputManager inputManager;
    private final android.hardware.input.InputManager.InputDeviceListener devices=new android.hardware.input.InputManager.InputDeviceListener(){
        @Override public void onInputDeviceAdded(int id){}
        @Override public void onInputDeviceChanged(int id){}
        @Override public void onInputDeviceRemoved(int id){inputRouter.cancelDevice(id);}
    };
    private final java.util.concurrent.ExecutorService vendor = java.util.concurrent.Executors.newSingleThreadExecutor(r -> new Thread(r, "native-board-mode"));
    private NativeBoardMode boardMode;
    @Override protected void handleOnStart() { vendor.execute(() -> boardMode.foreground(true)); }
    @Override protected void handleOnStop() { vendor.execute(() -> boardMode.foreground(false)); }
    @Override public void load() {
        boardMode = new NativeBoardMode(getContext());
        ((MainActivity)getActivity()).setInkInput(this);
        inputManager=(android.hardware.input.InputManager)getContext().getSystemService(android.content.Context.INPUT_SERVICE);
        if(inputManager!=null)inputManager.registerInputDeviceListener(devices,new android.os.Handler(android.os.Looper.getMainLooper()));
    }
    void sceneCommitted(String owner) { NativeInkView view=surfaces.get(owner);if(view!=null)view.sceneCommitted(); }
    /** Route the real event before ViewGroup can cancel another device's stream. */
    boolean dispatchInput(MotionEvent event,java.util.function.Consumer<MotionEvent> forward) {
        if (touchLocked && event.isFromSource(InputDevice.SOURCE_TOUCHSCREEN)) return true;
        return inputRouter.dispatch(event,forward);
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
            inputRouter.clear();
        } else if (action.equals("unlock")) touchLocked = false;
        notifyListeners("shortcut", new JSObject().put("owner", owner).put("action", action));
        return true;
    }
    private void layer() {
        if (layer != null) return;
        layer = new FrameLayout(getActivity());
        ViewGroup parent=(ViewGroup)getBridge().getWebView().getParent();
        parent.addView(layer,parent.indexOfChild(getBridge().getWebView()),new ViewGroup.LayoutParams(-1,-1));
    }
    private FrameLayout overlay() {
        if (overlay == null) {
            overlay = new FrameLayout(getActivity());
            ViewGroup parent = (ViewGroup) getBridge().getWebView().getParent();
            parent.addView(overlay, parent.indexOfChild(getBridge().getWebView()) + 1,
                new ViewGroup.LayoutParams(-1, -1));
        }
        return overlay;
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
                    if (surfaces.size() >= 5) throw new IllegalStateException("Too many native pen surfaces");
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
                boolean overlayPreview = call.getBoolean("overlayPreview", false);
                FrameLayout inputLayer = overlayPreview ? overlay() : layer;
                if (view.getParent() != inputLayer) {
                    if (overlayPreview) ((MainActivity)getActivity()).removeInkSurface(owner, view);
                    detach(view);
                    inputLayer.addView(view);
                }
                view.setOverlayPreview(overlayPreview);
                view.setSelection(call.getArray("selectionBounds"),call.getString("selectionKey",""),call.getFloat("selectionMinScale",.1f),call.getBoolean("selectionResize",true));
                view.setPersistent(call.getBoolean("persistent",false));
                view.setMultiStroke(call.getBoolean("multiStroke", true));
                view.setRecognitionEnabled(call.getBoolean("recognitionEnabled", false));
                view.setRetainedScene(() -> overlayPreview ? null : ((MainActivity)getActivity()).nativeScene(owner), !"object".equals(call.getString("eraserMode", "stroke")));
                shortcutSurfaces.put(owner, call.getBoolean("shortcutsEnabled", false));
                view.configure(token, call.getBoolean("enabled", false), (float)x, (float)y, scale, (float)penWidth, call.getFloat("unit", 1f), (float)opacity, call.getString("color", "#000000"), call.getBoolean("dashed", false), call.getFloat("palm", 36f), blocked, call.getObject("thick"), call.getFloat("thickThreshold", 0f), call.getString("mode", "pen"), call.getBoolean("palmEnabled", true), call.getFloat("eraserSize", 60f), call.getObject("appearance"));
                int[] web = new int[2], origin = new int[2]; getBridge().getWebView().getLocationInWindow(web); inputLayer.getLocationInWindow(origin);
                FrameLayout.LayoutParams bounds = new FrameLayout.LayoutParams(Math.max(1, Math.round((float)width * scale)), Math.max(1, Math.round((float)height * scale)));
                bounds.leftMargin = Math.round(web[0] - origin[0] + (float)x * scale); bounds.topMargin = Math.round(web[1] - origin[1] + (float)y * scale);
                inputBounds.put(view, new RectF(web[0] + (float)x * scale, web[1] + (float)y * scale,
                    web[0] + ((float)x + (float)width) * scale, web[1] + ((float)y + (float)height) * scale));
                ViewGroup.LayoutParams old = view.getLayoutParams();
                if (!(old instanceof FrameLayout.LayoutParams) || old.width != bounds.width || old.height != bounds.height || ((FrameLayout.LayoutParams)old).leftMargin != bounds.leftMargin || ((FrameLayout.LayoutParams)old).topMargin != bounds.topMargin) view.setLayoutParams(bounds);
                if (!overlayPreview) ((MainActivity)getActivity()).setInkSurface(owner,view,bounds);
                call.resolve();
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    @PluginMethod public void ready(PluginCall call){
        getActivity().runOnUiThread(()->{
            String owner=call.getString("owner","");boolean fallback=call.getBoolean("fallback",false);
            if(owner.isEmpty()||!fallback&&!surfaces.containsKey(owner)){call.reject("Native input is not configured");return;}
            ((MainActivity)getActivity()).boardReady(owner,fallback);call.resolve();
        });
    }
    @PluginMethod public void checkpoint(PluginCall call){publisher.execute(call::resolve);}
    @PluginMethod public void restore(PluginCall call){
        String owner=call.getString("owner",""),token=call.getString("token",""),png=call.getString("bitmap","");
        publisher.execute(()->{
            try{
                android.graphics.Bitmap bitmap=NativeScene.bitmap(png);
                getActivity().runOnUiThread(()->{
                    try{NativeInkView view=surfaces.get(owner);if(view==null)throw new IllegalStateException("Split surface closed");view.restorePersistent(bitmap,token);call.resolve();}
                    catch(Exception error){call.reject(error.getMessage(),error);}
                });
            }catch(Exception error){call.reject(error.getMessage(),error);}
        });
    }
    @PluginMethod public void acknowledge(PluginCall call) {
        getActivity().runOnUiThread(() -> { NativeInkView view = surfaces.get(call.getString("owner", "")); if (view != null) view.acknowledge(call.getString("id", ""),call.getString("elementId", ""),call.getBoolean("complete",false)); call.resolve(); });
    }
    @PluginMethod public void remove(PluginCall call) {
        getActivity().runOnUiThread(() -> { String owner = call.getString("owner", ""); shortcutSurfaces.remove(owner); NativeInkView view = surfaces.remove(owner); if (view != null) { view.cancel(); ((MainActivity)getActivity()).removeInkSurface(owner,view); inputRouter.remove(view); inputBounds.remove(view); detach(view); } if (surfaces.isEmpty()) { touchLocked = false; keys.reset(); } call.resolve(); });
    }
    @Override protected void handleOnPause() { getActivity().runOnUiThread(() -> { for (NativeInkView view : surfaces.values()) view.cancel(); inputRouter.clear(); touchLocked = false; keys.reset(); }); }
    private static void detach(android.view.View view) {
        if (view.getParent() instanceof ViewGroup) ((ViewGroup)view.getParent()).removeView(view);
    }
    @Override protected void handleOnDestroy() {
        vendor.execute(() -> boardMode.foreground(false)); vendor.shutdown();
        if(inputManager!=null)inputManager.unregisterInputDeviceListener(devices);
        getActivity().runOnUiThread(() -> { ((MainActivity)getActivity()).setInkInput(null); for (NativeInkView view : surfaces.values()) view.cancel(); surfaces.clear(); inputBounds.clear(); inputRouter.clear(); publisher.shutdown(); if (layer != null) { detach(layer); layer = null; } if (overlay != null) { detach(overlay); overlay = null; } });
    }
}
