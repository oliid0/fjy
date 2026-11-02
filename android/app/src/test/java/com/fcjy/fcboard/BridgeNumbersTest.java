package com.fcjy.fcboard;

import static org.junit.Assert.*;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.junit.Test;

public class BridgeNumbersTest {
    @Test public void readsActualJsonIntegerSizesAndZeroOffsetsRejectedByCapacitorLongAccessor() throws Exception {
        JSObject json = new JSObject("{\"size\":7710,\"offset\":0,\"large\":3000000000,\"double\":262144.0}");
        PluginCall call = new PluginCall(null,"FcboardRecordingExport","test","begin",json);
        assertEquals(Long.valueOf(0),call.getLong("size",0L));
        assertEquals(7710,BridgeNumbers.integer(call.getData(),"size",0));
        assertEquals(0,BridgeNumbers.integer(call.getData(),"offset",-1));
        assertEquals(3000000000L,BridgeNumbers.integer(call.getData(),"large",0));
        assertEquals(262144,BridgeNumbers.integer(call.getData(),"double",0));
    }
    @Test public void refusesFractionsStringsBooleansAndUnsafeIntegersInsteadOfTruncatingFilePositions() throws Exception {
        JSObject json = new JSObject("{\"fraction\":1.5,\"text\":\"4\",\"flag\":true,\"unsafe\":9007199254740992}");
        for(String name:new String[]{"fraction","text","flag","unsafe"}) assertThrows(java.io.IOException.class,()->BridgeNumbers.integer(json,name,-1));
        assertEquals(-1,BridgeNumbers.integer(json,"missing",-1));
    }
}
