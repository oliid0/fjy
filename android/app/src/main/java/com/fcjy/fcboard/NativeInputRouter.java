package com.fcjy.fcboard;

import android.graphics.RectF;
import android.view.MotionEvent;
import java.util.*;

/** One physical touchscreen may span several native canvases. Ownership belongs
 * to each pointer, while device/source/downTime and every historical sample stay intact. */
final class NativeInputRouter {
    private final Map<NativeInkView,RectF> surfaces;
    private final Map<NativeInputStream,Map<Integer,NativeInkView>> captured=new HashMap<>();
    NativeInputRouter(Map<NativeInkView,RectF> surfaces){this.surfaces=surfaces;}
    void clear(){captured.clear();}
    void remove(NativeInkView view){for(Map<Integer,NativeInkView> pointers:captured.values())pointers.values().removeIf(owner->owner==view);}
    boolean dispatch(MotionEvent event){
        NativeInputStream stream=new NativeInputStream(event);
        int action=event.getActionMasked(),changed=event.getActionIndex();
        Map<Integer,NativeInkView> pointers=captured.get(stream);
        if(action==MotionEvent.ACTION_DOWN&&pointers!=null){for(NativeInkView view:new HashSet<>(pointers.values()))view.cancelStream(stream);captured.remove(stream);pointers=null;}
        if(action==MotionEvent.ACTION_DOWN||action==MotionEvent.ACTION_POINTER_DOWN){
            if(pointers==null)pointers=new HashMap<>();
            for(Map.Entry<NativeInkView,RectF> entry:surfaces.entrySet()){
                RectF box=entry.getValue();
                if(box.contains(event.getX(changed),event.getY(changed))&&entry.getKey().accepts(event,changed,box.left,box.top)){
                    pointers.put(event.getPointerId(changed),entry.getKey());captured.put(stream,pointers);break;
                }
            }
        }
        if(pointers==null||pointers.isEmpty())return false;
        Map<NativeInkView,List<Integer>> groups=new LinkedHashMap<>();
        for(int i=0;i<event.getPointerCount();i++){
            NativeInkView view=pointers.get(event.getPointerId(i));
            if(view!=null&&surfaces.containsKey(view))groups.computeIfAbsent(view,key->new ArrayList<>()).add(i);
        }
        for(Map.Entry<NativeInkView,List<Integer>> group:groups.entrySet()){
            NativeInkView view=group.getKey();RectF bounds=surfaces.get(view);
            if(group.getValue().size()==event.getPointerCount())view.handleTouchEvent(event,bounds.left,bounds.top);
            else{
                MotionEvent subset=subset(event,group.getValue());
                try{view.handleTouchEvent(subset,bounds.left,bounds.top);}finally{subset.recycle();}
            }
        }
        if(action==MotionEvent.ACTION_UP||action==MotionEvent.ACTION_CANCEL)captured.remove(stream);
        else if(action==MotionEvent.ACTION_POINTER_UP)pointers.remove(event.getPointerId(changed));
        return !groups.isEmpty();
    }
    // MotionEvent.split is not part of the public SDK. Recreate only filtered
    // multi-surface events with public obtain/addBatch APIs, preserving history.
    static MotionEvent subset(MotionEvent event,List<Integer> indices){
        int count=indices.size(),action=event.getActionMasked(),local=indices.indexOf(event.getActionIndex());
        if(action==MotionEvent.ACTION_POINTER_DOWN||action==MotionEvent.ACTION_POINTER_UP){
            action=local<0?MotionEvent.ACTION_MOVE:count==1?(action==MotionEvent.ACTION_POINTER_DOWN?MotionEvent.ACTION_DOWN:MotionEvent.ACTION_UP):action|(local<<MotionEvent.ACTION_POINTER_INDEX_SHIFT);
        }
        MotionEvent.PointerProperties[] properties=new MotionEvent.PointerProperties[count];
        MotionEvent.PointerCoords[] coordinates=new MotionEvent.PointerCoords[count];
        for(int i=0;i<count;i++){properties[i]=new MotionEvent.PointerProperties();event.getPointerProperties(indices.get(i),properties[i]);coordinates[i]=new MotionEvent.PointerCoords();}
        int history=event.getHistorySize();
        fill(event,indices,coordinates,history>0?0:-1);
        MotionEvent result=MotionEvent.obtain(event.getDownTime(),history>0?event.getHistoricalEventTime(0):event.getEventTime(),action,count,properties,coordinates,event.getMetaState(),event.getButtonState(),event.getXPrecision(),event.getYPrecision(),event.getDeviceId(),event.getEdgeFlags(),event.getSource(),event.getFlags());
        for(int sample=1;sample<=history;sample++){
            fill(event,indices,coordinates,sample==history?-1:sample);
            result.addBatch(sample==history?event.getEventTime():event.getHistoricalEventTime(sample),coordinates,event.getMetaState());
        }
        return result;
    }
    private static void fill(MotionEvent event,List<Integer> indices,MotionEvent.PointerCoords[] coordinates,int history){
        for(int i=0;i<indices.size();i++)if(history<0)event.getPointerCoords(indices.get(i),coordinates[i]);else event.getHistoricalPointerCoords(indices.get(i),history,coordinates[i]);
    }
}
