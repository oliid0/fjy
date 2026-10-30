package com.fcjy.fcboard;

import static org.junit.Assert.*;
import android.graphics.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.w3c.dom.Element;

@RunWith(AndroidJUnit4.class)
public class BzdBitmapTest {
    private Bitmap colors() {
        Bitmap bitmap=Bitmap.createBitmap(40,20,Bitmap.Config.ARGB_8888);
        Canvas canvas=new Canvas(bitmap);Paint paint=new Paint();
        paint.setColor(Color.RED);canvas.drawRect(0,0,20,20,paint);
        paint.setColor(Color.BLUE);canvas.drawRect(20,0,40,20,paint);
        return bitmap;
    }
    private Element object(String matrix) throws Exception {
        Element object=DocumentBuilderFactory.newInstance().newDocumentBuilder().newDocument().createElement("object");
        object.setAttribute("fcboardNormalizedImage","true");object.setAttribute("matrix",matrix);object.setAttribute("nRGBA_A","255");
        return object;
    }
    /** Exercise HBitmapObject.doDraw's real Canvas.drawBitmap(bitmap,matrix,null). */
    private Bitmap draw(byte[] bytes,Element object) throws Exception {
        Bitmap bitmap=BzdBitmap.decode(bytes),board=Bitmap.createBitmap(160,140,Bitmap.Config.ARGB_8888);
        try{Matrix matrix=new Matrix();matrix.setValues(BzdBitmap.matrix(object.getAttribute("matrix")));new Canvas(board).drawBitmap(bitmap,matrix,null);return board;}
        finally{bitmap.recycle();}
    }
    @Test public void exportedSourcePixelsLandAtTheDisplayedBoardCoordinates() throws Exception {
        Bitmap source=colors(),board=null;
        try{
            Element object=object("80,0,10,0,40,20,0,0,1");
            byte[] bytes=BzdBitmap.materialize(object,BzdBitmap.png(source));board=draw(bytes,object);
            assertEquals(Color.RED,board.getPixel(20,30));assertEquals(Color.BLUE,board.getPixel(70,30));
            assertEquals(0,Color.alpha(board.getPixel(0,0)));
            assertEquals("40",object.getAttribute("photoRectRight"));assertEquals("20",object.getAttribute("photoRectBottom"));
            assertFalse(object.hasAttribute("fcboardNormalizedImage"));
        }finally{source.recycle();if(board!=null)board.recycle();}
    }
    @Test public void cropReflectionRotationAndOpacitySurviveTheOriginalNullPaintRenderer() throws Exception {
        Bitmap source=colors(),board=null;
        try{
            Element object=object("0,-40,90,-60,0,100,0,0,1");object.setAttribute("nRGBA_A","128");
            object.setAttribute("fcboardImageCrop","{\"x\":20,\"y\":0,\"width\":20,\"height\":20,\"naturalWidth\":40,\"naturalHeight\":20}");
            byte[] bytes=BzdBitmap.materialize(object,BzdBitmap.png(source));board=draw(bytes,object);
            int pixel=board.getPixel(70,70);assertEquals(128,Color.alpha(pixel));assertEquals(255,Color.blue(pixel));assertEquals(0,Color.red(pixel));
            assertEquals(0,Color.alpha(board.getPixel(40,70)));assertEquals(0,Color.alpha(board.getPixel(70,110)));
            assertEquals("20",object.getAttribute("photoRectRight"));assertEquals("20",object.getAttribute("photoRectBottom"));
            assertEquals("255",object.getAttribute("nRGBA_A"));assertFalse(object.hasAttribute("fcboardImageCrop"));
        }finally{source.recycle();if(board!=null)board.recycle();}
    }
    @Test public void shearAndPerspectiveUseTransparentRastersAtTheirActualMappedBounds() throws Exception {
        Bitmap source=colors();
        try{
            BzdBitmap.Warped shear=BzdBitmap.warp(source,new float[]{1,.5f,10,0,1,20,0,0,1});
            assertEquals(new RectF(10,20,60,40),shear.bounds);
            Bitmap raster=BzdBitmap.decode(shear.bytes);
            try{assertEquals(Color.RED,raster.getPixel(10,10));assertEquals(Color.BLUE,raster.getPixel(30,10));assertEquals(0,Color.alpha(raster.getPixel(49,1)));}finally{raster.recycle();}
            BzdBitmap.Warped perspective=BzdBitmap.warp(source,new float[]{1,0,0,0,1,0,.01f,0,1});
            assertEquals(40/1.4f,perspective.bounds.right,.001f);assertEquals(20,perspective.bounds.bottom,.001f);
            raster=BzdBitmap.decode(perspective.bytes);
            try{assertEquals(0,Color.alpha(raster.getPixel(raster.getWidth()-1,raster.getHeight()-1)));}finally{raster.recycle();}
            try{BzdBitmap.warp(source,new float[]{1,0,0,0,1,0,-.1f,0,1});fail("A perspective pole crosses the image");}catch(java.io.IOException expected){assertTrue(expected.getMessage().contains("Unbounded"));}
        }finally{source.recycle();}
    }
    @Test public void sourceBitmapDecodingMatchesTheOriginalIntegerSamplingPolicy() throws Exception {
        Bitmap source=Bitmap.createBitmap(3840,8,Bitmap.Config.ARGB_8888),decoded=null;
        try{decoded=BzdBitmap.decode(BzdBitmap.png(source));assertEquals(1920,decoded.getWidth());assertEquals(4,decoded.getHeight());}
        finally{source.recycle();if(decoded!=null)decoded.recycle();}
        source=Bitmap.createBitmap(2048,8,Bitmap.Config.ARGB_8888);decoded=null;
        try{decoded=BzdBitmap.decode(BzdBitmap.png(source));assertEquals(2048,decoded.getWidth());assertEquals(8,decoded.getHeight());}
        finally{source.recycle();if(decoded!=null)decoded.recycle();}
    }
    @Test public void invalidMatricesAndOutOfRangeCropsFailBeforeCreatingAnAsset() throws Exception {
        for(String matrix:new String[]{"1,0", "1,0,NaN,0,1,0,0,0,1", "1,0,Infinity,0,1,0,0,0,1"}){
            try{BzdBitmap.matrix(matrix);fail(matrix);}catch(java.io.IOException expected){assertTrue(expected.getMessage().contains("matrix"));}
        }
        Bitmap source=colors();
        try{
            Element object=object("40,0,0,0,20,0,0,0,1");object.setAttribute("fcboardImageCrop","{\"x\":30,\"y\":0,\"width\":20,\"height\":20,\"naturalWidth\":40,\"naturalHeight\":20}");
            try{BzdBitmap.materialize(object,BzdBitmap.png(source));fail("Out of range crop");}catch(java.io.IOException expected){assertTrue(expected.getMessage().contains("crop"));}
        }finally{source.recycle();}
    }
}
