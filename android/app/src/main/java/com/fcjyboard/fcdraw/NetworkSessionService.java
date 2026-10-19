package com.fcjy.fcboard;

import android.app.Service;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Notification;
import android.content.Intent;
import android.os.IBinder;
import android.os.Build;

/** Keep the paired control transport alive when teaching from other applications. */
public class NetworkSessionService extends Service {
    static volatile Runnable stopSession;
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "stop".equals(intent.getAction())) {
            Runnable stop = stopSession; stopSession = null;
            if (stop != null) new Thread(stop, "Fcboard-end-session").start();
            stopSelf(); return START_NOT_STICKY;
        }
        NotificationManager notifications = getSystemService(NotificationManager.class);
        String channel = "fcboard-network";
        notifications.createNotificationChannel(new NotificationChannel(channel, "局域网协作与设备控制", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, NetworkSessionService.class).setAction("stop"), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new Notification.Builder(this, channel)
            .setSmallIcon(android.R.drawable.ic_menu_share).setContentTitle("· 局域网会话")
            .setContentText("协作或设备控制已开启，点击返回白板")
            .setOngoing(true).setContentIntent(open).addAction(new Notification.Action.Builder(null, "结束会话", stop).build()).build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(48, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        else startForeground(48, notification);
        return START_NOT_STICKY;
    }
    @Override public void onDestroy() {
        Runnable stop = stopSession; stopSession = null;
        if (stop != null) new Thread(stop, "Fcboard-end-session").start();
        super.onDestroy();
    }
}
