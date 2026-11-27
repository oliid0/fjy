package com.fcjy.fcboard;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;

/** Self-contained board bytes and Android's standard storage access framework. */
@CapacitorPlugin(name="FcboardBoardFile")
public class BoardFilePlugin extends Plugin {
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final Set<String> canceled=ConcurrentHashMap.newKeySet();
    private File staged,opened;
    private String id,readId,pickerOwner;
    private long expected,received,readSize,readModified;
    private boolean complete,saving;
    private FactoryPageExport.Kind kind=FactoryPageExport.Kind.BOARD;
    private List<FactoryPageExport.Page> exportPages=Collections.emptyList();
    private FactoryPageExport.Prepared pageExport;
    private static final long MAX_SIZE=FactoryPageExport.MAX_BYTES;
    private void require(PluginCall call) throws IOException {
        if(staged==null || !Objects.equals(id,call.getString("id")))throw new IOException("Board file session expired");
    }
    private void clear(){
        if(staged!=null)staged.delete();
        if(pageExport!=null)pageExport.clear();
        staged=null;id=null;pageExport=null;complete=false;received=0;
        exportPages=Collections.emptyList();kind=FactoryPageExport.Kind.BOARD;
    }
    @PluginMethod public void begin(PluginCall call){worker.execute(()->{
        try{
            if(saving || staged!=null)throw new IOException("A board file is being saved");
            long size=call.getData().optLong("size",0L);if(size<1 || size>MAX_SIZE)throw new IOException("Invalid board file size");
            clear();kind=FactoryPageExport.Kind.read(call.getString("kind","bzd"));
            if(kind!=FactoryPageExport.Kind.BOARD)exportPages=FactoryPageExport.manifest(call.getArray("pages"),size);
            id=UUID.randomUUID().toString();expected=size;staged=File.createTempFile("board-",".tmp",getContext().getCacheDir());
            call.resolve(new JSObject().put("id",id));
        }catch(Exception error){call.reject(error.getMessage(),error);}
    });}
    @PluginMethod public void append(PluginCall call){worker.execute(()->{
        try{
            require(call);String data=call.getString("data","");
            if(complete || saving || data.length()>350000 || call.getData().optLong("offset",-1L)!=received)throw new IOException("Invalid board chunk");
            byte[] bytes=Base64.decode(data,Base64.DEFAULT);if(received+bytes.length>expected)throw new IOException("Board size exceeded");
            try(OutputStream out=new FileOutputStream(staged,true)){out.write(bytes);}received+=bytes.length;call.resolve();
        }catch(Exception error){call.reject(error.getMessage(),error);}
    });}
    static Document readXml(File file) throws Exception {
        if(file.length()>MAX_SIZE) throw new IOException("BZD file is too large");
        byte[] bytes;
        try(InputStream input=new FileInputStream(file);ByteArrayOutputStream output=new ByteArrayOutputStream()) {
            byte[] buffer=new byte[65536];int count;
            while((count=input.read(buffer))!=-1) { if(output.size()+count>MAX_SIZE)throw new IOException("BZD file is too large");output.write(buffer,0,count); }
            bytes=output.toByteArray();
        }
        String source=new String(bytes,StandardCharsets.UTF_8);
        if(source.toUpperCase(java.util.Locale.ROOT).contains("<!DOCTYPE") || source.toUpperCase(java.util.Locale.ROOT).contains("<!ENTITY")) throw new IOException("BZD DTD and entities are not supported");
        DocumentBuilderFactory factory=DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(false);factory.setValidating(false);factory.setExpandEntityReferences(false);
        javax.xml.parsers.DocumentBuilder builder=factory.newDocumentBuilder();
        builder.setEntityResolver((publicId,systemId)->{throw new org.xml.sax.SAXException("External BZD entities are not supported");});
        return builder.parse(new ByteArrayInputStream(bytes));
    }
    @PluginMethod public void save(PluginCall call){worker.execute(()->{
        try{
            require(call);if(saving || received!=expected)throw new IOException("Board upload incomplete");
            complete=true;saving=true;
            if(kind==FactoryPageExport.Kind.BOARD){if(!"bzd".equals(readXml(staged).getDocumentElement().getTagName()))throw new IOException("Invalid BZD XML");}
            else pageExport=FactoryPageExport.prepare(staged,getContext().getCacheDir(),kind,exportPages,call.getString("name","Fcboard"));
            getActivity().runOnUiThread(()->{
                try{
                    String owner=call.getString("id","");if(canceled.remove(owner)){worker.execute(()->{saving=false;clear();call.resolve(new JSObject().put("saved",false));});return;}
                    if(pickerOwner!=null)throw new IOException("A file picker is already open");pickerOwner=owner;
                    boolean multiple=kind==FactoryPageExport.Kind.IMAGE && exportPages.size()>1;
                    Intent intent=multiple?new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE):new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(kind.mime).putExtra(Intent.EXTRA_TITLE,call.getString("name","Fcboard")+"."+kind.extension);
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    startActivityForResult(call,intent,"saved");
                }catch(Exception error){if(Objects.equals(pickerOwner,call.getString("id")))pickerOwner=null;worker.execute(()->{saving=false;clear();call.reject(error.getMessage(),error);});}
            });
        }catch(Exception error){if(Objects.equals(id,call.getString("id"))){saving=false;clear();}call.reject(error.getMessage(),error);}
    });}
    @ActivityCallback private void saved(PluginCall call,ActivityResult result){
        pickerOwner=null;worker.execute(()->{
            List<Uri> written=new ArrayList<>();
            try{
                if(call==null)return;String owner=call.getString("id","");
                if(result.getResultCode()!=Activity.RESULT_OK || result.getData()==null || result.getData().getData()==null){call.resolve(new JSObject().put("saved",false));return;}
                require(call);Uri selected=result.getData().getData();
                boolean multiple=kind==FactoryPageExport.Kind.IMAGE && exportPages.size()>1;
                if(!multiple)written.add(selected);
                if(canceled.contains(owner))throw new IOException("Save canceled");
                List<File> files=kind==FactoryPageExport.Kind.BOARD?Collections.singletonList(staged):pageExport.files;
                Uri directory=multiple?DocumentsContract.buildDocumentUriUsingTree(selected,DocumentsContract.getTreeDocumentId(selected)):null;
                for(int i=0;i<files.size();i++){
                    Uri target=multiple?DocumentsContract.createDocument(getContext().getContentResolver(),directory,"image/jpeg",call.getString("name","Fcboard")+"_"+String.format(Locale.ROOT,"%02d",exportPages.get(i).number)+".jpg"):selected;
                    if(target==null)throw new IOException("Cannot create selected file");if(multiple)written.add(target);
                    try(InputStream input=new FileInputStream(files.get(i));OutputStream output=getContext().getContentResolver().openOutputStream(target,"wt")){
                        if(output==null)throw new IOException("Cannot write selected file");byte[] buffer=new byte[65536];int count;
                        while((count=input.read(buffer))!=-1){if(canceled.contains(owner))throw new IOException("Save canceled");output.write(buffer,0,count);}
                    }
                }
                if(canceled.contains(owner))throw new IOException("Save canceled");
                JSArray uris=new JSArray();for(Uri uri:written)uris.put(uri.toString());
                call.resolve(new JSObject().put("saved",true).put("uri",uris.optString(0)).put("uris",uris));
            }catch(Exception error){
                for(Uri uri:written)try{DocumentsContract.deleteDocument(getContext().getContentResolver(),uri);}catch(Exception ignored){}
                if(call!=null){if(canceled.contains(call.getString("id","")))call.resolve(new JSObject().put("saved",false));else call.reject(error.getMessage(),error);}
            }finally{if(call!=null)canceled.remove(call.getString("id",""));saving=false;clear();}
        });
    }
    @PluginMethod public void choose(PluginCall call){getActivity().runOnUiThread(()->{
        String owner=call.getString("requestId","");
        try{
            if(owner.isEmpty() || owner.length()>100)throw new IOException("Invalid file request");
            if(canceled.remove(owner)){call.resolve(new JSObject().put("cancelled",true));return;}
            if(pickerOwner!=null)throw new IOException("A file picker is already open");pickerOwner=owner;
            startActivityForResult(call,new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),"chosen");
        }catch(Exception error){if(Objects.equals(pickerOwner,owner))pickerOwner=null;call.reject(error.getMessage(),error);}
    });}
    @ActivityCallback private void chosen(PluginCall call,ActivityResult result){pickerOwner=null;worker.execute(()->{
        File copy=null;
        try{
            if(call==null)return;
            if(result.getResultCode()!=Activity.RESULT_OK || result.getData()==null || result.getData().getData()==null || canceled.remove(call.getString("requestId",""))){call.resolve(new JSObject().put("cancelled",true));return;}
            Uri uri=result.getData().getData();String name="Image";
            try(Cursor cursor=getContext().getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(cursor!=null && cursor.moveToFirst())name=cursor.getString(0);}
            copy=File.createTempFile("board-open-",".tmp",getContext().getCacheDir());long size=0;
            try(InputStream input=getContext().getContentResolver().openInputStream(uri);OutputStream output=new FileOutputStream(copy)){
                if(input==null)throw new IOException("Cannot read selected file");byte[] buffer=new byte[65536];int count;
                while((count=input.read(buffer))!=-1){size+=count;if(size>MAX_SIZE)throw new IOException("Selected file is too large");output.write(buffer,0,count);}
            }
            if(opened!=null)opened.delete();opened=copy;copy=null;readId=UUID.randomUUID().toString();readSize=size;readModified=opened.lastModified();
            call.resolve(new JSObject().put("id",readId).put("name",name).put("size",size).put("mimeType",getContext().getContentResolver().getType(uri)));
        }catch(Exception error){if(copy!=null)copy.delete();if(call!=null)call.reject(error.getMessage(),error);}
    });}
    @PluginMethod public void cancelBrowser(PluginCall call){String owner=call.getString("id","");if(!owner.isEmpty())canceled.add(owner);call.resolve(new JSObject().put("cancelled",false));}
    @PluginMethod public void read(PluginCall call){worker.execute(()->{
        try{
            if(opened==null || !Objects.equals(readId,call.getString("id")) || opened.length()!=readSize || opened.lastModified()!=readModified)throw new IOException("File selection expired");
            long offset=call.getData().optLong("offset",-1L);if(offset<0 || offset>=readSize)throw new IOException("Invalid read offset");byte[] bytes=new byte[(int)Math.min(262144,readSize-offset)];
            try(RandomAccessFile input=new RandomAccessFile(opened,"r")){input.seek(offset);input.readFully(bytes);}
            call.resolve(new JSObject().put("data",Base64.encodeToString(bytes,Base64.NO_WRAP)).put("next",offset+bytes.length));
        }catch(Exception error){call.reject(error.getMessage(),error);}
    });}
    @PluginMethod public void readAsset(PluginCall call){worker.execute(()->{
        try {String path=call.getString("path","");File file=new File(path);
            if(!file.isAbsolute() || !path.toLowerCase(java.util.Locale.ROOT).matches(".*\\.(png|jpe?g|bmp|webp|gif)$") || !file.isFile() || file.length()>20*1024*1024)throw new IOException("BZD image file is unavailable");
            ByteArrayOutputStream output=new ByteArrayOutputStream();try(InputStream input=new FileInputStream(file)){byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1){if(output.size()+count>20*1024*1024)throw new IOException("BZD image is too large");output.write(buffer,0,count);}}
            byte[] bytes=output.toByteArray();android.graphics.BitmapFactory.Options options=new android.graphics.BitmapFactory.Options();options.inJustDecodeBounds=true;android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
            if(options.outWidth<1 || options.outHeight<1)throw new IOException("Invalid BZD image");
            String mime=options.outMimeType;if(!java.util.Arrays.asList("image/png","image/jpeg","image/bmp","image/webp","image/gif").contains(mime))throw new IOException("Unsupported BZD image");
            android.graphics.Bitmap bitmap=BzdBitmap.decode(bytes);
            try{
                com.getcapacitor.JSArray transform=call.getArray("transform");
                JSObject result=new JSObject().put("mimeType","image/png");byte[] pixels;
                if(transform!=null){
                    if(transform.length()!=9)throw new IOException("Invalid BZD bitmap matrix");
                    float[] m=new float[9];for(int i=0;i<9;i++){m[i]=(float)transform.getDouble(i);if(!Float.isFinite(m[i]) || Math.abs(m[i])>1e7)throw new IOException("Invalid BZD bitmap matrix");}
                    BzdBitmap.Warped warped=BzdBitmap.warp(bitmap,m);pixels=warped.bytes;
                    result.put("width",warped.width).put("height",warped.height).put("bounds",new JSObject().put("x",warped.bounds.left).put("y",warped.bounds.top).put("width",warped.bounds.width()).put("height",warped.bounds.height()));
                }else{pixels=BzdBitmap.png(bitmap);result.put("width",bitmap.getWidth()).put("height",bitmap.getHeight());}
                result.put("dataURL","data:image/png;base64,"+Base64.encodeToString(pixels,Base64.NO_WRAP));call.resolve(result);
            }finally{bitmap.recycle();}
        }catch(Exception e){call.reject(e.getMessage(),e);}
    });}
    @PluginMethod public void close(PluginCall call){worker.execute(()->{if(!saving && Objects.equals(id,call.getString("id")))clear();if(Objects.equals(readId,call.getString("id"))){if(opened!=null)opened.delete();opened=null;readId=null;}call.resolve();});}
    @Override protected void handleOnDestroy(){worker.execute(()->{clear();if(opened!=null)opened.delete();});worker.shutdown();}
}
