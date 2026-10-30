package com.fcjy.fcboard;

import android.app.Instrumentation;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.view.KeyEvent;
import com.getcapacitor.JSObject;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/** SkizzeService's real hardware actions stay alive while the USB receiver is attached. */
public class SkizzePenService extends Service implements SkizzeUsb.Listener {
    private static final CopyOnWriteArraySet<Consumer<JSObject>> listeners = new CopyOnWriteArraySet<>();
    private static volatile JSObject current = status(false, null, "");
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService keys = Executors.newSingleThreadExecutor();
    private final Map<String, SkizzeButtons> buttons = new HashMap<>();
    private final Map<String, Integer> batteries = new HashMap<>();
    private SkizzeUsb usb;
    private boolean destroyed;

    static void listen(Consumer<JSObject> listener) { listeners.add(listener); }
    static void unlisten(Consumer<JSObject> listener) { listeners.remove(listener); }
    static JSObject snapshot() { return current; }
    static void failure(String error) { publish(status(false, null, error)); }
    private static JSObject status(boolean connected, Integer battery, String error) {
        JSObject state = new JSObject();
        state.put("kind", "state"); state.put("connected", connected);
        if (battery != null) state.put("battery", battery);
        state.put("error", error);
        return state;
    }
    private static void publish(JSObject event) {
        if ("state".equals(event.optString("kind"))) current = event;
        for (Consumer<JSObject> listener : listeners) listener.accept(event);
    }
    private void input(String kind) {
        if (destroyed) return;
        JSObject event = new JSObject(); event.put("kind", kind); publish(event);
    }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "stop".equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        if (usb != null) return START_NOT_STICKY;
        try {
            NotificationManager notifications = getSystemService(NotificationManager.class);
            String channel = "fcboard-skizze";
            notifications.createNotificationChannel(new NotificationChannel(channel, getString(R.string.skizze_channel), NotificationManager.IMPORTANCE_LOW));
            PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, SkizzePenService.class).setAction("stop"), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification notification = new Notification.Builder(this, channel)
                .setSmallIcon(android.R.drawable.ic_menu_edit).setContentTitle(getString(R.string.skizze_channel))
                .setContentText(getString(R.string.skizze_active)).setContentIntent(open).setOngoing(true)
                .addAction(new Notification.Action.Builder(null, getString(R.string.skizze_stop), stop).build()).build();
            if (Build.VERSION.SDK_INT >= 29) startForeground(49, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
            else startForeground(49, notification);
            usb = new SkizzeUsb(this, this);
        } catch (RuntimeException error) { failure(error.toString()); stopSelf(); }
        return START_NOT_STICKY;
    }
    @Override public void state(String device, boolean connected, Integer battery, String error) {
        if (destroyed) return;
        if (connected) {
            batteries.put(device, battery);
            if (!buttons.containsKey(device)) {
                buttons.put(device, new SkizzeButtons(new SkizzeButtons.Timer() {
                    public void after(Runnable task, long delay) { main.postDelayed(task, delay); }
                    public void cancel(Runnable task) { main.removeCallbacks(task); }
                }, this::click));
            }
        } else {
            batteries.remove(device);
            SkizzeButtons old = buttons.remove(device);
            if (old != null) old.close();
        }
        Integer level = batteries.values().stream().filter(value -> value != null).findFirst().orElse(null);
        publish(status(!batteries.isEmpty(), level, error));
    }
    @Override public void packet(String device, SkizzeProtocol.Packet packet) {
        SkizzeButtons input = buttons.get(device);
        if (input == null || destroyed) return;
        if (packet.type == 3) input.raw(packet.data[0] & 255);
        else if (packet.type == 8) input.sensory(packet.data[0] & 255, packet.data[1] & 255);
        else if (packet.type == 5) input("color");
    }
    @Override public void empty() { stopSelf(); }
    private void click(int button, boolean twice) {
        if (destroyed) return;
        if (button == 0) { if (twice) input("mode"); return; }
        if (button == 32 && !twice) {
            try {
                Intent target = MainActivity.isForeground()
                    ? new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                    : new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
                startActivity(target.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (RuntimeException error) { reportError(error); }
            return;
        }
        int code = button == 4 ? KeyEvent.KEYCODE_PAGE_DOWN : button == 8 ? KeyEvent.KEYCODE_PAGE_UP : KeyEvent.KEYCODE_SYSRQ;
        if (code != KeyEvent.KEYCODE_SYSRQ && MainActivity.isForeground()) {
            input(code == KeyEvent.KEYCODE_PAGE_DOWN ? "next" : "previous");
        } else {
            keys.execute(() -> {
                try { new Instrumentation().sendKeyDownUpSync(code); }
                catch (RuntimeException error) { main.post(() -> reportError(error)); }
            });
        }
    }
    private void reportError(RuntimeException error) {
        if (destroyed) return;
        Integer level = batteries.values().stream().filter(value -> value != null).findFirst().orElse(null);
        publish(status(!batteries.isEmpty(), level, error.toString()));
    }
    @Override public void onDestroy() {
        destroyed = true;
        if (usb != null) usb.close();
        for (SkizzeButtons input : buttons.values()) input.close();
        buttons.clear(); batteries.clear(); keys.shutdownNow();
        main.removeCallbacksAndMessages(null);
        publish(status(false, null, ""));
        super.onDestroy();
    }
}
