package com.fcjy.fcboard;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Actual USB transport. Each unique interrupt endpoint has exactly one reader. */
final class SkizzeUsb implements AutoCloseable {
    interface Listener {
        void state(String device, boolean connected, Integer battery, String error);
        void packet(String device, SkizzeProtocol.Packet packet);
        void empty();
    }
    private final Context context;
    private final UsbManager manager;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, Connection> connections = new HashMap<>();
    private final Set<String> requested = new HashSet<>();
    private final String permission;
    private boolean closed;
    private final Runnable discovery = new Runnable() {
        @Override public void run() {
            if (closed) return;
            scan();
            main.postDelayed(this, 3000);
        }
    };
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (closed) return;
            UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
            if (!matches(device)) return;
            if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(intent.getAction())) {
                requested.remove(device.getDeviceName());
                Connection connection = connections.remove(device.getDeviceName());
                if (connection != null) connection.close();
                scan();
            } else if (permission.equals(intent.getAction())) {
                if (manager.hasPermission(device)) connect(device);
                else listener.state(device.getDeviceName(), false, null, "USB permission denied");
            } else scan();
        }
    };

    static boolean matches(UsbDevice device) {
        return device != null && SkizzeProtocol.matches(device.getVendorId(), device.getProductId());
    }
    static boolean available(Context context) {
        UsbManager manager = context.getSystemService(UsbManager.class);
        if (manager != null) for (UsbDevice device : manager.getDeviceList().values()) if (matches(device)) return true;
        return false;
    }
    SkizzeUsb(Context context, Listener listener) {
        this.context = context; this.listener = listener;
        manager = context.getSystemService(UsbManager.class);
        permission = context.getPackageName() + ".SKIZZE_USB_PERMISSION";
        IntentFilter filter = new IntentFilter(permission);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
        scan();
        main.postDelayed(discovery, 3000);
    }
    private void scan() {
        if (closed || manager == null) { listener.empty(); return; }
        boolean found = false;
        for (UsbDevice device : manager.getDeviceList().values()) {
            if (!matches(device)) continue;
            found = true;
            if (manager.hasPermission(device)) connect(device);
            else if (requested.add(device.getDeviceName())) {
                try {
                    PendingIntent answer = PendingIntent.getBroadcast(context, device.getDeviceId(),
                        new Intent(permission).setPackage(context.getPackageName()), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                    manager.requestPermission(device, answer);
                } catch (RuntimeException error) {
                    listener.state(device.getDeviceName(), false, null, error.toString());
                }
            }
        }
        if (!found) listener.empty();
    }
    private void connect(UsbDevice device) {
        if (closed || connections.containsKey(device.getDeviceName())) return;
        try {
            Connection connection = new Connection(device);
            connections.put(device.getDeviceName(), connection);
            connection.start();
        } catch (RuntimeException error) {
            listener.state(device.getDeviceName(), false, null, error.toString());
        }
    }
    @Override public void close() {
        if (closed) return;
        closed = true;
        main.removeCallbacks(discovery);
        context.unregisterReceiver(receiver);
        for (Connection connection : new ArrayList<>(connections.values())) connection.close();
        connections.clear(); requested.clear();
    }

    private final class Connection implements AutoCloseable {
        final UsbDevice device;
        final UsbDeviceConnection usb;
        final UsbInterface control;
        final UsbInterface tip;
        final UsbEndpoint controlEndpoint;
        final UsbEndpoint tipEndpoint;
        final ScheduledExecutorService commands = Executors.newSingleThreadScheduledExecutor();
        final ArrayList<Thread> readers = new ArrayList<>();
        final AtomicBoolean stopped = new AtomicBoolean();
        final AtomicBoolean checking = new AtomicBoolean();
        final SkizzeProtocol.Barrel barrel = new SkizzeProtocol.Barrel();
        volatile boolean connected;
        volatile Integer battery;
        boolean rawEnabled;
        int missedQueries;

        Connection(UsbDevice device) {
            this.device = device;
            int tipIndex = device.getProductId() == 36867 ? 4 : 3;
            if (device.getInterfaceCount() <= tipIndex) throw new IllegalStateException("Missing Skizze USB interface");
            control = device.getInterface(3); tip = device.getInterface(tipIndex);
            controlEndpoint = endpoint(control); tipEndpoint = endpoint(tip);
            if (controlEndpoint == null || tipEndpoint == null) throw new IllegalStateException("Missing Skizze interrupt endpoint");
            usb = manager.openDevice(device);
            if (usb == null) throw new IllegalStateException("Cannot open Skizze USB device");
            boolean claimed = usb.claimInterface(control, true);
            boolean tipClaimed = claimed && (tip.getId() == control.getId() || usb.claimInterface(tip, true));
            if (!tipClaimed) {
                if (claimed) usb.releaseInterface(control);
                usb.close(); commands.shutdownNow();
                throw new IllegalStateException("Cannot claim Skizze USB interface");
            }
        }
        void start() {
            read(controlEndpoint);
            if (controlEndpoint.getAddress() != tipEndpoint.getAddress()) read(tipEndpoint);
            commands.scheduleWithFixedDelay(this::check, 0, 3, TimeUnit.SECONDS);
        }
        private void read(UsbEndpoint endpoint) {
            Thread reader = new Thread(() -> {
                byte[] bytes = new byte[Math.max(32, endpoint.getMaxPacketSize())];
                try {
                    while (!stopped.get()) {
                        if (!manager.hasPermission(device)) throw new SecurityException("Skizze USB permission lost");
                        int length = usb.bulkTransfer(endpoint, bytes, bytes.length, 100);
                        if (length <= 0) {
                            java.util.concurrent.locks.LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(10));
                            continue;
                        }
                        SkizzeProtocol.Packet packet = SkizzeProtocol.decode(bytes, length);
                        if (packet == null) continue;
                        if (packet.type == 1) requestCheck();
                        else if (packet.type == 7) {
                            int value = packet.data[0] & 255;
                            if (value <= 100) { battery = value; publish(""); }
                        } else if (packet.type == 5) {
                            if (barrel.accept(packet.data[0]) && connected) emit(new SkizzeProtocol.Packet(5, new byte[0]));
                        } else if (connected) emit(packet);
                    }
                } catch (RuntimeException error) {
                    main.post(() -> {
                        if (stopped.get() || closed) return;
                        listener.state(device.getDeviceName(), false, null, error.toString());
                        connections.remove(device.getDeviceName()); close();
                    });
                }
            }, "Fcboard-Skizze-interrupt");
            readers.add(reader); reader.start();
        }
        private void emit(SkizzeProtocol.Packet packet) {
            main.post(() -> { if (!closed && !stopped.get() && connected) listener.packet(device.getDeviceName(), packet); });
        }
        private void requestCheck() {
            if (stopped.get() || !checking.compareAndSet(false, true)) return;
            commands.execute(() -> { try { check(); } finally { checking.set(false); } });
        }
        private void check() {
            if (stopped.get()) return;
            try {
                byte[] response = command(0x81, new byte[0]);
                if (response == null || response.length == 0) {
                    if (++missedQueries >= 3) {
                        connected = false; battery = null; rawEnabled = false; barrel.reset();
                        publish("Skizze connection query timed out");
                    }
                    return;
                }
                missedQueries = 0;
                if (response[0] != 0) {
                    if (!connected) {
                        barrel.reset(); connected = true; publish("");
                        byte[] level = command(0x85, new byte[0]);
                        if (level != null && level.length > 0 && (level[0] & 255) <= 100) battery = level[0] & 255;
                        publish("");
                    }
                } else if (connected) {
                    connected = false; battery = null; rawEnabled = false; barrel.reset(); publish("");
                }
                if (connected && !rawEnabled) {
                    rawEnabled = command(0xa2, new byte[]{0}) != null;
                    if (!rawEnabled) publish("Cannot enable Skizze raw button reports");
                }
            } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            catch (RuntimeException error) { if (!stopped.get()) publish(error.toString()); }
        }
        private byte[] command(int command, byte[] data) throws InterruptedException {
            byte[] request = SkizzeProtocol.featureRequest(command, data);
            for (int retry = 0; retry < 3 && !stopped.get(); retry++) {
                if (usb.controlTransfer(33, 9, 0x303, control.getId(), request, request.length, 100) == request.length) {
                    for (int poll = 0; poll < 15 && !stopped.get(); poll++) {
                        Thread.sleep(80);
                        byte[] response = new byte[28];
                        int length = usb.controlTransfer(161, 1, 0x303, control.getId(), response, response.length, 100);
                        byte[] result = SkizzeProtocol.featureResponse(command, response, length);
                        if (result != null) return result;
                    }
                } else Thread.sleep(20);
            }
            return null;
        }
        private void publish(String error) {
            boolean state = connected; Integer level = battery;
            main.post(() -> { if (!closed && !stopped.get()) listener.state(device.getDeviceName(), state, level, error); });
        }
        @Override public void close() {
            if (!stopped.compareAndSet(false, true)) return;
            connected = false; commands.shutdownNow();
            for (Thread reader : readers) reader.interrupt();
            usb.releaseInterface(control);
            if (tip.getId() != control.getId()) usb.releaseInterface(tip);
            usb.close();
            if (!closed) listener.state(device.getDeviceName(), false, null, "");
        }
    }
    private static UsbEndpoint endpoint(UsbInterface usbInterface) {
        for (int i = 0; i < usbInterface.getEndpointCount(); i++) {
            UsbEndpoint endpoint = usbInterface.getEndpoint(i);
            if (endpoint.getType() == UsbConstants.USB_ENDPOINT_XFER_INT && endpoint.getDirection() == UsbConstants.USB_DIR_IN) return endpoint;
        }
        return null;
    }
}
