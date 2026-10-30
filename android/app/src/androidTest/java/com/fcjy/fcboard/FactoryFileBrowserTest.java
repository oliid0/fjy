package com.fcjy.fcboard;

import static org.junit.Assert.*;
import android.widget.EditText;
import android.widget.GridView;
import android.view.View;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class FactoryFileBrowserTest {
    private File temporary() throws IOException {
        File root=Files.createTempDirectory(InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir().toPath(),"factory-files-").toFile();
        root.deleteOnExit();return root;
    }
    private void write(File file,String text) throws IOException {try(FileOutputStream out=new FileOutputStream(file)){out.write(text.getBytes(StandardCharsets.UTF_8));}}
    private void remove(File file){if(file.isDirectory()){File[] children=file.listFiles();if(children!=null)for(File child:children)remove(child);}file.delete();}
    @Test public void listsActualBoardFilesAndDirectoriesAndRejectsTraversal() throws Exception {
        File root=temporary();
        try{
            File folder=new File(root,"课堂");assertTrue(folder.mkdir());
            File board=new File(root,"力学.bzd");write(board,"<bzd/>");
            write(new File(root,"unrelated.txt"),"not a whiteboard");
            List<File> listed=FactoryFileAccess.list(root,root);
            assertEquals(2,listed.size());assertTrue(listed.contains(board));assertTrue(listed.contains(folder));
            for(String invalid:new String[]{"", "..", "../outside", "nested/name", "nested\\name"}){
                try{FactoryFileAccess.destination(root,folder,invalid);fail("Invalid name must fail");}catch(IOException expected){}
            }
            assertEquals(new File(folder,"牛顿.bzd"),FactoryFileAccess.destination(root,folder," 牛顿 "));
            assertFalse(FactoryFileAccess.contains(root,new File(root.getParentFile(),root.getName()+"-other")));
        }finally{remove(root);}
    }
    @Test public void atomicallySavesTheRealFileAndRetainsAnExistingTargetWhenTheInputExceedsTheLimit() throws Exception {
        File root=temporary();
        try{
            File source=new File(root,"source.bzd"),target=new File(root,"target.bzd");
            write(source,"<bzd><slide name='牛顿'/></bzd>");write(target,"previous");
            FactoryFileAccess.copyAtomic(source,target);
            assertEquals("bzd",BoardFilePlugin.readXml(target).getDocumentElement().getTagName());
            byte[] previous=Files.readAllBytes(target.toPath());
            try(RandomAccessFile huge=new RandomAccessFile(source,"rw")){huge.setLength(FactoryFileAccess.MAX_BYTES+1);}
            try{FactoryFileAccess.copyAtomic(source,target);fail("Oversize input must fail");}catch(IOException expected){}
            assertArrayEquals(previous,Files.readAllBytes(target.toPath()));
            write(source,"new content");File directoryTarget=new File(root,"existing-folder.bzd");assertTrue(directoryTarget.mkdir());
            try{FactoryFileAccess.copyAtomic(source,directoryTarget);fail("A directory cannot be overwritten as a file");}catch(IOException expected){}
            assertTrue(directoryTarget.isDirectory());
        }finally{remove(root);}
    }
    @Test public void originalGridSelectsAndConfirmsARealFileAndAdaptsToTheActivityWindow() throws Exception {
        File root=temporary(),initial=new File(root,"Whiteboard/xml");assertTrue(initial.mkdirs());
        File board=new File(initial,"课堂.bzd");write(board,"<bzd><slide name='课堂'/></bzd>");
        ExecutorService worker=Executors.newSingleThreadExecutor();
        AtomicReference<FactoryFileBrowserDialog> ref=new AtomicReference<>();
        AtomicReference<File> selected=new AtomicReference<>();CountDownLatch done=new CountDownLatch(1);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            scenario.onActivity(activity->{FactoryFileBrowserDialog browser=new FactoryFileBrowserDialog(activity,false,"en",worker,file->{BoardFilePlugin.readXml(file);},file->{selected.set(file);done.countDown();},root,initial);ref.set(browser);browser.show();});
            boolean ready=false;
            for(int attempt=0;attempt<40 && !ready;attempt++){
                AtomicReference<Boolean> loaded=new AtomicReference<>(false);
                scenario.onActivity(activity->{GridView grid=ref.get().findViewById(R.id.factory_fb_file_path_grid);loaded.set(grid.getAdapter().getCount()==1 && grid.isEnabled() && grid.getWidth()>0);});
                ready=loaded.get();if(!ready)Thread.sleep(50);
            }
            assertTrue(ready);
            scenario.onActivity(activity->{
                FactoryFileBrowserDialog browser=ref.get();GridView grid=browser.findViewById(R.id.factory_fb_file_path_grid);
                assertTrue(grid.getNumColumns()>=1 && grid.getNumColumns()<=6);
                assertTrue(browser.getWindow().getAttributes().width<=activity.getResources().getDisplayMetrics().widthPixels);
                assertTrue(browser.panel.getWidth()<=activity.getResources().getDisplayMetrics().widthPixels);
                assertEquals(View.GONE,browser.findViewById(R.id.factory_fb_file_save_layout).getVisibility());
                assertFalse(browser.findViewById(R.id.factory_fb_file_name).hasFocus());
                assertFalse(browser.findViewById(R.id.factory_fb_confirm).isEnabled());
                grid.performItemClick(grid.getChildAt(0),0,0);
                assertTrue(browser.findViewById(R.id.factory_fb_confirm).isEnabled());browser.findViewById(R.id.factory_fb_confirm).performClick();
            });
            assertTrue(done.await(5,TimeUnit.SECONDS));assertEquals(board,selected.get());
        }finally{if(ref.get()!=null)InstrumentationRegistry.getInstrumentation().runOnMainSync(()->ref.get().dismiss());worker.shutdownNow();remove(root);}
    }
    @Test public void originalSaveUsesAnEditableTimestampNameAndReportsOnlyAfterTheFileIsWritten() throws Exception {
        File root=temporary(),initial=new File(root,"Whiteboard/xml");assertTrue(initial.mkdirs());
        File staged=new File(root,"staged.bzd");write(staged,"<bzd><slide name='原版'/></bzd>");
        ExecutorService worker=Executors.newSingleThreadExecutor();
        AtomicReference<FactoryFileBrowserDialog> ref=new AtomicReference<>();AtomicReference<File> saved=new AtomicReference<>();CountDownLatch done=new CountDownLatch(1);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            scenario.onActivity(activity->{FactoryFileBrowserDialog browser=new FactoryFileBrowserDialog(activity,true,"en",worker,file->FactoryFileAccess.copyAtomic(staged,file),file->{saved.set(file);done.countDown();},root,initial);ref.set(browser);browser.show();});
            boolean ready=false;
            for(int attempt=0;attempt<40 && !ready;attempt++){
                AtomicReference<Boolean> enabled=new AtomicReference<>(false);scenario.onActivity(activity->enabled.set(ref.get().findViewById(R.id.factory_fb_confirm).isEnabled()));ready=enabled.get();if(!ready)Thread.sleep(50);
            }
            assertTrue(ready);
            scenario.onActivity(activity->{EditText name=ref.get().findViewById(R.id.factory_fb_file_name);assertTrue(name.getText().toString().matches("\\d{14}"));name.setText("保存课件");ref.get().findViewById(R.id.factory_fb_confirm).performClick();});
            assertTrue(done.await(5,TimeUnit.SECONDS));assertEquals(new File(initial,"保存课件.bzd"),saved.get());
            assertEquals("bzd",BoardFilePlugin.readXml(saved.get()).getDocumentElement().getTagName());
        }finally{if(ref.get()!=null)InstrumentationRegistry.getInstrumentation().runOnMainSync(()->ref.get().dismiss());worker.shutdownNow();remove(root);}
    }
    @Test public void imageModeShowsTheActualThumbnailAndSelectsOnlyTheRequestedFileType() throws Exception {
        File root=temporary(),initial=new File(root,"Whiteboard/image");assertTrue(initial.mkdirs());
        File picture=new File(initial,"课堂.png");android.graphics.Bitmap pixels=android.graphics.Bitmap.createBitmap(20,10,android.graphics.Bitmap.Config.ARGB_8888);
        try{pixels.eraseColor(android.graphics.Color.RED);Files.write(picture.toPath(),BzdBitmap.png(pixels));}finally{pixels.recycle();}
        write(new File(initial,"board.bzd"),"<bzd/>");write(new File(initial,"document.pdf"),"not an image");
        ExecutorService worker=Executors.newSingleThreadExecutor();AtomicReference<FactoryFileBrowserDialog> ref=new AtomicReference<>();AtomicReference<File> selected=new AtomicReference<>();CountDownLatch done=new CountDownLatch(1);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            scenario.onActivity(activity->{FactoryFileBrowserDialog browser=new FactoryFileBrowserDialog(activity,false,"en",worker,file->{assertEquals(picture,file);},file->{selected.set(file);done.countDown();},root,initial,FactoryFileAccess.Kind.IMAGE);ref.set(browser);browser.show();});
            boolean ready=false;
            for(int attempt=0;attempt<60 && !ready;attempt++){
                AtomicReference<Boolean> loaded=new AtomicReference<>(false);scenario.onActivity(activity->{GridView grid=ref.get().findViewById(R.id.factory_fb_file_path_grid);if(grid.getAdapter().getCount()==1 && grid.getChildCount()==1){android.view.ViewGroup slot=(android.view.ViewGroup)grid.getChildAt(0);android.view.ViewGroup cell=(android.view.ViewGroup)slot.getChildAt(0);android.graphics.drawable.Drawable drawable=((android.widget.ImageView)cell.getChildAt(0)).getDrawable();if(drawable instanceof android.graphics.drawable.BitmapDrawable){android.graphics.Bitmap image=((android.graphics.drawable.BitmapDrawable)drawable).getBitmap();loaded.set(image.getWidth()==20 && image.getHeight()==10 && image.getPixel(10,5)==android.graphics.Color.RED);}}});ready=loaded.get();if(!ready)Thread.sleep(50);
            }
            assertTrue(ready);
            scenario.onActivity(activity->{GridView grid=ref.get().findViewById(R.id.factory_fb_file_path_grid);grid.performItemClick(grid.getChildAt(0),0,0);ref.get().findViewById(R.id.factory_fb_confirm).performClick();});
            assertTrue(done.await(5,TimeUnit.SECONDS));assertEquals(picture,selected.get());
        }finally{if(ref.get()!=null)InstrumentationRegistry.getInstrumentation().runOnMainSync(()->ref.get().dismiss());worker.shutdownNow();remove(root);}
    }
}
