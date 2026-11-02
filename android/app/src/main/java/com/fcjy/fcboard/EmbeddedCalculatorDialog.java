package com.fcjy.fcboard;

import android.app.Activity;
import android.app.Dialog;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.pm.ApplicationInfo;
import android.content.res.AssetManager;
import android.content.res.Resources;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Handler;
import android.os.Looper;
import android.view.ContextThemeWrapper;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.TextView;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import dalvik.system.DexClassLoader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;

/** Runs the supplied calculator's actual DEX, XML and button listeners in this app's window. */
final class EmbeddedCalculatorDialog extends Dialog {
    private static final String PACKAGE = "com.bsd.bsdcalculator";
    private static final String SHA256 = "a9b9180ab4dcaa6bbdb9c8b9eb337f2636bdc36803d60ab4705fa171663fea5d";
    private final View content;
    private final Resources resources;
    private final Map<String, View> controls = new LinkedHashMap<>();
    private final Consumer<JSObject> changed;
    private final String session = UUID.randomUUID().toString();
    private final Handler main = new Handler(Looper.getMainLooper());
    private int revision;

    static final class Runtime {
        final Resources resources;
        final ClassLoader loader;
        Runtime(Resources resources, ClassLoader loader) { this.resources = resources; this.loader = loader; }
    }

