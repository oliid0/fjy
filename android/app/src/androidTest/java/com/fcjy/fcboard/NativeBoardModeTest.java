package com.fcjy.fcboard;

import android.content.ContentResolver;
import android.content.ContextWrapper;
import android.content.Intent;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class NativeBoardModeTest {
    @Test public void mappedBoardProtocolWorksWithoutAProviderAndRestoresOnlyOwnedHardware() {
        for (int customer : new int[]{0, 14}) {
            List<Intent> broadcasts = new ArrayList<>();
            ContextWrapper context = new ContextWrapper(InstrumentationRegistry.getInstrumentation().getTargetContext()) {
                @Override public ContentResolver getContentResolver() { throw new UnsupportedOperationException("No vendor provider"); }
                @Override public void sendBroadcast(Intent intent) { broadcasts.add(intent); }
            };
            NativeBoardMode mode = new NativeBoardMode(context, () -> customer);
            mode.foreground(true); mode.foreground(true);
            mode.foreground(false); mode.foreground(false);
            if (customer == 0) { assertTrue(broadcasts.isEmpty()); continue; }
            assertEquals(4, broadcasts.size());
            assertEquals("broadcast.beststar.action.setCommand", broadcasts.get(0).getAction());
            assertEquals("SetDoubleScreen", broadcasts.get(0).getStringExtra("command"));
            assertEquals("broadcast.navigation.touch_off", broadcasts.get(1).getAction());
            assertEquals("SetSingleScreen", broadcasts.get(2).getStringExtra("command"));
            assertEquals("broadcast.navigation.touch_on", broadcasts.get(3).getAction());
            mode.foreground(true); mode.foreground(false);
            assertEquals(8, broadcasts.size());
        }
    }
}
