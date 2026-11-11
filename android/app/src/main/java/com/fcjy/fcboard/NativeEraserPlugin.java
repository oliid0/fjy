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
    @PluginMethod public void erase(PluginCall call) {
        worker.execute(()->{
            try {
                String owner=call.getString("owner","");
                if(owner.isEmpty()||owner.length()>200) throw new IllegalArgumentException("Invalid native eraser owner");
                NativeStrokeEraser scene=scenes.get(owner);
                if(scene==null) { if(scenes.size()>=4) throw new IllegalStateException("Too many native eraser scenes"); scene=new NativeStrokeEraser(); scenes.put(owner,scene); }
                JSArray updates=call.getArray("updates"),removals=call.getArray("removals"),path=call.getArray("path");
                if(updates==null||removals==null||path==null||path.length()>120001) throw new IllegalArgumentException("Missing native eraser geometry");
                scene.synchronize(updates,removals);
                call.resolve(new JSObject().put("patches",scene.erase(path,call.getDouble("width",0d),call.getDouble("height",0d))));
            } catch(Exception error) { call.reject(error.getMessage(),error); }
        });
    }
    @PluginMethod public void release(PluginCall call) { worker.execute(()->{ scenes.remove(call.getString("owner","")); call.resolve(); }); }
    @Override protected void handleOnDestroy() { worker.execute(scenes::clear); worker.shutdown(); }
}
