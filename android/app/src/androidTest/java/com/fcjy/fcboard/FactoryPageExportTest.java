package com.fcjy.fcboard;

import static org.junit.Assert.*;
import android.graphics.*;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.file.Files;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class FactoryPageExportTest {
    private File temporary() throws Exception {return Files.createTempDirectory(InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir().toPath(),"factory-export-").toFile();}
    private void remove(File file){if(file.isDirectory()){File[] children=file.listFiles();if(children!=null)for(File child:children)remove(child);}file.delete();}
    private byte[] jpeg(int color,int width,int height) throws Exception {
        Bitmap bitmap=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888);
        try(ByteArrayOutputStream bytes=new ByteArrayOutputStream()){bitmap.eraseColor(color);assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG,95,bytes));return bytes.toByteArray();}finally{bitmap.recycle();}
    }
    private List<FactoryPageExport.Page> manifest(byte[][] images,int... numbers) throws Exception {
        JSArray values=new JSArray();long size=0;
        for(int i=0;i<images.length;i++){values.put(new JSObject().put("page",numbers[i]).put("size",images[i].length));size+=images[i].length;}
        return FactoryPageExport.manifest(values,size);
    }
    private File stage(File root,byte[][] images) throws Exception {
        File file=new File(root,"staged");try(FileOutputStream out=new FileOutputStream(file)){for(byte[] bytes:images)out.write(bytes);}return file;
    }
    private void color(int expected,int actual){assertEquals(Color.red(expected),Color.red(actual),8);assertEquals(Color.green(expected),Color.green(actual),8);assertEquals(Color.blue(expected),Color.blue(actual),8);}
    @Test public void fileModesUseTheOriginalFoldersFiltersAndSuffixes() throws Exception {
        File root=temporary();
        try{
            for(String name:new String[]{"photo.JPG","scan.bmp","chart.png","notes.pdf","lesson.bzd","unrelated.txt"})Files.write(new File(root,name).toPath(),new byte[]{1});
            assertEquals(3,FactoryFileAccess.list(root,root,FactoryFileAccess.Kind.IMAGE).size());assertEquals(1,FactoryFileAccess.list(root,root,FactoryFileAccess.Kind.PDF).size());
            assertTrue(FactoryFileAccess.initial(FactoryFileAccess.Kind.IMAGE).getPath().endsWith("/Whiteboard/image"));assertTrue(FactoryFileAccess.initial(FactoryFileAccess.Kind.PDF).getPath().endsWith("/Whiteboard/pdf"));
            assertEquals("课堂.jpg",FactoryFileAccess.destination(root,root,"课堂",FactoryFileAccess.Kind.IMAGE).getName());assertEquals("课堂.pdf",FactoryFileAccess.destination(root,root,"课堂.pdf",FactoryFileAccess.Kind.PDF).getName());
        }finally{remove(root);}
    }
    @Test public void writesTheSelectedJpegPixelsWithOriginalPageIndicesAndPreservesTargetsOnPreparationFailure() throws Exception {
        File root=temporary();FactoryPageExport.Prepared prepared=null;
        try{
            byte[][] images={jpeg(Color.RED,40,20),jpeg(Color.BLUE,40,20)};
            List<FactoryPageExport.Page> pages=manifest(images,3,12);
            prepared=FactoryPageExport.prepare(stage(root,images),root,FactoryFileAccess.Kind.IMAGE,pages,"Whiteboard Record");
            List<File> targets=FactoryPageExport.targets(new File(root,"课堂.jpg"),FactoryFileAccess.Kind.IMAGE,pages);
            assertEquals(Arrays.asList(new File(root,"课堂_03.jpg"),new File(root,"课堂_12.jpg")),targets);
            Files.write(targets.get(0).toPath(),new byte[]{9});Files.write(targets.get(1).toPath(),new byte[]{8});
            FactoryFileAccess.copyBatchAtomic(prepared.files,targets);
            for(int i=0;i<targets.size();i++){Bitmap image=BitmapFactory.decodeFile(targets.get(i).getPath());try{color(i==0?Color.RED:Color.BLUE,image.getPixel(20,10));}finally{image.recycle();}}
            byte[] previous=Files.readAllBytes(targets.get(0).toPath());
            try{FactoryFileAccess.copyBatchAtomic(Arrays.asList(prepared.files.get(0),new File(root,"missing")),targets);fail("Missing source must fail");}catch(IOException expected){}
            assertArrayEquals(previous,Files.readAllBytes(targets.get(0).toPath()));
        }finally{if(prepared!=null)prepared.clear();remove(root);}
    }
    @Test public void actualPdfUsesA4CenteredFiveHundredPointImagesAndFlowsToTheNextPage() throws Exception {
        File root=temporary();FactoryPageExport.Prepared prepared=null;
        try{
            byte[][] images={jpeg(Color.RED,40,20),jpeg(Color.BLUE,40,20),jpeg(Color.GREEN,20,40)};
            prepared=FactoryPageExport.prepare(stage(root,images),root,FactoryFileAccess.Kind.PDF,manifest(images,1,2,4),"白板记录");
            assertEquals(1,prepared.files.size());
            File target=new File(root,"课堂.pdf");FactoryFileAccess.copyBatchAtomic(prepared.files,Collections.singletonList(target));
            try(ParcelFileDescriptor descriptor=ParcelFileDescriptor.open(target,ParcelFileDescriptor.MODE_READ_ONLY);PdfRenderer pdf=new PdfRenderer(descriptor)){
                assertEquals(2,pdf.getPageCount());
                Bitmap raster=Bitmap.createBitmap(595,842,Bitmap.Config.ARGB_8888);
                try{
                    try(PdfRenderer.Page page=pdf.openPage(0)){assertEquals(595,page.getWidth());assertEquals(842,page.getHeight());raster.eraseColor(Color.WHITE);page.render(raster,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);}
                    color(Color.RED,raster.getPixel(300,200));color(Color.BLUE,raster.getPixel(300,450));color(Color.WHITE,raster.getPixel(15,200));
                    try(PdfRenderer.Page page=pdf.openPage(1)){raster.eraseColor(Color.WHITE);page.render(raster,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);}
                    color(Color.GREEN,raster.getPixel(300,200));color(Color.WHITE,raster.getPixel(100,200));
                }finally{raster.recycle();}
            }
        }finally{if(prepared!=null)prepared.clear();remove(root);}
    }
    @Test public void rejectsIncompleteManifestsAndInvalidPageImagesWithoutLeavingAnExport() throws Exception {
        File root=temporary();
        try{
            JSArray values=new JSArray();values.put(new JSObject().put("page",1).put("size",5));
            try{FactoryPageExport.manifest(values,6);fail("Incomplete manifest");}catch(IOException expected){}
            byte[][] images={new byte[]{1,2,3}};
            try{FactoryPageExport.prepare(stage(root,images),root,FactoryFileAccess.Kind.IMAGE,manifest(images,1),"Whiteboard Record");fail("Invalid image");}catch(IOException expected){}
            File[] children=root.listFiles();assertNotNull(children);assertEquals(1,children.length);assertEquals("staged",children[0].getName());
        }finally{remove(root);}
    }
}
