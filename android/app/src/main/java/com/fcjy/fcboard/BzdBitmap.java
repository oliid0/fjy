package com.fcjy.fcboard;

import android.graphics.*;
import java.io.*;
import org.json.JSONObject;
import org.w3c.dom.Element;

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
    static float[] matrix(String value) throws IOException {
        String[] parts=value.split(",",-1);if(parts.length!=9)throw new IOException("Invalid BZD bitmap matrix");
        float[] values=new float[9];
        try{for(int i=0;i<9;i++){values[i]=Float.parseFloat(parts[i]);if(!Float.isFinite(values[i]) || Math.abs(values[i])>1e7)throw new IOException("Invalid BZD bitmap matrix");}}
        catch(NumberFormatException error){throw new IOException("Invalid BZD bitmap matrix",error);}
        return values;
    }
    static String values(float[] matrix){StringBuilder result=new StringBuilder();for(int i=0;i<9;i++){if(i>0)result.append(',');result.append(matrix[i]);}return result.toString();}
    /** The XML's unit-square placement must be converted after actual decode/crop. */
    static byte[] materialize(Element object,byte[] bytes) throws Exception {
        Bitmap source=decode(bytes),rendered=null;
        try{
            // Older stages without the unit-square marker already use source pixels.
            if(!"true".equals(object.getAttribute("fcboardNormalizedImage")))return png(source);
            float x=0,y=0,width=source.getWidth(),height=source.getHeight();
            if(object.hasAttribute("fcboardImageCrop")){
                JSONObject crop=new JSONObject(object.getAttribute("fcboardImageCrop"));
                double naturalWidth=crop.getDouble("naturalWidth"),naturalHeight=crop.getDouble("naturalHeight");
                if(!Double.isFinite(naturalWidth+naturalHeight) || naturalWidth<=0 || naturalHeight<=0)throw new IOException("Invalid BZD image crop");
                x=(float)(crop.getDouble("x")*source.getWidth()/naturalWidth);y=(float)(crop.getDouble("y")*source.getHeight()/naturalHeight);
                width=(float)(crop.getDouble("width")*source.getWidth()/naturalWidth);height=(float)(crop.getDouble("height")*source.getHeight()/naturalHeight);
                if(!Float.isFinite(x+y+width+height) || x<0 || y<0 || width<=0 || height<=0 || x+width>source.getWidth()+.01f || y+height>source.getHeight()+.01f)throw new IOException("Invalid BZD image crop");
            }
            int alpha=object.hasAttribute("nRGBA_A")?Integer.parseInt(object.getAttribute("nRGBA_A")):255;
            if(alpha<0 || alpha>255)throw new IOException("Invalid BZD bitmap opacity");
            if(object.hasAttribute("fcboardImageCrop") || alpha<255){
                int w=Math.max(1,Math.round(width)),h=Math.max(1,Math.round(height));
                rendered=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888);
                Canvas canvas=new Canvas(rendered);canvas.scale(w/width,h/height);canvas.translate(-x,-y);
                Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG);paint.setAlpha(alpha);
                canvas.drawBitmap(source,null,new RectF(0,0,source.getWidth(),source.getHeight()),paint);
            }
            Bitmap output=rendered==null?source:rendered;
            if("true".equals(object.getAttribute("fcboardNormalizedImage"))){
                float[] m=matrix(object.getAttribute("matrix"));
                m[0]/=output.getWidth();m[3]/=output.getWidth();m[6]/=output.getWidth();
                m[1]/=output.getHeight();m[4]/=output.getHeight();m[7]/=output.getHeight();
                object.setAttribute("matrix",values(m));
                object.setAttribute("photoRectLeft","0");object.setAttribute("photoRectTop","0");
                object.setAttribute("photoRectRight",String.valueOf(output.getWidth()));object.setAttribute("photoRectBottom",String.valueOf(output.getHeight()));
                // Original HBitmapObject paints without an alpha Paint; alpha is in the pixels.
                object.setAttribute("nRGBA_A","255");object.removeAttribute("fcboardNormalizedImage");object.removeAttribute("fcboardImageCrop");
            }
            return png(output);
        }finally{source.recycle();if(rendered!=null)rendered.recycle();}
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
