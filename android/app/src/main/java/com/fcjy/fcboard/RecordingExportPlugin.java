package com.fcjy.fcboard;

import android.app.Activity;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "FcboardRecordingExport")
public class RecordingExportPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler timer = new Handler(Looper.getMainLooper());
    private final java.util.Map<String, RecordingPackage> recordings = new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.Map<String, Runnable> shareExpirations = new java.util.HashMap<>();
    private String sharedId;
    private String savingId;
    private RecordingShareServer server;
    private boolean saving;
    private boolean closeAfterSave;

    private RecordingPackage current(PluginCall call) throws Exception {
        String id = call.getString("id");
        RecordingPackage item = id == null ? null : recordings.get(id);
        if (item == null) throw new Exception("Recording export session expired");
        return item;
    }
    private void clear(String id) {
        if (id == null) return;
        Runnable expiry = shareExpirations.remove(id);
        if (expiry != null) timer.removeCallbacks(expiry);
        if (id.equals(sharedId)) {
            if (server != null) { server.stop(); server = null; }
            sharedId = null;
        }
        if (id.equals(savingId) && saving) { closeAfterSave = true; return; }
        RecordingPackage item = recordings.remove(id);
        if (item != null) { try { item.close(); } catch (Exception ignored) {} }
    }
    private void clear() {
        for (String id : new java.util.ArrayList<>(recordings.keySet())) clear(id);
    }
    private void scheduleShareExpiry(String id) {
        Runnable previous = shareExpirations.remove(id);
        if (previous != null) timer.removeCallbacks(previous);
        Runnable expiry = new Runnable() {
            @Override public void run() {
                worker.execute(() -> {
                    // A prior callback may already have entered the worker queue.
                    if (shareExpirations.get(id) == this) clear(id);
                });
            }
        };
        shareExpirations.put(id, expiry);
        timer.postDelayed(expiry, 600000);
    }
    @PluginMethod public void begin(PluginCall call) {
        worker.execute(() -> {
            try {
                if (recordings.size() >= 4) throw new Exception("Close another recording export before preparing more files");
                RecordingPackage recording = new RecordingPackage(getContext().getCacheDir(), call.getInt("size", 0), call.getString("mime", ""), call.getString("transcript"), call.getString("summary"));
                recordings.put(recording.id, recording);
                call.resolve(new JSObject().put("id", recording.id));
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    @PluginMethod public void append(PluginCall call) {
        worker.execute(() -> {
            try {
                String data = call.getString("data", "");
                if (data.length() > 350000) throw new Exception("Recording chunk is too large");
                current(call).append(call.getInt("offset", -1), Base64.decode(data, Base64.DEFAULT));
                call.resolve();
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    @PluginMethod public void complete(PluginCall call) {
        worker.execute(() -> {
            try { current(call).finish();call.resolve(); }
            catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    @PluginMethod public void share(PluginCall call) {
        worker.execute(() -> {
            try {
                RecordingPackage item = current(call);
                if (!item.isComplete()) throw new Exception("Recording export is incomplete");
                if (server != null) server.stop();
                sharedId = item.id;
                server = new RecordingShareServer(item);
                server.start(15000, true);
                JSArray urls = new JSArray();
                for (String address : NetworkPlugin.lanAddresses(getContext())) {
                    urls.put("http://" + address + ":" + server.getListeningPort() + "/" + server.token + "/");
                }
                if (urls.length() == 0) { server.stop();server = null;throw new Exception("Connect to a local network before sharing"); }
                scheduleShareExpiry(item.id);
                call.resolve(new JSObject().put("urls", urls));
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    /** Persist the completed archive independently of optional AI summaries. */
    @PluginMethod public void saveDownloads(PluginCall call) {
        worker.execute(() -> {
            android.net.Uri uri = null;
            try {
                RecordingPackage item = current(call);
                if (!item.isComplete()) throw new Exception("Recording export is not ready");
                String name = "Fcboard-" + new java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.ROOT).format(new java.util.Date()) + "-" + item.id.substring(0, 8) + ".zip";
                if (android.os.Build.VERSION.SDK_INT >= 29) {
                    android.content.ContentValues values = new android.content.ContentValues();
                    values.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name);
                    values.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "application/zip");
                    values.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS + "/Fcboard");
                    values.put(android.provider.MediaStore.MediaColumns.IS_PENDING, 1);
                    uri = getContext().getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) throw new Exception("Cannot create recording download");
                    try (FileInputStream input = new FileInputStream(item.archive); OutputStream output = getContext().getContentResolver().openOutputStream(uri)) {
                        if (output == null) throw new Exception("Cannot write recording download");
                        byte[] buffer = new byte[65536]; int count;
                        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    }
                    values.clear(); values.put(android.provider.MediaStore.MediaColumns.IS_PENDING, 0);
                    getContext().getContentResolver().update(uri, values, null, null);
                } else {
                    java.io.File folder = getContext().getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS);
                    if (folder == null || (!folder.isDirectory() && !folder.mkdirs())) throw new Exception("Recording storage unavailable");
                    java.io.File file = new java.io.File(folder, name);
                    try (FileInputStream input = new FileInputStream(item.archive); OutputStream output = new java.io.FileOutputStream(file)) {
                        byte[] buffer = new byte[65536]; int count;
                        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    }
                    uri = android.net.Uri.fromFile(file);
                }
                call.resolve(new JSObject().put("saved", true).put("uri", uri.toString()));
            } catch (Exception error) {
                if (uri != null && "content".equals(uri.getScheme())) getContext().getContentResolver().delete(uri, null, null);
                call.reject(error.getMessage(), error);
            }
        });
    }
    @PluginMethod public void save(PluginCall call) {
        worker.execute(() -> {
            try {
                if (saving || !current(call).isComplete()) throw new Exception("Recording export is not ready");
                saving = true;
                savingId = current(call).id;
                closeAfterSave = false;
                getActivity().runOnUiThread(() -> {
                    try {
                        boolean media = call.getBoolean("media", false);
                        RecordingPackage item = current(call);
                        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(media ? item.mime : "application/zip").putExtra(Intent.EXTRA_TITLE, media ? item.media.getName() : "Fcboard-recording.zip");
                        startActivityForResult(call, intent, "saved");
                    } catch (Exception error) { worker.execute(() -> { saving = false; if (closeAfterSave) clear(call.getString("id"));call.reject(error.getMessage(), error); }); }
                });
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    @ActivityCallback private void saved(PluginCall call, ActivityResult result) {
        worker.execute(() -> {
            try {
                if (call == null) return;
                if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { call.resolve(new JSObject().put("saved", false));return; }
                try (FileInputStream input = new FileInputStream(call.getBoolean("media", false) ? current(call).media : current(call).archive); OutputStream output = getContext().getContentResolver().openOutputStream(result.getData().getData())) {
                    if (output == null) throw new Exception("Cannot write recording archive");
                    byte[] buffer = new byte[65536];int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                }
                call.resolve(new JSObject().put("saved", true));
            } catch (Exception error) { if (call != null) call.reject(error.getMessage(), error); }
            finally { saving = false;if (closeAfterSave && call != null) clear(call.getString("id")); savingId = null; closeAfterSave = false; }
        });
    }
    @PluginMethod public void close(PluginCall call) { worker.execute(() -> { clear(call.getString("id"));call.resolve(); }); }
    @Override protected void handleOnDestroy() { timer.removeCallbacksAndMessages(null);worker.execute(this::clear);worker.shutdown(); }
}
