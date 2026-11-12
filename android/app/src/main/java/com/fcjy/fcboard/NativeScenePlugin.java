package com.fcjy.fcboard;

import android.graphics.Color;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.*;
import java.util.concurrent.*;

/** Scene raster work never runs on the Android input/UI thread. The retained
 * layer is below WebView so existing handles, text editing and UI keep order. */
@CapacitorPlugin(name="FcboardNativeScene")
public final class NativeScenePlugin extends Plugin {
    private static final class Entry { NativeSceneView view;long epoch,revision; }
    private static final class State { NativeScene scene=new NativeScene();long epoch;State(long epoch){this.epoch=epoch;} }
    private FrameLayout layer;
    private final Map<String,Entry> entries=new HashMap<>();
    private final Map<String,Long> epochs=new HashMap<>();
    private final Map<String,State> states=new HashMap<>();
    private final ExecutorService worker=Executors.newSingleThreadExecutor(r->new Thread(r,"native-scene-raster"));
    @Override public void load(){((MainActivity)getActivity()).setNativeScene(this);}
    NativeSceneView scene(String owner){Entry entry=entries.get(owner);return entry==null?null:entry.view;}
    private void layer(){
        if(layer!=null)return;
        layer=new FrameLayout(getActivity());layer.setClipChildren(true);layer.setClipToPadding(true);
        ViewGroup parent=(ViewGroup)getBridge().getWebView().getParent();
        parent.addView(layer,parent.indexOfChild(getBridge().getWebView()),new ViewGroup.LayoutParams(-1,-1));
        getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
    }
    @PluginMethod public void synchronize(PluginCall call){
        getActivity().runOnUiThread(()->{
            try{
                String owner=call.getString("owner","");long epoch=call.getData().getLong("epoch"),revision=call.getData().getLong("revision");
                if(owner.isEmpty()||owner.length()>200)throw new IllegalArgumentException("Invalid native scene owner");
                if(epoch<epochs.getOrDefault(owner,Long.MIN_VALUE)){call.resolve();return;}
                epochs.put(owner,epoch);layer();
                Entry entry=entries.get(owner);
                if(entry==null){if(entries.size()>=4)throw new IllegalStateException("Too many native scenes");entry=new Entry();entry.view=new NativeSceneView(getActivity());entries.put(owner,entry);layer.addView(entry.view);}
                if(epoch==entry.epoch&&revision<=entry.revision){call.resolve();return;}
                entry.epoch=epoch;entry.revision=revision;
                float viewport=call.getFloat("viewportWidth",0f),x=call.getFloat("x",0f),y=call.getFloat("y",0f),width=call.getFloat("width",0f),height=call.getFloat("height",0f);
                if(!Float.isFinite(viewport+x+y+width+height)||viewport<=0||width<=0||height<=0)throw new IllegalArgumentException("Invalid native scene viewport");
                float scale=getBridge().getWebView().getWidth()/viewport;if(!(scale>0))throw new IllegalStateException("Native viewport unavailable");
                int[] web=new int[2],origin=new int[2];getBridge().getWebView().getLocationInWindow(web);layer.getLocationInWindow(origin);
                FrameLayout.LayoutParams bounds=new FrameLayout.LayoutParams(Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale)));
                bounds.leftMargin=Math.round(web[0]-origin[0]+x*scale);bounds.topMargin=Math.round(web[1]-origin[1]+y*scale);entry.view.setLayoutParams(bounds);
                long received=entry.view.sequence();Entry target=entry;
                worker.execute(()->{
                    try{
                        State state=states.get(owner);if(state==null||state.epoch!=epoch){state=new State(epoch);states.put(owner,state);}
                        NativeScene.Frame frame=state.scene.synchronize(call.getData(),scale,received);
                        getActivity().runOnUiThread(()->{
                            if(entries.get(owner)==target&&target.epoch==epoch){target.view.apply(frame);((MainActivity)getActivity()).nativeSceneCommitted(owner);}
                            call.resolve();
                        });
                    }catch(Exception error){call.reject("Native scene unavailable: "+error.getMessage(),error);}
                });
            }catch(Exception error){call.reject(error.getMessage(),error);}
        });
    }
    @PluginMethod public void remove(PluginCall call){
        getActivity().runOnUiThread(()->{
            String owner=call.getString("owner","");long epoch=call.getData().optLong("epoch",Long.MAX_VALUE);
            if(epoch<epochs.getOrDefault(owner,Long.MIN_VALUE)){call.resolve();return;}
            epochs.put(owner,epoch);Entry old=entries.remove(owner);if(old!=null)layer.removeView(old.view);
            worker.execute(()->{State state=states.get(owner);if(state!=null&&state.epoch<=epoch)states.remove(owner);call.resolve();});
        });
    }
    @Override protected void handleOnDestroy(){
        ((MainActivity)getActivity()).setNativeScene(null);entries.clear();epochs.clear();
        worker.execute(states::clear);worker.shutdown();
        if(layer!=null){((ViewGroup)layer.getParent()).removeView(layer);layer=null;}
    }
}
