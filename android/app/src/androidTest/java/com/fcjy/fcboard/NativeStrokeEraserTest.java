package com.fcjy.fcboard;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real Java worker kernel: sparse fast sweeps, brush support and retained state. */
@RunWith(AndroidJUnit4.class)
public class NativeStrokeEraserTest {
    @Test public void aSweepCutsOnlyThePrefixAndKeepsLaterInkAtTheSameCoordinates() throws Exception {
        JSONObject ink=stroke("live",0,false).put("samples",new JSONArray("[[0,0,0.2,0,0,0],[100,0,0.5,100,0,1],[0,0,0.8,200,0,2]]"));
        JSONObject cut=new JSONObject().put("at",1).put("path",new JSONArray("[[50,-30],[50,30]]")).put("width",10).put("height",12);
        JSONArray pieces=new NativeStrokeEraser().clip(ink,new JSONArray().put(cut)).getJSONArray("pieces");
        assertEquals(2,pieces.length());assertEquals(43,pieces.getJSONArray(0).getJSONArray(1).getDouble(0),1e-9);
        JSONArray later=pieces.getJSONArray(1);assertEquals(57,later.getJSONArray(0).getDouble(0),1e-9);
        assertEquals("Later return stroke survives the same swept coordinates",0,later.getJSONArray(later.length()-1).getDouble(0),1e-9);
        assertEquals(200,later.getJSONArray(later.length()-1).getDouble(3),1e-9);
    }
    private static JSONObject stroke(String id, double y, boolean brush) throws Exception {
        return new JSONObject().put("id",id).put("cap",brush?0:4).put("brush",brush).put("brushAngle",0)
            .put("nibOutline",new JSONArray()).put("samples",new JSONArray("[[0,"+y+",0.2,10,10],[100,"+y+",0.8,110,10]]"));
    }
    @Test public void sparseStrokeCutsPreservePressureAndDashPhase() throws Exception {
        NativeStrokeEraser kernel=new NativeStrokeEraser();
        kernel.synchronize(new JSONArray().put(stroke("ink",0,false)),new JSONArray());
        JSONObject patch=kernel.erase(new JSONArray("[[50,-30],[50,30]]"),10,12).getJSONObject(0);
        JSONArray pieces=patch.getJSONArray("pieces"); assertEquals(2,pieces.length());
        JSONArray end=pieces.getJSONArray(0).getJSONArray(1),start=pieces.getJSONArray(1).getJSONArray(0);
        assertEquals(43,end.getDouble(0),1e-9); assertEquals(57,start.getDouble(0),1e-9);
        assertEquals(.458,end.getDouble(2),1e-9); assertEquals(67,start.getDouble(3),1e-9);
        assertEquals("An already erased gap produces no patch",0,kernel.erase(new JSONArray("[[50,0],[50,0]]"),4,4).length());
    }
    @Test public void brushFootprintUsesRotatedTwoToOneEllipse() throws Exception {
        for(boolean rotated:new boolean[]{false,true}) {
            NativeStrokeEraser kernel=new NativeStrokeEraser(); JSONObject brush=stroke("brush",0,true);
            if(rotated) brush.put("brushAngle",Math.PI/2);
            kernel.synchronize(new JSONArray().put(brush),new JSONArray());
            JSONArray pieces=kernel.erase(new JSONArray("[[50,0],[50,0]]"),10,12).getJSONObject(0).getJSONArray("pieces");
            assertEquals(rotated?42.5:40,pieces.getJSONArray(0).getJSONArray(1).getDouble(0),1e-8);
            assertEquals(rotated?57.5:60,pieces.getJSONArray(1).getJSONArray(0).getDouble(0),1e-8);
        }
    }
    @Test public void retainedSceneHandlesSequentialSweepsResynchronizationAndRemoval() throws Exception {
        NativeStrokeEraser kernel=new NativeStrokeEraser(); JSONArray scene=new JSONArray();
        scene.put(stroke("near",0,false));
        for(int i=1;i<=2000;i++) scene.put(stroke("far"+i,1000+i*20,false));
        kernel.synchronize(scene,new JSONArray());
        JSONArray patches=kernel.erase(new JSONArray("[[30,0],[30,0],[70,0]]"),10,12);
        assertEquals(1,patches.length()); assertEquals("near",patches.getJSONObject(0).getString("id"));
        assertEquals(23,patches.getJSONObject(0).getJSONArray("pieces").getJSONArray(0).getJSONArray(1).getDouble(0),1e-9);
        kernel.synchronize(new JSONArray().put(stroke("near",0,false)),new JSONArray());
        assertEquals(1,kernel.erase(new JSONArray("[[30,0],[30,0]]"),10,12).length());
        kernel.synchronize(new JSONArray(),new JSONArray().put("near"));
        assertEquals(0,kernel.erase(new JSONArray("[[30,0],[30,0]]"),10,12).length());
    }
    @Test public void oneBatchedSweepMatchesSeparateCutsForCrossingInkAndBrushes() throws Exception {
        for(boolean brush:new boolean[]{false,true}){
            JSONObject ink=stroke("ink",0,brush).put("brushAngle",.7).put("samples",new JSONArray("[[0,0,0.2,10,10],[200,0,0.5,210,20],[0,0,0.8,410,10]]"));
            NativeStrokeEraser batched=new NativeStrokeEraser(),separate=new NativeStrokeEraser();
            batched.synchronize(new JSONArray().put(ink),new JSONArray());separate.synchronize(new JSONArray().put(ink),new JSONArray());
            JSONArray points=new JSONArray("[[30,0],[30,0],[30,80],[160,80],[160,0],[160,0]]");
            JSONArray actual=batched.erase(points,10,12).getJSONObject(0).getJSONArray("pieces"),expected=null;
            for(int i=1;i<points.length();i++){
                JSONArray patches=separate.erase(new JSONArray().put(points.getJSONArray(i-1)).put(points.getJSONArray(i)),10,12);
                if(patches.length()>0)expected=patches.getJSONObject(0).getJSONArray("pieces");
            }
            assertNotNull(expected);assertEquals(expected.length(),actual.length());
            for(int i=0;i<actual.length();i++){
                JSONArray a=actual.getJSONArray(i),b=expected.getJSONArray(i);assertEquals(b.length(),a.length());
                for(int j=0;j<a.length();j++)for(int k=0;k<5;k++)assertEquals(b.getJSONArray(j).getDouble(k),a.getJSONArray(j).getDouble(k),1e-8);
            }
        }
    }
    @Test public void aLargeEraserClearsDenseInkWithoutRecreatingFragmentsOnRepeatedSamples() throws Exception {
        NativeStrokeEraser kernel=new NativeStrokeEraser();JSONArray points=new JSONArray();
        for(int i=0;i<20000;i++)points.put(new JSONArray(new double[]{i%100,(i/100)%100,.5,i,10}));
        JSONObject ink=stroke("dense",0,true).put("samples",points);
        kernel.synchronize(new JSONArray().put(ink),new JSONArray());
        JSONArray sweep=new JSONArray();for(int i=0;i<128;i++)sweep.put(new JSONArray(new double[]{50,50}));
        JSONObject patch=kernel.erase(sweep,120,120).getJSONObject(0);
        assertEquals("The whole stroke is covered, including its brush footprint",0,patch.getJSONArray("pieces").length());
        assertEquals("No old ink or redundant patch returns on another sweep",0,kernel.erase(sweep,120,120).length());
    }

}
