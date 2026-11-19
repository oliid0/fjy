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
    private static final class Entry { NativeSceneView view;long epoch,revision;boolean canonical,reported; }
    private static final class State { NativeScene scene=new NativeScene();long epoch;State(long epoch){this.epoch=epoch;} }
    private FrameLayout layer;
    private boolean closed;
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
    private Entry entry(String owner){
        Entry entry=entries.get(owner);
        if(entry==null){
            if(entries.size()>=5)throw new IllegalStateException("Too many native scenes");
            layer();entry=new Entry();entry.view=new NativeSceneView(getActivity());entries.put(owner,entry);
            Entry target=entry;
            entry.view.whenPresented(()->{if(!closed&&entries.get(owner)==target)((MainActivity)getActivity()).nativeScenePresented(owner);});
            layer.addView(entry.view);
        }
        return entry;
    }
    void setInput(String owner,NativeInkView input,FrameLayout.LayoutParams bounds){
        if(closed)throw new IllegalStateException("Native scene closed");
        Entry entry=entry(owner);entry.view.setInput(input);input.setDisplay(entry.view);
        ViewGroup.LayoutParams old=entry.view.getLayoutParams();
        if(!(old instanceof FrameLayout.LayoutParams)||old.width!=bounds.width||old.height!=bounds.height||((FrameLayout.LayoutParams)old).leftMargin!=bounds.leftMargin||((FrameLayout.LayoutParams)old).topMargin!=bounds.topMargin)
            entry.view.setLayoutParams(new FrameLayout.LayoutParams(bounds));
    }
    void removeInput(String owner,NativeInkView input){
        input.setDisplay(null);Entry entry=entries.get(owner);
        if(entry==null||!entry.view.hasInput(input))return;
        entry.view.setInput(null);
        if(!entry.canonical){entries.remove(owner);layer.removeView(entry.view);}
    }
    @PluginMethod public void synchronize(PluginCall call){
        getActivity().runOnUiThread(()->{
            try{
                if(closed){call.reject("Native scene closed");return;}
                String owner=call.getString("owner","");long epoch=call.getData().getLong("epoch"),revision=call.getData().getLong("revision");
                if(owner.isEmpty()||owner.length()>200)throw new IllegalArgumentException("Invalid native scene owner");
                if(epoch<epochs.getOrDefault(owner,Long.MIN_VALUE)){call.resolve();return;}
                epochs.put(owner,epoch);layer();
                Entry entry=entry(owner);entry.canonical=true;
                if(epoch==entry.epoch&&revision<=entry.revision){call.resolve();return;}
                entry.epoch=epoch;entry.revision=revision;
                float viewport=call.getFloat("viewportWidth",0f),x=call.getFloat("x",0f),y=call.getFloat("y",0f),width=call.getFloat("width",0f),height=call.getFloat("height",0f);
                if(!Float.isFinite(viewport+x+y+width+height)||viewport<=0||width<=0||height<=0)throw new IllegalArgumentException("Invalid native scene viewport");
                float scale=getBridge().getWebView().getWidth()/viewport;if(!(scale>0))throw new IllegalStateException("Native viewport unavailable");
                int[] web=new int[2],origin=new int[2];getBridge().getWebView().getLocationInWindow(web);layer.getLocationInWindow(origin);
                FrameLayout.LayoutParams bounds=new FrameLayout.LayoutParams(Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale)));
                bounds.leftMargin=Math.round(web[0]-origin[0]+x*scale);bounds.topMargin=Math.round(web[1]-origin[1]+y*scale);
                ViewGroup.LayoutParams old=entry.view.getLayoutParams();
                if(!(old instanceof FrameLayout.LayoutParams)||old.width!=bounds.width||old.height!=bounds.height||((FrameLayout.LayoutParams)old).leftMargin!=bounds.leftMargin||((FrameLayout.LayoutParams)old).topMargin!=bounds.topMargin)entry.view.setLayoutParams(bounds);
                long received=entry.view.sequence();Entry target=entry;
                List<NativeScene.Cut> eraseSamples=entry.view.erasureSamples(call.getData().optLong("eraseThrough",0));
                worker.execute(()->{
                    android.os.Trace.beginSection("NativeScene.synchronize");
                    try{
                        State state=states.get(owner);if(state==null||state.epoch!=epoch){state=new State(epoch);states.put(owner,state);}
                        NativeScene.Frame frame=state.scene.synchronize(call.getData(),scale,received,eraseSamples);
                        getActivity().runOnUiThread(()->{
                            if(!closed&&entries.get(owner)==target&&target.epoch==epoch){target.view.apply(frame);if(!target.reported){target.reported=true;MainActivity.startup("scene.installed");}((MainActivity)getActivity()).nativeSceneCommitted(owner);}
                            call.resolve();
                        });
                    }catch(Exception error){call.reject("Native scene unavailable: "+error.getMessage(),error);}
                    finally{android.os.Trace.endSection();}
                });
            }catch(Exception error){call.reject(error.getMessage(),error);}
        });
    }
    @PluginMethod public void remove(PluginCall call){
        getActivity().runOnUiThread(()->{
            if(closed){call.resolve();return;}
            String owner=call.getString("owner","");long epoch=call.getData().optLong("epoch",Long.MAX_VALUE);
            if(epoch<epochs.getOrDefault(owner,Long.MIN_VALUE)){call.resolve();return;}
            epochs.put(owner,epoch);Entry old=entries.remove(owner);if(old!=null)layer.removeView(old.view);
            worker.execute(()->{State state=states.get(owner);if(state!=null&&state.epoch<=epoch)states.remove(owner);call.resolve();});
        });
    }
    @Override protected void handleOnDestroy(){
        if(closed)return;closed=true;
        ((MainActivity)getActivity()).setNativeScene(null);entries.clear();epochs.clear();
        worker.execute(states::clear);worker.shutdown();
        if(layer!=null){((ViewGroup)layer.getParent()).removeView(layer);layer=null;}
    }
}
