package com.fcjy.fcboard;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.os.RemoteException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONArray;

/** A bounded, cancellable IPC bridge. Never loads ONNX in the Activity process. */
@CapacitorPlugin(name = "FcboardLocalInference")
public class LocalInferencePlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, Pending> pending = new LinkedHashMap<>();
    private Messenger remote;
    private boolean bound, closed;
    private final Runnable idle = this::disconnect;
    private static final class Pending {
        final PluginCall call;
        final Bundle input;
        final Runnable timeout;
        boolean sent;
        Pending(PluginCall call, Bundle input, Runnable timeout) {
            this.call = call; this.input = input; this.timeout = timeout;
        }
    }
    private final Messenger reply = new Messenger(new Handler(Looper.getMainLooper(), message -> {
        Bundle result = message.getData();
        String id = result.getString("id", "");
        Pending request = pending.remove(id);
        if (request == null) return true;
        main.removeCallbacks(request.timeout);
        if (result.containsKey("error")) request.call.reject(result.getString("error"), "NATIVE_INFERENCE_FAILED");
        else {
            JSObject value = new JSObject();
            for (String key : new String[]{"latex", "language", "translation"}) {
                if (result.containsKey(key)) value.put(key, result.getString(key));
            }
            request.call.resolve(value);
        }
        scheduleIdle();
        return true;
    }));
    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            if (closed) { disconnect(); return; }
            remote = new Messenger(binder);
            for (Pending request : pending.values().toArray(new Pending[0])) send(request);
        }
        @Override public void onServiceDisconnected(ComponentName name) { lost(); }
        @Override public void onBindingDied(ComponentName name) { lost(); }
        @Override public void onNullBinding(ComponentName name) { lost(); }
    };
    @PluginMethod public void infer(PluginCall call) {
        final Bundle input;
        try { input = input(call); }
        catch (Exception error) { call.reject(error.getMessage()); return; }
        main.post(() -> {
            String id = input.getString("id");
            if (closed || pending.size() >= 8 || pending.containsKey(id)) {
                call.reject("Native inference unavailable or queue full"); return;
            }
            main.removeCallbacks(idle);
            Pending request = new Pending(call, input, () -> cancel(id, "Native inference timed out"));
            pending.put(id, request);
            main.postDelayed(request.timeout, 90000);
            if (remote != null) send(request);
            else if (!bound) {
                try {
                    bound = getContext().bindService(new Intent(getContext(), LocalInferenceService.class), connection, Context.BIND_AUTO_CREATE);
                    if (!bound) lost();
                } catch (RuntimeException error) { lost(); }
            }
        });
    }
    private static Bundle input(PluginCall call) throws Exception {
        String id = call.getString("id", ""), kind = call.getString("kind", "");
        if (!id.matches("[a-fA-F0-9-]{36}")) throw new IllegalArgumentException("Invalid inference ID");
        Bundle data = new Bundle(); data.putString("id", id); data.putString("kind", kind);
        if (kind.equals("translation")) {
            String text = call.getString("text", ""), source = call.getString("source", ""), target = call.getString("target", "");
            if (text.trim().isEmpty() || text.length() > 4000 ||
                !(source.equals("en") && target.equals("zh") || source.equals("zh") && target.equals("en"))) {
                throw new IllegalArgumentException("Invalid OPUS translation request");
            }
            data.putString("text", text); data.putString("source", source); data.putString("target", target);
        } else if (kind.equals("math")) {
            JSONArray strokes = call.getArray("strokes");
            if (strokes == null || strokes.length() < 1 || strokes.length() > 3000) throw new IllegalArgumentException("Invalid math strokes");
            int count = 0;
            int[] lengths = new int[strokes.length()];
            for (int i = 0; i < lengths.length; i++) { lengths[i] = strokes.getJSONArray(i).length(); count += lengths[i]; }
            if (count < 1 || count > 12000) throw new IllegalArgumentException("Math selection is too large");
            float[] points = new float[count * 2]; int at = 0;
            for (int i = 0; i < lengths.length; i++) {
                JSONArray stroke = strokes.getJSONArray(i);
                for (int j = 0; j < lengths[i]; j++) {
                    JSONArray point = stroke.getJSONArray(j);
                    for (int k = 0; k < 2; k++) {
                        double coordinate = point.getDouble(k);
                        if (!Double.isFinite(coordinate) || Math.abs(coordinate) > 1e7) throw new IllegalArgumentException("Invalid math point");
                        points[at++] = (float) coordinate;
                    }
                }
            }
            data.putFloatArray("points", points); data.putIntArray("lengths", lengths);
        } else throw new IllegalArgumentException("Invalid inference kind");
        return data;
    }
    private void send(Pending request) {
        if (request.sent || remote == null) return;
        Message message = Message.obtain(null, LocalInferenceService.INFER);
        message.setData(request.input); message.replyTo = reply;
        try { remote.send(message); request.sent = true; }
        catch (RemoteException error) { lost(); }
    }
    @PluginMethod public void cancel(PluginCall call) {
        String id = call.getString("id", "");
        main.post(() -> { cancel(id, "Inference cancelled"); call.resolve(); });
    }
    private void cancel(String id, String reason) {
        Pending request = pending.remove(id);
        if (request == null) return;
        main.removeCallbacks(request.timeout);
        if (remote != null && request.sent) {
            Message cancel = Message.obtain(null, LocalInferenceService.CANCEL);
            Bundle data = new Bundle(); data.putString("id", id); cancel.setData(data);
            try { remote.send(cancel); } catch (RemoteException ignored) { /* Death handled by connection. */ }
        }
        request.call.reject(reason, "NATIVE_INFERENCE_CANCELLED");
        scheduleIdle();
    }
    private void scheduleIdle() {
        if (pending.isEmpty()) { main.removeCallbacks(idle); main.postDelayed(idle, 60000); }
    }
    private void lost() {
        for (Pending request : pending.values()) {
            main.removeCallbacks(request.timeout);
            request.call.reject("Native model process stopped; retry the unchanged ink", "NATIVE_INFERENCE_PROCESS_LOST");
        }
        pending.clear(); disconnect();
    }
    private void disconnect() {
        main.removeCallbacks(idle); remote = null;
        if (bound) { bound = false; getContext().unbindService(connection); }
    }
    @Override protected void handleOnDestroy() {
        main.post(() -> { closed = true; for (String id : pending.keySet().toArray(new String[0])) cancel(id, "Inference closed"); disconnect(); });
    }
}
