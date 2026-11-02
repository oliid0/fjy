package com.fcjy.fcboard;

import static org.junit.Assert.*;
import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.matcher.RootMatchers.isDialog;
import static androidx.test.espresso.matcher.ViewMatchers.withId;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.SdkSuppress;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.lang.reflect.Field;
import java.util.Arrays;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Actual production menu/bridge → bundled APK resources/DEX → original listeners. */
@RunWith(AndroidJUnit4.class)
@SdkSuppress(minSdkVersion=28)
public class EmbeddedCalculatorTest {
    private MainActivity activity;
    private android.webkit.WebView web;
    private <T> T main(Callable<T> task) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<T> result = new AtomicReference<>();
        AtomicReference<Throwable> error = new AtomicReference<>();
        new Handler(Looper.getMainLooper()).post(() -> {
            try { result.set(task.call()); } catch (Throwable failure) { error.set(failure); } finally { done.countDown(); }
        });
        assertTrue("Native calculator task must complete", done.await(5,TimeUnit.SECONDS));
        if (error.get() != null) throw new AssertionError(error.get());
        return result.get();
    }
    private String evaluate(String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1); AtomicReference<String> result = new AtomicReference<>();
        new Handler(Looper.getMainLooper()).post(() -> web.evaluateJavascript(script, value -> { result.set(value); done.countDown(); }));
        assertTrue(done.await(5,TimeUnit.SECONDS)); return result.get();
    }
    private void until(String script) throws Exception {
        for (int attempt=0;attempt<100;attempt++) { if ("true".equals(evaluate(script))) return; Thread.sleep(150); }
        fail("Calculator UI not ready: " + script + "; " + evaluate("document.body.innerText.slice(-2000)"));
    }
    private EmbeddedCalculatorDialog calculator() throws Exception {
        ClassroomPlugin plugin = (ClassroomPlugin) activity.getBridge().getPlugin("FcboardClassroom").getInstance();
        Field field = ClassroomPlugin.class.getDeclaredField("calculator"); field.setAccessible(true);
        return (EmbeddedCalculatorDialog) field.get(plugin);
    }
    @Test public void originalCalculatorRunsWithoutInstalledVendorPackageAndAgentClicksTheSameButtons() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(value -> { activity = value; web = value.getBridge().getWebView(); });
            assertNull(activity.getPackageManager().getLaunchIntentForPackage("com.bsd.bsdcalculator"));
            until("!!document.querySelector('[data-teaching-tools]')");
            evaluate("window.__fcCalculatorReload=true;localStorage.setItem('fcboard-language','zh-CN');location.reload();true");
            until("!window.__fcCalculatorReload&&!!document.querySelector('[data-teaching-tools]')");
            evaluate("document.querySelector('[data-teaching-tools]').click();true");
            String button = "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='计算器')";
            until("!!("+button+")"); evaluate(button+".click();true");
            for (int attempt=0;attempt<100;attempt++) {
                if (main(() -> calculator()!=null && calculator().isShowing())) break;
                Thread.sleep(150);
            }
            EmbeddedCalculatorDialog dialog = main(this::calculator);
            assertNotNull("The actual bundled dialog must open",dialog);
            assertTrue(main(dialog::isShowing));
            try {
                View root = main(() -> ((ViewGroup) dialog.findViewById(android.R.id.content)).getChildAt(0));
                int edit = root.getResources().getIdentifier("result_edit_text","id","com.bsd.bsdcalculator");
                assertEquals("com.bsd.bsdcalculator.view.AutoAdjustSizeEditText",main(() -> root.findViewById(edit).getClass().getName()));
                assertTrue(main(() -> root.findViewById(edit).getClass().getClassLoader() instanceof dalvik.system.DexClassLoader));
                String initialVersion = main(dialog::snapshot).getString("version");
                for (String name : Arrays.asList("btn_num0","btn_decimal_point","btn_num1","btn_addition","btn_num0","btn_decimal_point","btn_num2","btn_equal")) {
                    int id = root.getResources().getIdentifier(name,"id","com.bsd.bsdcalculator");
                    onView(withId(id)).inRoot(isDialog()).perform(click());
                }
                JSObject manual = main(dialog::snapshot);
                assertEquals("0.3",manual.getString("result"));
                assertNotEquals(initialVersion,manual.getString("version"));
                JSArray keys = new JSArray(Arrays.asList("btn_clear","btn_num9","btn_multiplication","btn_num3","btn_equal"));
                JSObject automated = main(() -> dialog.action(new JSObject().put("action","press").put("version",manual.getString("version")).put("controls",keys)));
                assertEquals("27",automated.getString("result"));
                assertTrue(automated.getJSONArray("controls").length()>20);
                boolean stale = main(() -> {
                    try { dialog.action(new JSObject().put("action","press").put("version",initialVersion).put("controls",keys)); return false; }
                    catch (IllegalStateException expected) { return true; }
                });
                assertTrue("Stale agent controls must not repeat the calculation",stale);
                assertEquals("27",main(dialog::snapshot).getString("result"));
            } finally { main(() -> { dialog.dismiss(); return null; }); }
        }
    }
}
