package com.fcjy.fcboard;

import android.graphics.BitmapFactory;
import com.getcapacitor.JSArray;
import java.io.*;
import java.util.*;
import org.json.JSONObject;

/** ChooseFileListener SAVE_JPG / SAVE_PDF and PDFUtil's actual A4 image flow. */
final class FactoryPageExport {
    static final class Page {
        final int number;final long size;
        Page(int number,long size){this.number=number;this.size=size;}
    }
    static List<Page> manifest(JSArray values,long size) throws Exception {
        if(values==null || values.length()<1 || values.length()>20)throw new IOException("Choose 1 to 20 export pages");
        List<Page> pages=new ArrayList<>();long total=0;int previous=0;
        for(int i=0;i<values.length();i++){
            JSONObject value=values.getJSONObject(i);int number=value.getInt("page");long bytes=value.getLong("size");
            if(number<=previous || number>100 || bytes<1 || bytes>16*1024*1024 || value.getDouble("page")!=number || value.getDouble("size")!=bytes)throw new IOException("Invalid export page");
            pages.add(new Page(number,bytes));previous=number;total+=bytes;
        }
        if(total!=size || total>FactoryFileAccess.MAX_BYTES)throw new IOException("Incomplete page export");
        return pages;
    }
    static List<File> targets(File target,FactoryFileAccess.Kind kind,List<Page> pages){
        if(kind==FactoryFileAccess.Kind.PDF)return Collections.singletonList(target);
        String name=target.getName();String base=name.substring(0,name.length()-4);List<File> files=new ArrayList<>();
        for(Page page:pages)files.add(new File(target.getParentFile(),base+"_"+String.format(Locale.ROOT,"%02d",page.number)+".jpg"));
        return files;
    }
    static final class Prepared {
        final File folder;final List<File> files;
        Prepared(File folder,List<File> files){this.folder=folder;this.files=files;}
        void clear(){File[] children=folder.listFiles();if(children!=null)for(File file:children)file.delete();folder.delete();}
    }
    static Prepared prepare(File staged,File cache,FactoryFileAccess.Kind kind,List<Page> pages,String title) throws Exception {
        File folder=new File(cache,"page-export-"+UUID.randomUUID());if(!folder.mkdir())throw new IOException("Cannot prepare page files");
        Prepared output=new Prepared(folder,new ArrayList<>());
        try(InputStream input=new FileInputStream(staged)){
            byte[] buffer=new byte[65536];
            for(Page page:pages){
                File file=new File(folder,page.number+".jpg");
                try(FileOutputStream stream=new FileOutputStream(file)){
                    for(long remaining=page.size;remaining>0;){int count=input.read(buffer,0,(int)Math.min(buffer.length,remaining));if(count<1)throw new IOException("Incomplete page image");stream.write(buffer,0,count);remaining-=count;}
                }
                BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeFile(file.getAbsolutePath(),options);
                if(!"image/jpeg".equals(options.outMimeType) || options.outWidth<1 || options.outWidth>4096 || options.outHeight<1 || options.outHeight>4096)throw new IOException("Invalid exported JPEG page");
                output.files.add(file);
            }
            if(input.read()!=-1)throw new IOException("Unexpected page data");
            if(kind==FactoryFileAccess.Kind.PDF){File pdf=new File(folder,"selected.pdf");writePdf(output.files,pdf,title);output.files.clear();output.files.add(pdf);}
            return output;
        }catch(Exception error){output.clear();throw error;}
    }
    /** PDFUtil: A4 (595x842), margins 50/50/30/30, 18pt title,
     * scaleToFit(500,500), centered. PdfDocument.add(Image) adds leading/2 (13.5pt). */
    static void writePdf(List<File> images,File target,String title) throws Exception {
        android.graphics.pdf.PdfDocument pdf=new android.graphics.pdf.PdfDocument();
        android.graphics.pdf.PdfDocument.Page page=null;
        try{
            page=pdf.startPage(new android.graphics.pdf.PdfDocument.PageInfo.Builder(595,842,1).create());int number=1;
            android.graphics.Paint text=new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);text.setTextSize(18);text.setColor(android.graphics.Color.BLACK);text.setTextAlign(android.graphics.Paint.Align.CENTER);text.setTypeface(android.graphics.Typeface.create(android.graphics.Typeface.SANS_SERIF,android.graphics.Typeface.BOLD));
            page.getCanvas().drawText(title,595f/2,57,text);float cursor=57;
            for(File file:images){
                BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeFile(file.getAbsolutePath(),options);
                BoardAttachments.PdfPageSpec spec=new BoardAttachments.PdfPageSpec(options.outWidth,options.outHeight,images.size());
                float scale=Math.min(500f/options.outWidth,500f/options.outHeight),width=options.outWidth*scale,height=options.outHeight*scale;
                if(cursor+height>812){pdf.finishPage(page);page=null;page=pdf.startPage(new android.graphics.pdf.PdfDocument.PageInfo.Builder(595,842,++number).create());cursor=30;}
                options.inJustDecodeBounds=false;options.inSampleSize=spec.sampleSize;
                android.graphics.Bitmap bitmap=BitmapFactory.decodeFile(file.getAbsolutePath(),options);if(bitmap==null)throw new IOException("Could not decode exported page");
                try{
                    if(bitmap.getWidth()!=spec.width || bitmap.getHeight()!=spec.height){android.graphics.Bitmap scaled=android.graphics.Bitmap.createScaledBitmap(bitmap,spec.width,spec.height,true);bitmap.recycle();bitmap=scaled;}
                    android.graphics.Paint paint=new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG|android.graphics.Paint.FILTER_BITMAP_FLAG);
                    page.getCanvas().drawBitmap(bitmap,null,new android.graphics.RectF((595-width)/2,cursor+13.5f,(595+width)/2,cursor+13.5f+height),paint);
                }finally{bitmap.recycle();}
                cursor+=height+13.5f;
            }
            pdf.finishPage(page);page=null;
            try(FileOutputStream output=new FileOutputStream(target)){pdf.writeTo(output);}
        }finally{if(page!=null)pdf.finishPage(page);pdf.close();}
    }
}
