package com.fcjy.fcboard;

import android.graphics.*;
import android.view.*;
import android.widget.FrameLayout;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class NativeInputRouterTest {
    private static MotionEvent event(int action,int count,long time){return event(action,count,time,88);}
    private static MotionEvent event(int action,int count,long time,int device){
        MotionEvent.PointerProperties[] properties=new MotionEvent.PointerProperties[count];MotionEvent.PointerCoords[] points=new MotionEvent.PointerCoords[count];
        for(int i=0;i<count;i++){properties[i]=new MotionEvent.PointerProperties();properties[i].id=i*7;properties[i].toolType=MotionEvent.TOOL_TYPE_FINGER;points[i]=new MotionEvent.PointerCoords();points[i].x=i==0?50:350;points[i].y=60;points[i].pressure=.7f;points[i].touchMajor=2;points[i].touchMinor=2;}
        return MotionEvent.obtain(100,time,action,count,properties,points,0,0,1,1,device,0,InputDevice.SOURCE_TOUCHSCREEN,0);
    }
    private static NativeInkView surface(List<JSObject> events,float x){
        android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();NativeInkView view=new NativeInkView(context,events::add);new FrameLayout(context).addView(view);view.layout(0,0,300,200);
        view.configure("shared",true,x,0,1,20,1,.5f,"#ff0000",false,36,Collections.emptyList(),null,0,"pen",true,60,null);return view;
    }
    @Test public void oneDeviceWritesInTwoNativePanesWithoutCancellingEitherPointer(){
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            List<JSObject> leftEvents=new ArrayList<>(),rightEvents=new ArrayList<>();NativeInkView left=surface(leftEvents,0),right=surface(rightEvents,300);
            Map<NativeInkView,RectF> boxes=new LinkedHashMap<>();boxes.put(left,new RectF(0,0,300,200));boxes.put(right,new RectF(300,0,600,200));NativeInputRouter router=new NativeInputRouter(boxes);
            for(int[] input:new int[][]{{MotionEvent.ACTION_DOWN,1},{MotionEvent.ACTION_POINTER_DOWN|(1<<8),2},{MotionEvent.ACTION_MOVE,2},{MotionEvent.ACTION_POINTER_UP|(1<<8),2},{MotionEvent.ACTION_UP,1}}){MotionEvent sample=event(input[0],input[1],110+leftEvents.size()+rightEvents.size());try{assertTrue(router.dispatch(sample));}finally{sample.recycle();}}
            assertEquals(2,leftEvents.size());assertEquals(2,rightEvents.size());assertEquals("end",leftEvents.get(1).optString("phase"));assertEquals("end",rightEvents.get(1).optString("phase"));assertNotEquals(leftEvents.get(0).optString("id"),rightEvents.get(0).optString("id"));
            assertEquals(350,rightEvents.get(1).optJSONArray("points").optJSONArray(0).optDouble(0),0);
        });
    }
    @Test public void filteredEventsKeepHistoricalCoordinatesPressureAndHardwareIdentity(){
        MotionEvent original=event(MotionEvent.ACTION_MOVE,2,110);
        MotionEvent.PointerCoords[] points={new MotionEvent.PointerCoords(),new MotionEvent.PointerCoords()};original.getPointerCoords(0,points[0]);original.getPointerCoords(1,points[1]);points[1].x=370;points[1].pressure=.9f;original.addBatch(120,points,0);
        MotionEvent filtered=NativeInputRouter.subset(original,Collections.singletonList(1));
        try{assertEquals(88,filtered.getDeviceId());assertEquals(InputDevice.SOURCE_TOUCHSCREEN,filtered.getSource());assertEquals(100,filtered.getDownTime());assertEquals(7,filtered.getPointerId(0));assertEquals(1,filtered.getHistorySize());assertEquals(350,filtered.getHistoricalX(0),0);assertEquals(370,filtered.getX(),0);assertEquals(.9f,filtered.getPressure(),.001f);}finally{filtered.recycle();original.recycle();}
    }
    @Test public void nativeSplitInkRemainsAfterLiftAndErasesBeforeAnyJavascriptReply(){
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            List<JSObject> events=new ArrayList<>();NativeInkView view=surface(events,0);view.setPersistent(true);
            for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_MOVE,MotionEvent.ACTION_UP}){MotionEvent sample=MotionEvent.obtain(100,110+action,action,action==0?20:280,60,0);try{assertTrue(view.onTouchEvent(sample));}finally{sample.recycle();}}
            view.acknowledge(events.get(events.size()-1).optString("id"));Bitmap before=Bitmap.createBitmap(300,200,Bitmap.Config.ARGB_8888);view.draw(new Canvas(before));assertEquals(128,Color.alpha(before.getPixel(100,60)));before.recycle();
            view.configure("erase",true,0,0,1,20,1,.5f,"#ff0000",false,36,Collections.emptyList(),null,0,"erase",true,60,null);
            for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_MOVE}){MotionEvent sample=MotionEvent.obtain(200,210+action,action,action==0?100:260,action==0?60:160,0);try{assertTrue(view.onTouchEvent(sample));}finally{sample.recycle();}}
            Bitmap erased=Bitmap.createBitmap(300,200,Bitmap.Config.ARGB_8888);view.draw(new Canvas(erased));assertEquals(0,Color.alpha(erased.getPixel(100,60)));erased.recycle();
            MotionEvent cancel=MotionEvent.obtain(200,220,MotionEvent.ACTION_CANCEL,260,160,0);try{assertTrue(view.onTouchEvent(cancel));}finally{cancel.recycle();}
            Bitmap restored=Bitmap.createBitmap(300,200,Bitmap.Config.ARGB_8888);view.draw(new Canvas(restored));assertEquals(128,Color.alpha(restored.getPixel(100,60)));restored.recycle();
        });
    }
    @Test public void cancellingTileErasurePreservesAConcurrentCommittedWriter(){
        NativeSplitInk ink=new NativeSplitInk();ink.size(600,200);Paint red=new Paint();red.setColor(Color.RED);ink.commit(new RectF(0,0,600,200),canvas->canvas.drawRect(10,50,580,70,red));
        ink.erase("erase",NativeSceneView.sweep(250,20,270,100,24,28));Paint blue=new Paint();blue.setColor(Color.BLUE);ink.commit(new RectF(240,120,280,160),canvas->canvas.drawRect(240,120,280,160,blue));ink.cancel("erase");Bitmap output=Bitmap.createBitmap(600,200,Bitmap.Config.ARGB_8888);ink.draw(new Canvas(output));try{assertEquals(Color.RED,output.getPixel(256,60));assertEquals(Color.BLUE,output.getPixel(256,140));}finally{output.recycle();}
    }
    @Test public void disconnectCancelsOnlyTheRemovedDeviceAndKeepsTheOtherWriter(){
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            List<JSObject> events=new ArrayList<>();NativeInkView view=surface(events,0);
            Map<NativeInkView,RectF> boxes=new HashMap<>();boxes.put(view,new RectF(0,0,300,200));NativeInputRouter router=new NativeInputRouter(boxes);
            for(int device:new int[]{88,99}){MotionEvent sample=event(MotionEvent.ACTION_DOWN,1,110,device);try{assertTrue(router.dispatch(sample));}finally{sample.recycle();}}
            router.cancelDevice(88);assertEquals(3,events.size());assertEquals("cancel",events.get(2).optString("phase"));assertEquals(events.get(0).optString("id"),events.get(2).optString("id"));
            MotionEvent end=event(MotionEvent.ACTION_UP,1,120,99);try{assertTrue(router.dispatch(end));}finally{end.recycle();}
            assertEquals(4,events.size());assertEquals("end",events.get(3).optString("phase"));assertEquals(events.get(1).optString("id"),events.get(3).optString("id"));
        });
    }

}
