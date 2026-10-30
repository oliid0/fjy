package com.fcjy.fcboard;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.*;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.ExecutorService;

/** FileBrowserPopu / layout_file_browser / HFileGridAdapter, on real Android storage. */
final class FactoryFileBrowserDialog extends Dialog {
    interface Operation { void apply(File file) throws Exception; default boolean exists(File file){return file.exists();} }
    interface Result { void finished(File file); }
    private final Activity activity;
    private final Context text;
    private final boolean saving;
    private final FactoryFileAccess.Kind kind;
    private final ExecutorService worker;
    private final ExecutorService thumbnails=java.util.concurrent.Executors.newSingleThreadExecutor();
    private final android.util.LruCache<String,android.graphics.Bitmap> thumbnailCache=new android.util.LruCache<String,android.graphics.Bitmap>(4*1024*1024){@Override protected int sizeOf(String key,android.graphics.Bitmap value){return value.getByteCount();}};
    private final Map<String,List<ImageView>> pendingThumbnails=new HashMap<>();
    private final Operation operation;
    private final Result result;
    final View panel;
    private final ScrollView viewport;
    private final GridView grid;
    private final TextView path;
    private final EditText name;
    private final TextView confirm, cancel;
    private final View usb;
    private final ArrayList<File> files = new ArrayList<>();
    private final File primaryRoot, initialFolder;
    private File root, directory, selected;
    private boolean volumes, busy, delivered, registered, refreshing, awaitingStorageAccess;
    private int generation;
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { refresh(); }
    };
    FactoryFileBrowserDialog(Activity activity, boolean saving, String language, ExecutorService worker, Operation operation, Result result) {
        this(activity,saving,language,worker,operation,result,FactoryFileAccess.Kind.BOARD);
    }
    FactoryFileBrowserDialog(Activity activity, boolean saving, String language, ExecutorService worker, Operation operation, Result result,FactoryFileAccess.Kind kind) {
        this(activity,saving,language,worker,operation,result,FactoryFileAccess.primary(),FactoryFileAccess.initial(kind),kind);
    }
    FactoryFileBrowserDialog(Activity activity, boolean saving, String language, ExecutorService worker, Operation operation, Result result, File primary, File initial) {
        this(activity,saving,language,worker,operation,result,primary,initial,FactoryFileAccess.Kind.BOARD);
    }
    FactoryFileBrowserDialog(Activity activity, boolean saving, String language, ExecutorService worker, Operation operation, Result result, File primary, File initial,FactoryFileAccess.Kind kind) {
        super(activity);
        this.activity=activity;this.saving=saving;this.worker=worker;this.operation=operation;this.result=result;this.kind=kind;
        primaryRoot=primary;initialFolder=initial;root=primary;directory=initial;
        android.content.res.Configuration locale=new android.content.res.Configuration(activity.getResources().getConfiguration());locale.setLocale(Locale.forLanguageTag(language));text=activity.createConfigurationContext(locale);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        View outer=LayoutInflater.from(text).inflate(R.layout.factory_file_browser,null);
        panel=((ViewGroup)outer).getChildAt(0);
        ((ViewGroup)outer).removeView(panel);
        viewport=new ScrollView(text);viewport.setFillViewport(false);viewport.setClipToPadding(false);viewport.setVerticalScrollBarEnabled(false);
        viewport.addView(panel,new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,dp(387)));
        RelativeLayout.LayoutParams position=new RelativeLayout.LayoutParams(dp(580),dp(387));position.addRule(RelativeLayout.CENTER_IN_PARENT);((ViewGroup)outer).addView(viewport,position);
        outer.setBackgroundColor(Color.argb(100,47,47,47));
        setContentView(outer);
        grid=panel.findViewById(R.id.factory_fb_file_path_grid);
        path=panel.findViewById(R.id.factory_fb_file_path);
        name=panel.findViewById(R.id.factory_fb_file_name);
        confirm=panel.findViewById(R.id.factory_fb_confirm);
        cancel=panel.findViewById(R.id.factory_fb_cancel);
        usb=panel.findViewById(R.id.factory_fb_usb_store_layout);
        ((TextView)panel.findViewById(R.id.factory_fb_title)).setText(saving?R.string.factory_fb_save_file:R.string.factory_fb_open_file);
        ((TextView)panel.findViewById(R.id.factory_fb_file_type)).setText(kind.label);
        panel.findViewById(R.id.factory_fb_file_save_layout).setVisibility(saving?View.VISIBLE:View.GONE);
        name.setText(new java.text.SimpleDateFormat("yyyyMMddHHmmss",Locale.getDefault()).format(new Date()));
        // Opening a browser does not request the keyboard; only a deliberate filename edit does.
        panel.setFocusableInTouchMode(true);panel.requestFocus();
        grid.setGravity(Gravity.CENTER);grid.setHorizontalSpacing(dp(5));grid.setVerticalSpacing(dp(5));
        grid.setStretchMode(GridView.STRETCH_SPACING_UNIFORM);
        grid.setAdapter(new BaseAdapter() {
            @Override public int getCount(){return files.size();}
            @Override public File getItem(int position){return files.get(position);}
            @Override public long getItemId(int position){return position;}
            @Override public View getView(int position,View recycled,ViewGroup parent){
                File file=getItem(position);
                FrameLayout slot=new FrameLayout(text);slot.setLayoutParams(new AbsListView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,dp(75)));
                LinearLayout cell=new LinearLayout(text);cell.setOrientation(LinearLayout.VERTICAL);cell.setGravity(Gravity.CENTER_HORIZONTAL);
                slot.addView(cell,new FrameLayout.LayoutParams(dp(60),dp(75),Gravity.TOP|Gravity.CENTER_HORIZONTAL));
                ImageView icon=new ImageView(text);icon.setImageResource(file.isDirectory()?R.drawable.factory_fb_ic_files:kind==FactoryFileAccess.Kind.PDF?R.drawable.factory_fb_pdf:kind==FactoryFileAccess.Kind.IMAGE?R.drawable.factory_fb_default_pic:R.drawable.factory_fb_ic_bzd_file);icon.setScaleType(ImageView.ScaleType.FIT_CENTER);
                if(!file.isDirectory() && kind==FactoryFileAccess.Kind.IMAGE)loadThumbnail(icon,file);
                cell.addView(icon,new LinearLayout.LayoutParams(dp(52),dp(48)));
                String caption=volumes?FactoryFileAccess.volumeLabel(activity,file):file.getName();
                TextView title=new TextView(text);title.setText(caption);title.setTextColor(Color.rgb(36,54,50));title.setTextSize(11);title.setGravity(Gravity.CENTER);title.setSingleLine();title.setEllipsize(android.text.TextUtils.TruncateAt.END);
                LinearLayout.LayoutParams label=new LinearLayout.LayoutParams(dp(58),dp(19));label.topMargin=dp(3);cell.addView(title,label);
                cell.setBackgroundResource(file.equals(selected)?R.drawable.factory_fb_fb_item_list_select:android.R.color.transparent);
                slot.setContentDescription(caption);slot.setSelected(file.equals(selected));return slot;
            }
        });
        grid.setOnItemClickListener((parent,view,index,id)->{
            if(busy || index>=files.size())return;
            File file=files.get(index);
            if(file.isDirectory()){
                if(volumes)root=file;
                volumes=false;directory=file;selected=null;refresh();
            }else{
                selected=file;
                int dot=file.getName().indexOf('.');name.setText(dot<0?file.getName():file.getName().substring(0,dot));
                ((BaseAdapter)grid.getAdapter()).notifyDataSetChanged();updateEnabled();
            }
        });
        panel.findViewById(R.id.factory_fb_back).setOnClickListener(view->{
            if(busy)return;
            try{
                if(volumes)return;
                if(directory.getCanonicalFile().equals(root.getCanonicalFile())){
                    if(!root.getCanonicalFile().equals(primaryRoot.getCanonicalFile()))volumes=true;
                }else if(directory.getParentFile()!=null)directory=directory.getParentFile();
                selected=null;refresh();
            }catch(IOException error){failure(error);}
        });
        panel.findViewById(R.id.factory_fb_local_store).setOnClickListener(view->{if(busy)return;volumes=false;root=primaryRoot;directory=initialFolder;selected=null;storageSelection(false);refresh();});
        panel.findViewById(R.id.factory_fb_usb_store).setOnClickListener(view->{if(busy)return;volumes=true;selected=null;storageSelection(true);refresh();});
        confirm.setOnClickListener(view->confirm());cancel.setOnClickListener(view->cancel());
        setOnCancelListener(ignored->deliver(null));
        setOnDismissListener(ignored->{generation++;thumbnails.shutdownNow();pendingThumbnails.clear();thumbnailCache.evictAll();if(registered){activity.unregisterReceiver(receiver);registered=false;}deliver(null);});
        Window window=getWindow();
        if(window!=null){window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE|WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);}
        panel.getViewTreeObserver().addOnGlobalLayoutListener(this::resize);
    }
    private int dp(int value){return Math.round(value*activity.getResources().getDisplayMetrics().density);}
    /** HFileGridAdapter's Glide thumbnails, decoded off the UI and file-operation workers. */
    private void loadThumbnail(ImageView icon,File file){
        String key=file.getAbsolutePath()+":"+file.lastModified()+":"+file.length();icon.setTag(key);
        android.graphics.Bitmap cached=thumbnailCache.get(key);if(cached!=null){icon.setImageBitmap(cached);return;}
        List<ImageView> waiting=pendingThumbnails.get(key);if(waiting!=null){waiting.add(icon);return;}
        if(thumbnails.isShutdown())return;
        waiting=new ArrayList<>();waiting.add(icon);pendingThumbnails.put(key,waiting);
        int size=dp(96);
        thumbnails.execute(()->{
            android.graphics.Bitmap bitmap=null;
            try{
                android.graphics.BitmapFactory.Options options=new android.graphics.BitmapFactory.Options();options.inJustDecodeBounds=true;
                android.graphics.BitmapFactory.decodeFile(file.getAbsolutePath(),options);
                if(options.outWidth>0 && options.outHeight>0){
                    int sample=1;while(Math.max(options.outWidth,options.outHeight)/(sample*2)>=size)sample*=2;
                    options.inSampleSize=sample;options.inJustDecodeBounds=false;
                    bitmap=android.graphics.BitmapFactory.decodeFile(file.getAbsolutePath(),options);
                }
            }catch(RuntimeException unavailable){}
            android.graphics.Bitmap decoded=bitmap;
            activity.runOnUiThread(()->{
                List<ImageView> views=pendingThumbnails.remove(key);
                if(!isShowing() || decoded==null)return;
                thumbnailCache.put(key,decoded);
                if(views!=null)for(ImageView view:views)if(key.equals(view.getTag()))view.setImageBitmap(decoded);
            });
        });
    }
    private void resize(){
        Window window=getWindow();if(window==null)return;
        Rect visible=new Rect();window.getDecorView().getWindowVisibleDisplayFrame(visible);
        if(visible.width()<1 || visible.height()<1)return;
        int width=Math.min(dp(580),Math.max(1,visible.width()-dp(24)));
        int height=Math.min(dp(387),Math.max(1,visible.height()-dp(24)));
        ViewGroup.LayoutParams viewportSize=viewport.getLayoutParams();
        if(viewportSize.width!=width || viewportSize.height!=height){viewportSize.width=width;viewportSize.height=height;viewport.setLayoutParams(viewportSize);}
        int contentHeight=Math.max(dp(saving?147:124),height);
        ViewGroup.LayoutParams panelSize=panel.getLayoutParams();
        if(panelSize.height!=contentHeight){panelSize.height=contentHeight;panel.setLayoutParams(panelSize);}
        boolean compact=height<dp(280) || width<dp(500);
        View footer=(View)confirm.getParent();ViewGroup.LayoutParams footerSize=footer.getLayoutParams();int footerHeight=dp(compact?(saving?73:50):99);
        if(footerSize.height!=footerHeight){footerSize.height=footerHeight;footer.setLayoutParams(footerSize);}
        panel.findViewById(R.id.factory_fb_file_type_label).setVisibility(compact?View.GONE:View.VISIBLE);
        panel.findViewById(R.id.factory_fb_file_type).setVisibility(compact?View.GONE:View.VISIBLE);
        grid.setNumColumns(Math.max(1,Math.min(6,(width-dp(127+24))/dp(65))));
        int fieldWidth=Math.max(dp(44),Math.min(dp(154),width-dp(127+96)));
        for(int id:new int[]{R.id.factory_fb_file_name,R.id.factory_fb_file_type}){
            View input=panel.findViewById(id);ViewGroup.LayoutParams layout=input.getLayoutParams();
            if(layout.width!=fieldWidth){layout.width=fieldWidth;input.setLayoutParams(layout);}
        }
    }
    @Override protected void onStart(){
        super.onStart();if(getWindow()!=null)getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.MATCH_PARENT);resize();
        IntentFilter filter=new IntentFilter();filter.addAction(Intent.ACTION_MEDIA_MOUNTED);filter.addAction(Intent.ACTION_MEDIA_UNMOUNTED);filter.addAction(Intent.ACTION_MEDIA_REMOVED);filter.addDataScheme("file");
        if(Build.VERSION.SDK_INT>=33)activity.registerReceiver(receiver,filter,Context.RECEIVER_NOT_EXPORTED);else activity.registerReceiver(receiver,filter);
        registered=true;refresh();
    }
    @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(focus && awaitingStorageAccess && grid!=null){awaitingStorageAccess=false;refresh();}}
    private void storageSelection(boolean removable){
        panel.findViewById(R.id.factory_fb_local_store).setBackgroundResource(removable?R.drawable.factory_fb_file_browser_storage_normal:R.drawable.factory_fb_file_browser_storage_selected);
        panel.findViewById(R.id.factory_fb_usb_store).setBackgroundResource(removable?R.drawable.factory_fb_file_browser_storage_selected:R.drawable.factory_fb_file_browser_storage_normal);
    }
    private void refresh(){
        if(busy || !isShowing() || worker.isShutdown())return;
        if(refreshing){generation++;return;}
        refreshing=true;updateEnabled();int request=++generation;File current=directory,base=root;boolean showVolumes=volumes;
        worker.execute(()->{
            List<File> mounted=FactoryFileAccess.removable(activity);List<File> found=null;Exception problem=null;
            try{
                if(!showVolumes && current.equals(initialFolder) && !current.isDirectory() && !current.mkdirs())throw new IOException("Cannot create Whiteboard/xml");
                found=showVolumes?mounted:FactoryFileAccess.list(base,current,kind);
            }catch(Exception error){problem=error;}
            List<File> result=found;Exception error=problem;
            activity.runOnUiThread(()->{
                refreshing=false;if(!isShowing())return;if(request!=generation){refresh();return;}
                usb.setVisibility(mounted.isEmpty()?View.GONE:View.VISIBLE);
                if((showVolumes || !base.equals(primaryRoot)) && mounted.isEmpty()){
                    volumes=false;root=primaryRoot;directory=initialFolder;selected=null;storageSelection(false);refresh();return;
                }
                path.setText(showVolumes?"/storage":current.getAbsolutePath());files.clear();if(result!=null)files.addAll(result);
                if(selected!=null && !files.contains(selected))selected=null;
                ((BaseAdapter)grid.getAdapter()).notifyDataSetChanged();updateEnabled();
                if(error!=null)failure(error,true);
            });
        });
    }
    private void updateEnabled(){confirm.setEnabled(!busy && !refreshing && (saving?!volumes:selected!=null));cancel.setEnabled(!busy);grid.setEnabled(!busy && !refreshing);name.setEnabled(!busy);setCancelable(!busy);}
    private void confirm(){
        if(busy || refreshing)return;
        try{
            if(saving && name.getText().toString().trim().isEmpty()){name.setError(text.getString(R.string.factory_fb_filename_required));return;}
            File target=saving?FactoryFileAccess.destination(root,directory,name.getText().toString(),kind):selected;
            if(target==null)return;
            if(saving && operation.exists(target))new AlertDialog.Builder(activity).setMessage(text.getString(R.string.factory_fb_replace)).setNegativeButton(text.getString(R.string.factory_fb_btn_cancle),null).setPositiveButton(text.getString(R.string.factory_fb_btn_ok),(dialog,which)->commit(target)).show();else commit(target);
        }catch(Exception error){failure(error);}
    }
    private void commit(File target){
        busy=true;updateEnabled();worker.execute(()->{
            try{operation.apply(target);activity.runOnUiThread(()->{busy=false;deliver(target);dismiss();});}
            catch(Exception error){activity.runOnUiThread(()->{busy=false;updateEnabled();failure(error);});}
        });
    }
    private void deliver(File file){if(!delivered){delivered=true;result.finished(file);}}
    boolean cancelIdle(){if(busy)return false;cancel();return true;}
    private void failure(Exception error){failure(error,false);}
    private void failure(Exception error,boolean storageAccess){
        if(storageAccess && Build.VERSION.SDK_INT>=30 && !Environment.isExternalStorageManager()){
            new AlertDialog.Builder(activity).setMessage(text.getString(R.string.factory_fb_failed)).setNegativeButton(text.getString(R.string.factory_fb_btn_cancle),null).setPositiveButton(text.getString(R.string.factory_fb_access),(dialog,which)->{
                try{awaitingStorageAccess=true;activity.startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,Uri.parse("package:"+activity.getPackageName())));}catch(RuntimeException unavailable){awaitingStorageAccess=false;Toast.makeText(activity,text.getString(R.string.factory_fb_failed),Toast.LENGTH_LONG).show();}
            }).show();
        }else Toast.makeText(activity,text.getString(R.string.factory_fb_failed)+"\n"+error.getMessage(),Toast.LENGTH_LONG).show();
    }
}