    private static String digest(File file) throws Exception {
        MessageDigest hash = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new java.io.FileInputStream(file)) {
            byte[] bytes = new byte[32768];
            int count;
            while ((count = input.read(bytes)) != -1) hash.update(bytes, 0, count);
        }
        StringBuilder result = new StringBuilder();
        for (byte value : hash.digest()) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }

    /** IO runs off the UI thread. Only our pinned, packaged module can be loaded. */
    static Runtime prepare(Context context) throws Exception {
        File directory = new File(context.getCodeCacheDir(), "factory-calculator");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new java.io.IOException("无法准备原版计算器目录");
        File apk = new File(directory, SHA256 + ".apk");
        if (!apk.isFile() || !SHA256.equals(digest(apk))) {
            if (apk.exists() && !apk.delete()) throw new java.io.IOException("无法更新原版计算器");
            try (InputStream input = context.getAssets().open("factory/calculator-core.apk"); FileOutputStream output = new FileOutputStream(apk)) {
                // Android 14+: make the file read-only before writing through the already-open descriptor.
                if (!apk.setReadOnly()) throw new java.io.IOException("无法保护原版计算器模块");
                byte[] buffer = new byte[32768];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                output.getFD().sync();
            } catch (Exception error) { apk.delete(); throw error; }
            if (!SHA256.equals(digest(apk))) { apk.delete(); throw new java.io.IOException("原版计算器模块校验失败"); }
        }
        if (!apk.setReadOnly()) throw new java.io.IOException("无法保护原版计算器模块");
        ApplicationInfo info = new ApplicationInfo();
        info.packageName = PACKAGE;
        info.sourceDir = info.publicSourceDir = apk.getAbsolutePath();
        info.uid = android.os.Process.myUid();
        Resources resources = context.getPackageManager().getResourcesForApplication(info);
        ClassLoader loader = new DexClassLoader(apk.getAbsolutePath(), directory.getAbsolutePath(), null, context.getClassLoader());
        loader.loadClass(PACKAGE + ".CalculatorService");
        return new Runtime(resources, loader);
    }

    private static final class ModuleContext extends ContextThemeWrapper {
        final Runtime module;
        private LayoutInflater inflater;
        ModuleContext(Context host, Runtime module) {
            super(host, 0);
            this.module = module;
            setTheme(module.resources.getIdentifier("TestTheme", "style", PACKAGE));
        }
        @Override public Resources getResources() { return module == null ? super.getResources() : module.resources; }
        @Override public AssetManager getAssets() { return getResources().getAssets(); }
        @Override public ClassLoader getClassLoader() { return module.loader; }
        @Override public Context getApplicationContext() { return this; }
        @Override public Object getSystemService(String name) {
            if (Context.LAYOUT_INFLATER_SERVICE.equals(name)) {
                // Application inflater has no host AppCompat factory or resource IDs.
                if (inflater == null) inflater = LayoutInflater.from(getBaseContext().getApplicationContext()).cloneInContext(this);
                return inflater;
            }
            return super.getSystemService(name);
        }
    }

    EmbeddedCalculatorDialog(Activity activity, Runtime module, Consumer<JSObject> changed) throws Exception {
        super(activity);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        this.resources = module.resources;
        this.changed = changed;
        ModuleContext context = new ModuleContext(activity, module);
        Object calculator = module.loader.loadClass(PACKAGE + ".CalculatorService").getConstructor().newInstance();
        // ContextWrapper.attachBaseContext is a documented protected SDK method.
        // Do not call Service.onCreate: its window/firmware broadcasts are not part of calculator logic.
        Method attach = ContextWrapper.class.getDeclaredMethod("attachBaseContext", Context.class);
        attach.setAccessible(true);
        attach.invoke(calculator, context);
        content = (View) calculator.getClass().getMethod("init").invoke(calculator);
        setContentView(content);
        setCanceledOnTouchOutside(false);
        discover(content);
        View close = controls.get("off");
        if (close == null) throw new IllegalStateException("原版计算器缺少关闭按钮");
        close.setOnClickListener(view -> dismiss());
        setOnDismissListener(dialog -> publish());
        View title = content.findViewById(id("title"));
        title.setOnTouchListener(new View.OnTouchListener() {
            float x, y; int originX, originY;
            @Override public boolean onTouch(View view, MotionEvent event) {
                WindowManager.LayoutParams params = getWindow().getAttributes();
                if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                    x = event.getRawX(); y = event.getRawY(); originX = params.x; originY = params.y;
                } else if (event.getActionMasked() == MotionEvent.ACTION_MOVE) {
                    params.x = originX + Math.round(event.getRawX() - x);
                    params.y = originY + Math.round(event.getRawY() - y);
                    getWindow().setAttributes(params);
                }
                return true;
            }
        });
    }

    private int id(String name) { return resources.getIdentifier(name, "id", PACKAGE); }
    private String value(String name) { return ((TextView) content.findViewById(id(name))).getText().toString(); }
    private void discover(View view) {
        if (view.isClickable() && view.getId() != View.NO_ID) controls.put(resources.getResourceEntryName(view.getId()), view);
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) discover(((ViewGroup) view).getChildAt(i));
    }
    private void publish() { revision++; changed.accept(snapshot()); }

    @Override public void show() {
        super.show();
        Window window = getWindow();
        window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        window.setDimAmount(0);
        window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        window.addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL);
        window.setGravity(Gravity.CENTER);
        android.util.DisplayMetrics metrics = getContext().getResources().getDisplayMetrics();
        window.setLayout(Math.min(resources.getDimensionPixelSize(resources.getIdentifier("default_300dp", "dimen", PACKAGE)), metrics.widthPixels), Math.min(resources.getDimensionPixelSize(resources.getIdentifier("default_500dp", "dimen", PACKAGE)), metrics.heightPixels));
        publish();
    }
    @Override public boolean dispatchTouchEvent(MotionEvent event) {
        boolean handled = super.dispatchTouchEvent(event);
        if (event.getActionMasked() == MotionEvent.ACTION_UP) main.post(this::publish);
        return handled;
    }
    JSObject snapshot() {
        JSArray list = new JSArray();
        if (isShowing()) for (Map.Entry<String, View> entry : controls.entrySet()) {
            View view = entry.getValue();
            if (view.getVisibility() == View.VISIBLE) list.put(new JSObject().put("id", entry.getKey()).put("label", view instanceof TextView ? ((TextView) view).getText().toString() : entry.getKey()).put("enabled", view.isEnabled()));
        }
        return new JSObject().put("open", isShowing()).put("supported", true).put("embedded", true).put("version", session + ":" + revision).put("expression", value("result_edit_text")).put("result", value("final_result_val")).put("controls", list);
    }
    JSObject action(JSObject args) throws Exception {
        String action = args.getString("action", "read");
        if ("read".equals(action)) return snapshot();
        if (!isShowing()) throw new IllegalStateException("请先打开计算器");
        if (!snapshot().getString("version").equals(args.getString("version"))) throw new IllegalStateException("计算器状态已变化，请重新读取控件");
        if ("close".equals(action)) { dismiss(); return snapshot(); }
        org.json.JSONArray requested = args.optJSONArray("controls");
        if (!"press".equals(action) || requested == null || requested.length() == 0 || requested.length() > 64) throw new IllegalArgumentException("请选择实际计算器按钮，单批不超过64次");
        for (int i = 0; i < requested.length(); i++) {
            View view = controls.get(requested.getString(i));
            if (view == null || !view.isEnabled() || view.getVisibility() != View.VISIBLE) throw new IllegalArgumentException("计算器按钮不可用：" + requested.getString(i));
        }
        for (int i = 0; i < requested.length(); i++) {
            if (!isShowing()) throw new IllegalStateException("计算器已关闭，其余按钮未执行");
            if (!controls.get(requested.getString(i)).performClick()) throw new IllegalStateException("计算器按钮未执行");
        }
        publish();
        return snapshot();
    }
}
