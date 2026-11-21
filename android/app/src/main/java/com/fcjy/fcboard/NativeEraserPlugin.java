package com.fcjy.fcboard;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Ordered geometry worker, independent of both the Android UI and WebView. */
@CapacitorPlugin(name = "FcboardNativeEraser")
public final class NativeEraserPlugin extends Plugin {
    private final ExecutorService worker=Executors.newSingleThreadExecutor(r->new Thread(r,"native-eraser-geometry"));
    private final Map<String,NativeStrokeEraser> scenes=new HashMap<>();
    @PluginMethod public void clip(PluginCall call) {
        worker.execute(()->{
            android.os.Trace.beginSection("NativeEraser.clip");
            try {
                org.json.JSONObject stroke=call.getObject("stroke");JSArray cuts=call.getArray("cuts");
                if(stroke==null||cuts==null)throw new IllegalArgumentException("Missing live ink cuts");
                call.resolve(JSObject.fromJSONObject(new NativeStrokeEraser().clip(stroke,cuts)));
            }catch(Exception error){call.reject(error.getMessage(),error);}
            finally{android.os.Trace.endSection();}
        });
    }
    private NativeStrokeEraser applyUpdates(PluginCall call) throws org.json.JSONException {
        String owner = call.getString("owner", "");
        if (owner.isEmpty() || owner.length() > 200) throw new IllegalArgumentException("Invalid native eraser owner");
        JSArray updates = call.getArray("updates"), removals = call.getArray("removals");
        if (updates == null || removals == null) throw new IllegalArgumentException("Missing eraser geometry");
        NativeStrokeEraser scene = scenes.get(owner);
        if (scene == null) {
            if (scenes.size() >= 4) throw new IllegalStateException("Too many native eraser scenes");
            scene = new NativeStrokeEraser();
            scenes.put(owner, scene);
        }
        scene.synchronize(updates, removals);
        return scene;
    }

    @PluginMethod public void synchronize(PluginCall call) {
        worker.execute(() -> {
            try {
                applyUpdates(call);
                call.resolve();
            } catch (Exception error) {
                call.reject(error.getMessage(), error);
            }
        });
    }

    @PluginMethod public void erase(PluginCall call) {
        worker.execute(()->{
            android.os.Trace.beginSection("NativeEraser.erase");
            try {
                JSArray path = call.getArray("path");
                if (path == null || path.length() > 120001) throw new IllegalArgumentException("Invalid eraser path");
                NativeStrokeEraser scene = applyUpdates(call);
                call.resolve(new JSObject().put("patches",scene.erase(path,call.getDouble("width",0d),call.getDouble("height",0d))));
            } catch(Exception error) { call.reject(error.getMessage(),error); }
            finally{android.os.Trace.endSection();}
        });
    }
    @PluginMethod public void release(PluginCall call) { worker.execute(()->{ scenes.remove(call.getString("owner","")); call.resolve(); }); }
    @Override protected void handleOnDestroy() { worker.execute(scenes::clear); worker.shutdown(); }
}
