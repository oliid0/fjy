package com.fcjy.fcboard;

import android.Manifest;
import android.os.Build;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import org.w3c.dom.*;
import org.json.JSONObject;

/** Chunked BZD staging and the original in-app file browser on real storage. */
@CapacitorPlugin(name="FcboardBoardFile",permissions={@Permission(alias="legacyStorage",strings={Manifest.permission.READ_EXTERNAL_STORAGE,Manifest.permission.WRITE_EXTERNAL_STORAGE})})
public class BoardFilePlugin extends Plugin {
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private File staged;
    private String id;
    private long expected;
    private long received;
    private boolean complete;
    private boolean saving;
    private FactoryFileAccess.Kind kind=FactoryFileAccess.Kind.BOARD;
    private java.util.List<FactoryPageExport.Page> exportPages=java.util.Collections.emptyList();
    private FactoryPageExport.Prepared pageExport;
    private FactoryFileBrowserDialog browser;
    private String browserOwner;
    private final java.util.Set<String> canceledBrowsers = new java.util.LinkedHashSet<>();
    private File opened;
    private String readId;
    private long readSize,readModified;
    private final java.util.List<File> createdAssets = new java.util.ArrayList<>();
    private static final long MAX_SIZE=64L*1024*1024;
    private void require(PluginCall call) throws IOException {
        if(staged==null || !id.equals(call.getString("id"))) throw new IOException("Board file session expired");
    }
    private void clear() {
        if(staged!=null) staged.delete();
        if(pageExport!=null)pageExport.clear();pageExport=null;exportPages=java.util.Collections.emptyList();kind=FactoryFileAccess.Kind.BOARD;
        for(File image:createdAssets) image.delete();
        createdAssets.clear(); staged=null;id=null;complete=false;received=0;
    }
    @PluginMethod public void begin(PluginCall call) { worker.execute(()->{
        try {
            if(saving || staged!=null) throw new IOException("A board file is being saved");
            long size=call.getLong("size",0L);
            if(size<1 || size>MAX_SIZE) throw new IOException("Invalid BZD file size");
            clear();kind=FactoryFileAccess.Kind.read(call.getString("kind","bzd"));
            if(kind!=FactoryFileAccess.Kind.BOARD)exportPages=FactoryPageExport.manifest(call.getArray("pages"),size);
            id=UUID.randomUUID().toString();expected=size;
            staged=File.createTempFile("board-",".bzd",getContext().getCacheDir());
            call.resolve(new JSObject().put("id",id));
        }catch(Exception e){call.reject(e.getMessage(),e);}
    }); }
    @PluginMethod public void append(PluginCall call) { worker.execute(()->{
        try { require(call);String data=call.getString("data","");
            if(complete || saving || data.length()>350000 || call.getLong("offset",-1L)!=received) throw new IOException("Invalid BZD chunk");
            byte[] bytes=Base64.decode(data,Base64.DEFAULT);
            if(received+bytes.length>expected) throw new IOException("BZD size exceeded");
            try(FileOutputStream output=new FileOutputStream(staged,true)){output.write(bytes);}received+=bytes.length;call.resolve();
        }catch(Exception e){call.reject(e.getMessage(),e);}
    }); }
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
    /** Original OBJECT_BITMAP reads a raster path; keep original SVG in the Fcboard extension. */
    static byte[] compatibleImage(String data) throws Exception {
        int comma=data.indexOf(',');
        if(comma<0 || data.length()>28*1024*1024)throw new IOException("Invalid BZD image data");
        String header=data.substring(0,comma).toLowerCase(java.util.Locale.ROOT);
        boolean svg=header.matches("data:image/svg\\+xml(?:;charset=[^;,]+)?(?:;base64)?");
        if(!svg && !header.matches("data:image/(png|jpeg|webp|gif);base64"))throw new IOException("Unsupported BZD image data");
        byte[] bytes=header.endsWith(";base64")?Base64.decode(data.substring(comma+1),Base64.DEFAULT):java.net.URLDecoder.decode(data.substring(comma+1).replace("+","%2B"),"UTF-8").getBytes(StandardCharsets.UTF_8);
        if(bytes.length<8 || bytes.length>20*1024*1024)throw new IOException("Invalid BZD image size");
        if(!svg)return bytes;
        String source=new String(bytes,StandardCharsets.UTF_8);
        String upper=source.toUpperCase(java.util.Locale.ROOT);
        if(upper.contains("<!DOCTYPE") || upper.contains("<!ENTITY"))throw new IOException("SVG entities are not supported");
        // Verified against AndroidSVG 1.4 sources.jar and its renderToCanvas API.
        com.caverock.androidsvg.SVG document=com.caverock.androidsvg.SVG.getFromString(source);
        android.graphics.RectF view=document.getDocumentViewBox();
        float width=document.getDocumentWidth(),height=document.getDocumentHeight();
        if(!Float.isFinite(width) || width<=0)width=view!=null && view.width()>0?view.width():512;
        if(!Float.isFinite(height) || height<=0)height=view!=null && view.height()>0?view.height():512;
        float scale=Math.min(1f,2048f/Math.max(width,height));
        int rasterWidth=Math.max(1,Math.round(width*scale)),rasterHeight=Math.max(1,Math.round(height*scale));
        android.graphics.Bitmap bitmap=android.graphics.Bitmap.createBitmap(rasterWidth,rasterHeight,android.graphics.Bitmap.Config.ARGB_8888);
        try(ByteArrayOutputStream output=new ByteArrayOutputStream()){
            document.setDocumentWidth((float)rasterWidth);document.setDocumentHeight((float)rasterHeight);
            document.renderToCanvas(new android.graphics.Canvas(bitmap));
            if(!bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output))throw new IOException("Cannot render BZD SVG");
            return output.toByteArray();
        }finally{bitmap.recycle();}
    }
    private File materializeImages(File assets) throws Exception {
        Document xml=readXml(staged);
        if(!"bzd".equals(xml.getDocumentElement().getTagName())) throw new IOException("Invalid BZD XML");
        NodeList slides=xml.getElementsByTagName("slide");
        for(int page=0;page<slides.getLength();page++){
            Element slide=(Element)slides.item(page);NodeList extensions=slide.getElementsByTagName("fcboard");
            JSONObject files=extensions.getLength()==0 ? new JSONObject():new JSONObject(extensions.item(0).getTextContent()).optJSONObject("files");
            if(files==null) files=new JSONObject();
            NodeList objects=slide.getElementsByTagName("object");
            for(int index=0;index<objects.getLength();index++){
                Element object=(Element)objects.item(index);String path=object.getAttribute("picUrl");
                if(!path.startsWith("fcboard-asset:")) continue;
                JSONObject file=files.optJSONObject(path.substring(14));
                if(file==null) throw new IOException("BZD image data is missing");
                String data=file.optString("dataURL");
                byte[] bytes=BzdBitmap.materialize(object,compatibleImage(data));
                if(!assets.isDirectory() && !assets.mkdirs()) throw new IOException("Cannot create board asset directory");
                String suffix=".png";
                File image=new File(assets,UUID.randomUUID()+suffix);
                createdAssets.add(image);
                try(FileOutputStream output=new FileOutputStream(image)){output.write(bytes);}
                object.setAttribute("picUrl",image.getAbsolutePath());
            }
        }
        File output=File.createTempFile("board-ready-",".bzd",getContext().getCacheDir());
        try { TransformerFactory.newInstance().newTransformer().transform(new DOMSource(xml),new StreamResult(output));return output; }
        catch(Exception error){output.delete();throw error;}
    }
    @PluginMethod public void save(PluginCall call) {worker.execute(()->{
        try {require(call);if(saving || received!=expected) throw new IOException("BZD upload incomplete");
            complete=true;saving=true;getActivity().runOnUiThread(()->showSave(call));
        }catch(Exception e){call.reject(e.getMessage(),e);}
    });}
    private boolean needsStorage(){return Build.VERSION.SDK_INT<30 && getPermissionState("legacyStorage")!=PermissionState.GRANTED;}
    @PermissionCallback private void savePermission(PluginCall call){if(getPermissionState("legacyStorage")==PermissionState.GRANTED)showSave(call);else{worker.execute(()->{saving=false;call.reject("File access permission denied");});}}
    @PermissionCallback private void openPermission(PluginCall call){if(getPermissionState("legacyStorage")==PermissionState.GRANTED)showOpen(call);else call.reject("File access permission denied");}
    private void showSave(PluginCall call){
        String owner=call.getString("id","");
        if(canceledBrowsers.remove(owner)){worker.execute(()->{saving=false;clear();call.resolve(new JSObject().put("saved",false));});return;}
        if(needsStorage()){requestPermissionForAlias("legacyStorage",call,"savePermission");return;}
        if(browser!=null){worker.execute(()->{saving=false;call.reject("A file browser is already open");});return;}
        browserOwner=owner;
        browser=new FactoryFileBrowserDialog(getActivity(),true,call.getString("language","en"),worker,new FactoryFileBrowserDialog.Operation(){
          @Override public boolean exists(File target){
            if(kind==FactoryFileAccess.Kind.BOARD)return target.exists();
            for(File file:FactoryPageExport.targets(target,kind,exportPages))if(file.exists())return true;return false;
          }
          @Override public void apply(File target) throws Exception {
            if(kind!=FactoryFileAccess.Kind.BOARD){
                if(pageExport==null){
                    android.content.res.Configuration locale=new android.content.res.Configuration(getContext().getResources().getConfiguration());locale.setLocale(java.util.Locale.forLanguageTag(call.getString("language","en")));
                    pageExport=FactoryPageExport.prepare(staged,getContext().getCacheDir(),kind,exportPages,getContext().createConfigurationContext(locale).getString(R.string.factory_fb_record));
                }
                FactoryFileAccess.copyBatchAtomic(pageExport.files,FactoryPageExport.targets(target,kind,exportPages));return;
            }
            File ready=null;
            try{
                File assets=new File(target.getParentFile(),target.getName()+".assets");
                if(!FactoryFileAccess.contains(target.getParentFile(),assets))throw new IOException("Invalid BZD asset directory");
                ready=materializeImages(assets);
                FactoryFileAccess.copyAtomic(ready,target);createdAssets.clear();
            }catch(Exception error){for(File asset:createdAssets)asset.delete();createdAssets.clear();throw error;}
            finally{if(ready!=null)ready.delete();}
          }
        },target->{browser=null;browserOwner=null;worker.execute(()->{
            java.util.List<File> files=target==null?java.util.Collections.emptyList():kind==FactoryFileAccess.Kind.BOARD?java.util.Collections.singletonList(target):FactoryPageExport.targets(target,kind,exportPages);
            com.getcapacitor.JSArray uris=new com.getcapacitor.JSArray();for(File file:files)uris.put(android.net.Uri.fromFile(file).toString());
            saving=false;clear();call.resolve(new JSObject().put("saved",target!=null).put("uri",uris.length()==0?null:uris.optString(0)).put("uris",uris));
        });},kind);
        try{browser.show();}catch(Exception error){browser=null;browserOwner=null;worker.execute(()->{saving=false;call.reject(error.getMessage(),error);});}
    }
    @PluginMethod public void choose(PluginCall call){getActivity().runOnUiThread(()->showOpen(call));}
    private void showOpen(PluginCall call){
        String owner=call.getString("requestId","");
        if(owner.isEmpty() || owner.length()>100){call.reject("Invalid file browser request");return;}
        if(canceledBrowsers.remove(owner)){call.resolve(new JSObject().put("cancelled",true));return;}
        if(needsStorage()){requestPermissionForAlias("legacyStorage",call,"openPermission");return;}
        if(browser!=null){call.reject("A file browser is already open");return;}
        final FactoryFileAccess.Kind kind;
        try{kind=FactoryFileAccess.Kind.read(call.getString("kind","bzd"));if(kind==FactoryFileAccess.Kind.PDF)throw new IOException("PDF is a save mode");}
        catch(Exception error){call.reject(error.getMessage(),error);return;}
        browserOwner=owner;
        browser=new FactoryFileBrowserDialog(getActivity(),false,call.getString("language","en"),worker,file->{
            if(!file.isFile() || !FactoryFileAccess.accepts(file,kind) || file.length()>MAX_SIZE)throw new IOException("Selected file is too large or unavailable");
        },file->{browser=null;browserOwner=null;worker.execute(()->{
            if(file==null){call.resolve(new JSObject().put("cancelled",true));return;}
            opened=file;readId=UUID.randomUUID().toString();readSize=file.length();readModified=file.lastModified();
            String extension=file.getName().substring(file.getName().lastIndexOf('.')+1).toLowerCase(java.util.Locale.ROOT);
            String mime=kind==FactoryFileAccess.Kind.BOARD?"application/xml":"image/"+("jpg".equals(extension)?"jpeg":extension);
            call.resolve(new JSObject().put("id",readId).put("name",file.getName()).put("size",readSize).put("mimeType",mime));
        });},kind);
        try{browser.show();}catch(Exception error){browser=null;browserOwner=null;call.reject(error.getMessage(),error);}
    }
    @PluginMethod public void cancelBrowser(PluginCall call){getActivity().runOnUiThread(()->{
        String owner=call.getString("id","");boolean canceled=false;
        if(!owner.isEmpty() && owner.equals(browserOwner) && browser!=null)canceled=browser.cancelIdle();
        else if(!owner.isEmpty()){if(canceledBrowsers.size()>=32)canceledBrowsers.clear();canceledBrowsers.add(owner);}
        call.resolve(new JSObject().put("cancelled",canceled));
    });}
    @PluginMethod public void read(PluginCall call){worker.execute(()->{
        try{
            if(opened==null || readId==null || !readId.equals(call.getString("id")) || opened.length()!=readSize || opened.lastModified()!=readModified)throw new IOException("Board file selection expired or changed");
            long offset=call.getLong("offset",-1L);if(offset<0 || offset>=readSize)throw new IOException("Invalid board read offset");
            byte[] bytes=new byte[(int)Math.min(262144,readSize-offset)];
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
    @PluginMethod public void close(PluginCall call){worker.execute(()->{if(!saving && id!=null && id.equals(call.getString("id")))clear();if(readId!=null && readId.equals(call.getString("id"))){readId=null;opened=null;}call.resolve();});}
    @Override protected void handleOnDestroy(){if(browser!=null)browser.dismiss();worker.execute(this::clear);worker.shutdown();}
}
