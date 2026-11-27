package com.fcjy.fcboard;

import static org.junit.Assert.*;
import android.graphics.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class BzdBitmapTest {
    private Bitmap colors() {
        Bitmap bitmap=Bitmap.createBitmap(40,20,Bitmap.Config.ARGB_8888);
        Canvas canvas=new Canvas(bitmap);Paint paint=new Paint();
        paint.setColor(Color.RED);canvas.drawRect(0,0,20,20,paint);
        paint.setColor(Color.BLUE);canvas.drawRect(20,0,40,20,paint);
        return bitmap;
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
}
