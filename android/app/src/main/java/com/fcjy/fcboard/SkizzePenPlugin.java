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
    private final java.util.concurrent.ExecutorService discovery = java.util.concurrent.Executors.newSingleThreadExecutor(
        task -> new Thread(task, "usb-pen-discovery"));
    private volatile boolean closed;
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
        if (closed) return;
        try { ContextCompat.startForegroundService(getContext(), new Intent(getContext(), SkizzePenService.class)); }
        catch (RuntimeException error) { SkizzePenService.failure(error.toString()); }
    }
    @PluginMethod public void connect(PluginCall call) {
        discovery.execute(() -> {
            try {
                if (SkizzeUsb.available(getContext())) start();
                call.resolve(SkizzePenService.snapshot());
            } catch (RuntimeException unavailable) { call.reject("USB pen discovery unavailable", unavailable); }
        });
    }
    @Override protected void handleOnDestroy() {
        closed = true;
        discovery.shutdownNow();
        SkizzePenService.unlisten(listener);
        getContext().unregisterReceiver(attached);
    }
}
