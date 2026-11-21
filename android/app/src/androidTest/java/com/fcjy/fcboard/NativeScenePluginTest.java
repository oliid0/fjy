package com.fcjy.fcboard;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real bridge teardown: late WebView disposal must not restart native work. */
@RunWith(AndroidJUnit4.class)
public class NativeScenePluginTest {
    @Test public void lateSceneRemovalAfterDestroyIsIdempotentAndNewFramesAreRejected() {
        AtomicInteger removals=new AtomicInteger();AtomicReference<String> rejected=new AtomicReference<>();
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            try {
                InstrumentationRegistry.getInstrumentation().runOnMainSync(()->scenario.onActivity(activity->{
                    NativeScenePlugin plugin=(NativeScenePlugin)activity.getBridge().getPlugin("FcboardNativeScene").getInstance();
                    plugin.handleOnDestroy();
                    for(int i=0;i<2;i++)plugin.remove(new PluginCall(null,"FcboardNativeScene","late","remove",new JSObject()){
                        @Override public void resolve(){removals.incrementAndGet();}
                    });
                    plugin.synchronize(new PluginCall(null,"FcboardNativeScene","late","synchronize",new JSObject()){
                        @Override public void reject(String message,String code,Exception error,JSObject data){rejected.set(message);}
                    });
                    plugin.handleOnDestroy();
                }));
                assertEquals(2,removals.get());assertEquals("Native scene closed",rejected.get());
            } finally {
                InstrumentationRegistry.getInstrumentation().runOnMainSync(()->scenario.onActivity(MainActivity::finish));
            }
        }
    }
}
