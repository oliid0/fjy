package com.fcjy.fcboard;

import android.graphics.*;
import android.widget.FrameLayout;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Actual Android pixels for retained scene composition, with no WebView. */
@RunWith(AndroidJUnit4.class)
public class NativeSceneTest {
    private static JSONObject ink(String id,String order,String path,String color,boolean editable,long through)throws Exception{
        return new JSONObject().put("id",id).put("order",order).put("version",1).put("nonce",1).put("through",through).put("ink",editable)
            .put("bounds",new JSONArray("[0,0,600,200]")).put("path",path).put("nib","").put("transform",new JSONArray("[0,0,0,0,0]"))
            .put("color",color).put("opacity",0.5).put("strokeWidth",20);
    }
    private static JSONObject update(JSONArray nodes,boolean reset)throws Exception{
        return new JSONObject().put("width",600).put("height",200).put("zoom",1).put("scrollX",0).put("scrollY",0).put("reset",reset)
            .put("nodes",nodes).put("removals",new JSONArray());
    }
    private static NativeSceneView surface(){
        android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        NativeSceneView view=new NativeSceneView(context);new FrameLayout(context).addView(view);view.layout(0,0,600,200);return view;
    }
    private static Bitmap pixels(NativeSceneView view){Bitmap bitmap=Bitmap.createBitmap(600,200,Bitmap.Config.ARGB_8888);view.draw(new Canvas(bitmap));return bitmap;}
    @Test public void retainedPixelsEraseAcrossTileSeamsWithoutAnyJavascriptAcknowledgement()throws Exception{
        NativeScene scene=new NativeScene();NativeScene.Frame frame=scene.synchronize(update(new JSONArray().put(ink("ink","a0","M20 60 L580 60","#ff0000",true,-1)),true),1,0,java.util.Collections.emptyList());
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            NativeSceneView view=surface();view.apply(frame);
            Bitmap before=pixels(view);assertEquals(128,Color.alpha(before.getPixel(256,60)));before.recycle();
            view.erase("erase",250,20,270,100,24,28);
            Bitmap after=pixels(view);
            try{assertEquals(0,Color.alpha(after.getPixel(255,60)));assertEquals(0,Color.alpha(after.getPixel(256,60)));assertEquals(128,Color.alpha(after.getPixel(100,60)));assertEquals(128,Color.alpha(after.getPixel(500,60)));}
            finally{after.recycle();}
        });
    }
    @Test public void selectingAnUnderlyingStrokePreservesIdleStackingOrder()throws Exception{
        NativeScene scene=new NativeScene();
        JSONObject data=update(new JSONArray().put(ink("under","a0","M20 60 L580 60","#ff0000",true,0)).put(ink("over","a1","M20 60 L580 60","#0000ff",true,0)),true)
            .put("selectionIds",new JSONArray().put("under")).put("selectionBounds",new JSONArray("[20,50,580,70]"));
        NativeScene.Frame frame=scene.synchronize(data,1,0,java.util.Collections.emptyList());
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            NativeSceneView view=surface();view.apply(frame);Bitmap idle=pixels(view);
            try{int color=idle.getPixel(100,60);assertTrue("Upper blue stroke stays above the selected red stroke",Color.blue(color)>Color.red(color));}finally{idle.recycle();}
        });
    }
    @Test public void appendingInkDoesNotRasterizeHistoryOrMutateAnInstalledFrame()throws Exception{
        NativeScene scene=new NativeScene();
        NativeScene.Frame first=scene.synchronize(update(new JSONArray().put(ink("old","a0","M20 60 L580 60","#ff0000",true,0)),true),1,0,java.util.Collections.emptyList());
        NativeScene.Frame next=scene.synchronize(update(new JSONArray().put(ink("new","a1","M20 140 L580 140","#0000ff",true,1)),false).put("eraseThrough",1),1,1,java.util.Collections.emptyList());
        assertEquals("Only the new stroke in each of three tiles",3,next.rasterizedNodes);
        for(NativeScene.Tile tile:next.tiles.values())assertEquals("Acknowledged ink shares one part",1,tile.parts.size());
        assertEquals(0,Color.alpha(first.tiles.get(NativeScene.key(0,0)).pixels.getPixel(100,140)));
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            NativeSceneView view=surface();view.apply(first);view.erase("pending",90,40,110,80,30,30);view.apply(next);view.cancelErase("pending");
            Bitmap output=pixels(view);try{assertEquals(128,Color.alpha(output.getPixel(100,60)));assertEquals(128,Color.alpha(output.getPixel(100,140)));}finally{output.recycle();}
        });
    }
    @Test public void clearPreservesLockedInkAndInterleavedObjectPixels()throws Exception{
        Bitmap image=Bitmap.createBitmap(600,200,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(image);Paint paint=new Paint();paint.setColor(Color.BLUE);canvas.drawRect(240,40,280,80,paint);
        java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();image.compress(Bitmap.CompressFormat.PNG,100,bytes);image.recycle();
        JSONObject object=new JSONObject().put("id","image").put("order","a1").put("version",1).put("nonce",1).put("through",-1).put("ink",false).put("bounds",new JSONArray("[0,0,600,200]"))
            .put("bitmap","data:image/png;base64,"+android.util.Base64.encodeToString(bytes.toByteArray(),android.util.Base64.NO_WRAP));
        NativeScene scene=new NativeScene();NativeScene.Frame frame=scene.synchronize(update(new JSONArray().put(ink("under","a0","M20 60 L580 60","#ff0000",true,-1)).put(object)
            .put(ink("locked","a2","M20 100 L580 100","#00ff00",false,-1)),true),1,0,java.util.Collections.emptyList());
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            NativeSceneView view=surface();view.apply(frame);view.erase("erase",250,20,270,140,32,32);Bitmap output=pixels(view);
            try{assertEquals(Color.BLUE,output.getPixel(256,60));assertEquals(128,Color.alpha(output.getPixel(256,100)));assertEquals(0,Color.alpha(output.getPixel(239,60)));}
            finally{output.recycle();}
        });
    }
    @Test public void lateVectorTilesCannotResurrectANewerSweepAndAuthoritativeUndoRestoresInk()throws Exception{
        NativeScene scene=new NativeScene();JSONObject node=ink("ink","a0","M20 60 L580 60","#ff0000",true,-1);
        NativeScene.Frame first=scene.synchronize(update(new JSONArray().put(node),true),1,0,java.util.Collections.emptyList());
        NativeScene.Frame late=scene.synchronize(update(new JSONArray().put(ink("ink","a0","M20 60 L580 60","#ff0000",true,0)),false),1,0,java.util.Collections.emptyList());
        NativeScene.Frame restored=scene.synchronize(update(new JSONArray().put(node),false).put("eraseThrough",1),1,1,java.util.Collections.emptyList());
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            NativeSceneView view=surface();view.apply(first);view.erase("erase",250,20,270,100,24,28);view.apply(late);
            Bitmap cut=pixels(view);assertEquals(0,Color.alpha(cut.getPixel(256,60)));cut.recycle();
            view.finishErase("erase");view.apply(restored);Bitmap undo=pixels(view);assertEquals(128,Color.alpha(undo.getPixel(256,60)));undo.recycle();
        });
    }
    @Test public void cancelRestoresOnlyItsRetainedCoverageAndKeepsConcurrentNewInk()throws Exception{
        NativeScene scene=new NativeScene();JSONObject red=ink("first","a0","M20 60 L580 60","#ff0000",true,-1);
        NativeScene.Frame first=scene.synchronize(update(new JSONArray().put(red),true),1,0,java.util.Collections.emptyList());
        JSONObject blue=ink("second","a1","M20 140 L580 140","#0000ff",true,-1);
        NativeScene.Frame concurrent=scene.synchronize(update(new JSONArray().put(blue),false),1,1,java.util.Collections.emptyList());
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            NativeSceneView view=surface();view.apply(first);view.erase("erase",250,20,270,100,24,28);view.apply(concurrent);view.cancelErase("erase");
            Bitmap output=pixels(view);try{assertEquals(128,Color.alpha(output.getPixel(256,60)));assertEquals(128,Color.alpha(output.getPixel(256,140)));}finally{output.recycle();}
        });
    }
    @Test public void transformedGradientsAndViewportUseTheSameWorldCoordinates()throws Exception{
        JSONObject node=ink("rotated","a0","M0 0 L100 0","#000000",true,-1)
            .put("transform",new JSONArray("[300,90,0,0,1.5707963267948966]"))
            .put("gradient",new JSONObject().put("coordinates",new JSONArray("[0,0,100,0]")).put("colors",new JSONArray("[\"#ff0000\",\"#0000ff\"]")).put("positions",new JSONArray("[0,1]")));
        NativeScene scene=new NativeScene();NativeScene.Frame rotated=scene.synchronize(update(new JSONArray().put(node),true),1,0,java.util.Collections.emptyList());
        NativeScene.Frame zoomed=scene.synchronize(update(new JSONArray().put(ink("flat","a0","M20 40 L100 40","#ff0000",true,-1)),true).put("zoom",2).put("scrollX",10),1,0,java.util.Collections.emptyList());
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            NativeSceneView view=surface();view.apply(rotated);Bitmap pixels=pixels(view);
            int first=pixels.getPixel(300,100),last=pixels.getPixel(300,180);
            assertEquals(128,Color.alpha(first));assertTrue(Color.red(first)>Color.blue(first));assertTrue(Color.blue(last)>Color.red(last));assertEquals(0,Color.alpha(pixels.getPixel(350,90)));pixels.recycle();
            view.apply(zoomed);Bitmap zoom=pixels(view);assertEquals(128,Color.alpha(zoom.getPixel(140,80)));assertEquals(0,Color.alpha(zoom.getPixel(140,40)));zoom.recycle();
        });
    }
    @Test public void actualInputHandsOffToPersistentSceneAndErasesBeforeAnyWebViewReply()throws Exception{
        NativeScene scene=new NativeScene();NativeScene.Frame canonical=scene.synchronize(update(new JSONArray().put(ink("committed","a0","M20 60 L580 60","#ff0000",true,-1)),true),1,0,java.util.Collections.emptyList());
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            NativeSceneView retained=surface();java.util.List<com.getcapacitor.JSObject> events=new java.util.ArrayList<>();
            NativeInkView input=new NativeInkView(retained.getContext(),events::add);FrameLayout parent=new FrameLayout(retained.getContext());parent.addView(input);input.layout(0,0,600,200);
            input.configure("pen",true,0,0,1,20,1,.5f,"#ff0000",false,36,java.util.Collections.emptyList(),null,0,"pen",true,60,null);
            input.setRetainedScene(()->retained,true);
            long down=android.os.SystemClock.uptimeMillis();
            for(int action:new int[]{android.view.MotionEvent.ACTION_DOWN,android.view.MotionEvent.ACTION_MOVE,android.view.MotionEvent.ACTION_UP}){
                float x=action==android.view.MotionEvent.ACTION_DOWN?20:action==android.view.MotionEvent.ACTION_MOVE?300:580;
                android.view.MotionEvent event=android.view.MotionEvent.obtain(down,android.os.SystemClock.uptimeMillis(),action,x,60,0);
                try{assertTrue(input.onTouchEvent(event));}finally{event.recycle();}
            }
            String id=events.get(events.size()-1).optString("id");input.acknowledge(id,"committed",true);
            Bitmap before=Bitmap.createBitmap(600,200,Bitmap.Config.ARGB_8888);input.draw(new Canvas(before));assertEquals(128,Color.alpha(before.getPixel(100,60)));before.recycle();
            retained.apply(canonical);input.sceneCommitted();Bitmap after=pixels(retained);input.draw(new Canvas(after));assertEquals("One opacity after preview handoff",128,Color.alpha(after.getPixel(100,60)));after.recycle();
            input.configure("erase",true,0,0,1,20,1,.5f,"#ff0000",false,36,java.util.Collections.emptyList(),null,0,"erase",true,60,null);
            android.view.MotionEvent erase=android.view.MotionEvent.obtain(down+1,down+1,android.view.MotionEvent.ACTION_DOWN,256,60,0);
            try{assertTrue(input.onTouchEvent(erase));}finally{erase.recycle();}
            Bitmap cut=pixels(retained);assertEquals("Pixels clear before JS has acknowledged eraser start",0,Color.alpha(cut.getPixel(256,60)));cut.recycle();
        });
    }
    @Test public void firstCanonicalFrameReplaysAnEraseThatStartedBeforeBootstrap()throws Exception{
        NativeScene scene=new NativeScene();
        NativeScene.Frame first=scene.synchronize(update(new JSONArray().put(ink("ink","a0","M20 60 L580 60","#ff0000",true,-1)),true),1,1,java.util.Collections.emptyList());
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            NativeSceneView view=surface();view.erase("early",250,20,270,100,24,28);view.apply(first);
            Bitmap output=pixels(view);try{assertEquals(0,Color.alpha(output.getPixel(256,60)));assertEquals(128,Color.alpha(output.getPixel(100,60)));}finally{output.recycle();}
        });
    }
    @Test public void actualStrokeWidthAndBrushGeometryReachNeighbouringTiles()throws Exception{
        JSONObject node=ink("wide","a0","M250 20 L250 180","#ff0000",true,-1).put("bounds",new JSONArray("[250,20,250,180]")).put("strokeWidth",40);
        NativeScene scene=new NativeScene();NativeScene.Frame frame=scene.synchronize(update(new JSONArray().put(node),true),1,0,java.util.Collections.emptyList());
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            NativeSceneView view=surface();view.apply(frame);Bitmap output=pixels(view);
            try{assertEquals(128,Color.alpha(output.getPixel(260,60)));assertEquals(128,Color.alpha(output.getPixel(240,60)));}finally{output.recycle();}
        });
    }

    @Test public void liftedPreviewErasesWithoutAnyJavascriptAndCancellationRestoresIt(){
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
            NativeInkView input=new NativeInkView(context,event->{});FrameLayout parent=new FrameLayout(context);parent.addView(input);input.layout(0,0,600,200);
            input.configure("pending",true,0,0,1,20,1,.5f,"#ff0000",false,36,java.util.Collections.emptyList(),null,0,"pen",true,60,null);
            long down=android.os.SystemClock.uptimeMillis();
            for(int action:new int[]{android.view.MotionEvent.ACTION_DOWN,android.view.MotionEvent.ACTION_MOVE,android.view.MotionEvent.ACTION_UP}){
                android.view.MotionEvent event=android.view.MotionEvent.obtain(down,down+action,action,action==0?20:580,60,0);
                try{assertTrue(input.onTouchEvent(event));}finally{event.recycle();}
            }
            // A separate device can erase without replacing this pending pen contact.
            input.configure("pending",true,0,0,1,20,1,.5f,"#ff0000",false,36,java.util.Collections.emptyList(),null,0,"erase",true,60,null);
            android.view.MotionEvent erase=android.view.MotionEvent.obtain(down+10,down+10,android.view.MotionEvent.ACTION_DOWN,256,60,0);
            try{assertTrue(input.onTouchEvent(erase));}finally{erase.recycle();}
            android.view.MotionEvent move=android.view.MotionEvent.obtain(down+10,down+11,android.view.MotionEvent.ACTION_MOVE,500,160,0);
            try{assertTrue(input.onTouchEvent(move));}finally{move.recycle();}
            Bitmap cut=Bitmap.createBitmap(600,200,Bitmap.Config.ARGB_8888);input.draw(new Canvas(cut));
            assertEquals("Pending ink disappears before any JavaScript acknowledgement",0,Color.alpha(cut.getPixel(256,60)));
            assertEquals(128,Color.alpha(cut.getPixel(100,60)));
            android.view.MotionEvent cancel=android.view.MotionEvent.obtain(down+10,down+11,android.view.MotionEvent.ACTION_CANCEL,256,60,0);
            try{assertTrue(input.onTouchEvent(cancel));}finally{cancel.recycle();}
            Bitmap restored=Bitmap.createBitmap(600,200,Bitmap.Config.ARGB_8888);input.draw(new Canvas(restored));
            try{assertEquals(128,Color.alpha(restored.getPixel(256,60)));assertEquals(128,Color.alpha(restored.getPixel(100,60)));}finally{cut.recycle();restored.recycle();}
        });
    }

    @Test public void selectionPixelsMoveNativelyBeforeAnyJavascriptAndCancelRestoresThem()throws Exception{
        NativeScene scene=new NativeScene();
        JSONObject selected=ink("selected","a0","M30 60 L130 60","#ff0000",true,-1).put("bounds",new JSONArray("[20,40,140,80]"));
        NativeScene.Frame frame=scene.synchronize(update(new JSONArray().put(selected),true).put("selectionIds",new JSONArray().put("selected")).put("selectionKey","selected").put("selectionBounds",new JSONArray("[20,40,140,80]")),1,0,java.util.Collections.emptyList());
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            NativeSceneView view=surface();view.apply(frame);assertTrue(view.canTransform("selected"));assertFalse(view.canTransform("another"));
            view.transformSelection("move",1,200,0,20,40);
            Bitmap moved=pixels(view);try{assertEquals(0,Color.alpha(moved.getPixel(60,60)));assertEquals(128,Color.alpha(moved.getPixel(260,60)));}finally{moved.recycle();}
            view.cancelSelection("move");Bitmap restored=pixels(view);try{assertEquals(128,Color.alpha(restored.getPixel(60,60)));assertEquals(0,Color.alpha(restored.getPixel(260,60)));}finally{restored.recycle();}
        });
    }

    @Test public void unchangedLargeSelectionDoesNotReplayItsVectorsForAnAcknowledgement() throws Exception {
        NativeScene scene=new NativeScene();JSONArray nodes=new JSONArray();
        for(int i=0;i<100;i++)nodes.put(ink("stroke"+i,"a"+String.format(java.util.Locale.ROOT,"%04d",i),"M20 60 L580 60","#ff0000",true,-1));
        JSONArray ids=new JSONArray();for(int i=0;i<100;i++)ids.put("stroke"+i);
        JSONObject first=update(nodes,true).put("selectionIds",ids).put("selectionBounds",new JSONArray("[0,0,600,200]"));
        NativeScene.Frame selected=scene.synchronize(first,1,0,java.util.Collections.emptyList());
        NativeScene.Frame acknowledgement=scene.synchronize(update(new JSONArray(),false).put("selectionIds",ids).put("selectionBounds",new JSONArray("[0,0,600,200]")).put("eraseThrough",1),1,1,java.util.Collections.emptyList());
        assertEquals("No unchanged selected vector is rasterized again",0,acknowledgement.rasterizedNodes);
        assertFalse(selected.selected.isEmpty());
        for(Long cell:selected.selected.keySet()){
            assertSame(selected.selected.get(cell),acknowledgement.selected.get(cell));
            assertSame(selected.selectedIdle.get(cell),acknowledgement.selectedIdle.get(cell));
        }
    }
    @Test public void pendingEraseKeepsOnlyBackupsOfTheCurrentlyInstalledTileParts() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            try {
                NativeScene scene=new NativeScene();NativeSceneView view=surface();
                view.apply(scene.synchronize(update(new JSONArray().put(ink("ink","a0","M20 60 L580 60","#ff0000",true,0)),true),1,0,java.util.Collections.emptyList()));
                view.erase("slow-js",90,60,110,60,30,30);
                java.lang.reflect.Field field=NativeSceneView.class.getDeclaredField("backups");field.setAccessible(true);
                for(int i=0;i<40;i++){
                    view.apply(scene.synchronize(update(new JSONArray().put(ink("ink","a0","M20 60 L580 60","#ff0000",true,0)),false),1,0,java.util.Collections.emptyList()));
                    java.util.Map<?,?> gestures=(java.util.Map<?,?>)field.get(view);
                    assertEquals("Obsolete worker frames must not retain bitmap generations",1,((java.util.Map<?,?>)gestures.get("slow-js")).size());
                }
                Bitmap erased=pixels(view);assertEquals(0,Color.alpha(erased.getPixel(100,60)));erased.recycle();
                view.cancelErase("slow-js");Bitmap restored=pixels(view);assertEquals(128,Color.alpha(restored.getPixel(100,60)));restored.recycle();
            } catch(Exception error){throw new AssertionError(error);}
        });
    }
    @Test public void cancellingAnEarlierEraserDoesNotResurrectALaterPendingErasure() throws Exception {
        NativeScene scene=new NativeScene();NativeScene.Frame frame=scene.synchronize(update(new JSONArray().put(ink("ink","a0","M20 60 L580 60","#ff0000",true,0)),true),1,0,java.util.Collections.emptyList());
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            NativeSceneView view=surface();view.apply(frame);
            view.erase("earlier",90,60,110,60,30,30);view.erase("later",170,60,190,60,30,30);
            view.cancelErase("earlier");Bitmap output=pixels(view);
            assertEquals(128,Color.alpha(output.getPixel(100,60)));assertEquals(0,Color.alpha(output.getPixel(180,60)));output.recycle();
            view.cancelErase("later");Bitmap restored=pixels(view);assertEquals(128,Color.alpha(restored.getPixel(180,60)));restored.recycle();
        });
    }

    @Test public void denseErasureConfirmationClearsOnlySweptTilesWithoutReplayingUnchangedInk() throws Exception {
        NativeScene scene=new NativeScene();JSONArray nodes=new JSONArray();
        nodes.put(ink("source","a0000","M20 60 L580 60","#ff0000",true,0));
        for(int i=1;i<=500;i++)nodes.put(ink("dense"+i,"a"+String.format(java.util.Locale.ROOT,"%04d",i),"M20 160 L580 160","#ff0000",true,0));
        NativeScene.Frame first=scene.synchronize(update(nodes,true),1,0,java.util.Collections.emptyList());
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            try {
                NativeSceneView view=surface();view.apply(first);
                long through=view.erase("erase",100,60,100,60,60,40);
                JSONArray survivors=new JSONArray().put(ink("left","a0000","M20 60 L60 60","#ff0000",true,through)).put(ink("right","a0001","M140 60 L580 60","#ff0000",true,through));
                JSONObject delta=update(survivors,false).put("removals",new JSONArray().put("source")).put("erasureRemovals",new JSONArray().put("source")).put("eraseThrough",through);
                NativeScene.Frame erased=scene.synchronize(delta,1,through,view.erasureSamples(through));
                assertEquals("No dense old vectors are replayed to confirm the same native sweep",0,erased.rasterizedNodes);
                assertEquals("Only the tile under the real eraser is copied/uploaded",1,erased.tiles.size());
                view.apply(erased);Bitmap output=pixels(view);
                assertEquals(0,Color.alpha(output.getPixel(100,60)));assertEquals(128,Color.alpha(output.getPixel(400,60)));
                assertTrue(Color.alpha(output.getPixel(400,160))>0);output.recycle();
                assertFalse(view.contains("source"));assertTrue(view.contains("left"));assertTrue(view.contains("right"));
                NativeScene.Frame selected=scene.synchronize(update(new JSONArray(),false).put("selectionIds",new JSONArray().put("left")).put("selectionBounds",new JSONArray("[20,50,60,70]")),1,through,java.util.Collections.emptyList());
                assertFalse("Selection uses updated canonical fragments, not erased source IDs",selected.selected.isEmpty());
            } catch(Exception error){throw new AssertionError(error);}
        });
    }
    @Test public void aConcurrentExternalDeletionIsNeverMistakenForAnEraserRasterDelta() throws Exception {
        NativeScene scene=new NativeScene();JSONArray nodes=new JSONArray().put(ink("source","a0","M20 60 L580 60","#ff0000",true,0)).put(ink("external","a1","M20 140 L580 140","#0000ff",true,0));
        NativeScene.Frame first=scene.synchronize(update(nodes,true),1,0,java.util.Collections.emptyList());
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            try {
                NativeSceneView view=surface();view.apply(first);long through=view.erase("erase",100,60,100,60,60,40);
                JSONObject delta=update(new JSONArray().put(ink("piece","a0","M140 60 L580 60","#ff0000",true,through)),false).put("removals",new JSONArray().put("source").put("external")).put("erasureRemovals",new JSONArray().put("source")).put("eraseThrough",through);
                NativeScene.Frame changed=scene.synchronize(delta,1,through,view.erasureSamples(through));
                assertTrue("A normal deletion requires canonical reconstruction",changed.rasterizedNodes>0);
                view.apply(changed);Bitmap output=pixels(view);assertEquals(0,Color.alpha(output.getPixel(400,140)));assertEquals(128,Color.alpha(output.getPixel(400,60)));output.recycle();
            } catch(Exception error){throw new AssertionError(error);}
        });
    }

}
