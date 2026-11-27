package com.fcjy.fcboard;

import android.graphics.*;
import java.io.*;

/** HSaxSlideParser / HBitmapObject / BitmapUtils.compressImageIfNeeded. */
final class BzdBitmap {
    static Bitmap decode(byte[] bytes) throws IOException {
        BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;
        BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
        if(options.outWidth<1 || options.outHeight<1)throw new IOException("Invalid BZD bitmap");
        if(options.outWidth>1920 || options.outHeight>1920){
            options.inSampleSize=Math.max(options.outWidth/1920,options.outHeight/1920);
            options.inPreferredConfig=Bitmap.Config.RGB_565;
        }
        options.inJustDecodeBounds=false;
        Bitmap bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
        if(bitmap==null)throw new IOException("Cannot decode BZD bitmap");
        return bitmap;
    }
    static byte[] png(Bitmap bitmap) throws IOException {
        try(ByteArrayOutputStream output=new ByteArrayOutputStream()){
            if(!bitmap.compress(Bitmap.CompressFormat.PNG,100,output))throw new IOException("Cannot encode BZD bitmap");
            return output.toByteArray();
        }
    }
    static final class Warped {
        final byte[] bytes;final int width,height;final RectF bounds;
        Warped(byte[] bytes,int width,int height,RectF bounds){this.bytes=bytes;this.width=width;this.height=height;this.bounds=bounds;}
    }
    /** The same Android matrix/Canvas path as HBitmapObject, with a transparent crop. */
    static Warped warp(Bitmap source,float[] values) throws IOException {
        Matrix matrix=new Matrix();matrix.setValues(values);
        float sign=0;
        for(float[] p:new float[][]{{0,0},{source.getWidth(),0},{0,source.getHeight()},{source.getWidth(),source.getHeight()}}){
            float w=values[6]*p[0]+values[7]*p[1]+values[8];
            if(!Float.isFinite(w) || Math.abs(w)<1e-8f || (sign!=0 && sign*Math.signum(w)<0))throw new IOException("Unbounded BZD perspective bitmap");sign=Math.signum(w);
        }
        RectF bounds=new RectF(0,0,source.getWidth(),source.getHeight());matrix.mapRect(bounds);
        if(!Float.isFinite(bounds.left+bounds.top+bounds.right+bounds.bottom) || bounds.width()<=0 || bounds.height()<=0 || Math.max(Math.max(Math.abs(bounds.left),Math.abs(bounds.right)),Math.max(Math.abs(bounds.top),Math.abs(bounds.bottom)))>1e7)throw new IOException("Invalid BZD bitmap bounds");
        float scale=Math.min(1f,2048f/Math.max(bounds.width(),bounds.height()));
        int width=Math.max(1,Math.round(bounds.width()*scale)),height=Math.max(1,Math.round(bounds.height()*scale));
        Bitmap raster=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888);
        try{
            Canvas canvas=new Canvas(raster);canvas.scale(width/bounds.width(),height/bounds.height());canvas.translate(-bounds.left,-bounds.top);canvas.concat(matrix);
            canvas.drawBitmap(source,null,new RectF(0,0,source.getWidth(),source.getHeight()),new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG));
            return new Warped(png(raster),width,height,bounds);
        }finally{raster.recycle();}
    }
}
