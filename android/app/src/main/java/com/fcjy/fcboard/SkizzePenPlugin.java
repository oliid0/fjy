package com.fcjy.fcboard;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.function.Consumer;

@CapacitorPlugin(name = "FcboardSkizzePen")
public class SkizzePenPlugin extends Plugin {
    private final Consumer<JSObject> listener = event -> notifyListeners("input", event);
    private final BroadcastReceiver attached = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
            if (SkizzeUsb.matches(device)) start();
        }
    };
    @Override public void load() {
        SkizzePenService.listen(listener);
        ContextCompat.registerReceiver(getContext(), attached,
            new IntentFilter(UsbManager.ACTION_USB_DEVICE_ATTACHED), ContextCompat.RECEIVER_NOT_EXPORTED);
    }
    private void start() {
        if (!SkizzeUsb.available(getContext())) return;
        try { ContextCompat.startForegroundService(getContext(), new Intent(getContext(), SkizzePenService.class)); }
        catch (RuntimeException error) { SkizzePenService.failure(error.toString()); }
    }
    @PluginMethod public void connect(PluginCall call) { getActivity().runOnUiThread(() -> { start(); call.resolve(SkizzePenService.snapshot()); }); }
    @Override protected void handleOnDestroy() {
        SkizzePenService.unlisten(listener);
        getContext().unregisterReceiver(attached);
    }
}
