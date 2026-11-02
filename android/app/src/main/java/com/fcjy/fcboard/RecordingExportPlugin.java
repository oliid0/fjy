package com.fcjy.fcboard;

import android.app.Activity;
import android.content.Intent;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
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
import java.io.File;
import java.io.FileOutputStream;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
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
    private RecordingPackage recording;
    private RecordingShareServer server;
    private boolean saving;
    private boolean closeAfterSave;

    private RecordingPackage current(PluginCall call) throws Exception {
        if (recording == null || !recording.id.equals(call.getString("id"))) throw new Exception("Recording export session expired");
        return recording;
    }
    private void clear() {
        timer.removeCallbacksAndMessages(null);
        if (server != null) { server.stop(); server = null; }
        if (saving) { closeAfterSave = true; return; }
        if (recording != null) { try { recording.close(); } catch (Exception ignored) {} recording = null; }
        closeAfterSave = false;
    }
    @PluginMethod public void begin(PluginCall call) {
        worker.execute(() -> {
            try {
                if (saving) throw new Exception("A recording is being saved");
                clear();
                recording = new RecordingPackage(getContext().getCacheDir(), BridgeNumbers.integer(call.getData(), "size", 0L), call.getString("mime", ""), call.getString("transcript"), call.getString("summary"));
                call.resolve(new JSObject().put("id", recording.id));
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    @PluginMethod public void append(PluginCall call) {
        worker.execute(() -> {
            try {
                String data = call.getString("data", "");
                if (data.length() > 350000) throw new Exception("Recording chunk is too large");
                current(call).append(BridgeNumbers.integer(call.getData(), "offset", -1L), Base64.decode(data, Base64.DEFAULT));
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
                server = new RecordingShareServer(item);
                server.start(15000, true);
                JSArray urls = new JSArray();
                for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                    if (!network.isUp() || network.isLoopback()) continue;
                    for (InetAddress address : Collections.list(network.getInetAddresses())) {
                        if (address instanceof Inet4Address && address.isSiteLocalAddress()) urls.put("http://" + address.getHostAddress() + ":" + server.getListeningPort() + "/" + server.token + "/");
                    }
                }
                if (urls.length() == 0) { server.stop();server = null;throw new Exception("Connect to a local network before sharing"); }
                timer.postDelayed(() -> worker.execute(this::clear), 600000);
                call.resolve(new JSObject().put("urls", urls));
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    @PluginMethod public void save(PluginCall call) {
        worker.execute(() -> {
            try {
                if (saving || !current(call).isComplete()) throw new Exception("Recording export is not ready");
                saving = true;
                getActivity().runOnUiThread(() -> {
                    try {
                        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/zip").putExtra(Intent.EXTRA_TITLE, "Fcboard-recording.zip");
                        startActivityForResult(call, intent, "saved");
                    } catch (Exception error) { worker.execute(() -> { saving = false; if (closeAfterSave) clear();call.reject(error.getMessage(), error); }); }
                });
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    /** A finished capture must exist as a real file without another picker step. */
    @PluginMethod public void saveDevice(PluginCall call) {
        worker.execute(() -> {
            java.util.List<Uri> pending = new java.util.ArrayList<>();
            try {
                RecordingPackage item = current(call);
                String name = call.getString("name", "");
                if (!item.isComplete() || !name.matches("Fcboard-[A-Za-z0-9-]{1,80}")) throw new Exception("Recording export is not ready");
                JSArray files = new JSArray();
                try (InputStream media = new FileInputStream(item.media)) {
                    files.put(writeDevice(name + (item.mime.endsWith("mp4") ? ".mp4" : ".webm"), item.mime, media, pending));
                }
                try (InputStream text = new ByteArrayInputStream(item.transcript.getBytes(StandardCharsets.UTF_8))) {
                    files.put(writeDevice(name + "-transcript.txt", "text/plain", text, pending));
                }
                if (!item.summary.isEmpty()) try (InputStream text = new ByteArrayInputStream(item.summary.getBytes(StandardCharsets.UTF_8))) {
                    files.put(writeDevice(name + "-summary.txt", "text/plain", text, pending));
                }
                if (Build.VERSION.SDK_INT >= 29) for (Uri uri : pending) {
                    ContentValues ready = new ContentValues(); ready.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    getContext().getContentResolver().update(uri, ready, null, null);
                }
                call.resolve(new JSObject().put("files", files).put("location", Build.VERSION.SDK_INT >= 29 ? "Download/Fcboard" : "Android/data/com.fcjy.fcboard/files/Movies/Fcboard"));
            } catch (Exception error) {
                for (Uri uri : pending) {
                    try {
                        if ("file".equals(uri.getScheme())) new File(uri.getPath()).delete();
                        else getContext().getContentResolver().delete(uri, null, null);
                    } catch (Exception ignored) { }
                }
                call.reject("无法保存录制文件：" + error.getMessage(), error);
            }
        });
    }
    private String writeDevice(String name, String mime, InputStream input, java.util.List<Uri> pending) throws Exception {
        Uri uri;
        OutputStream output;
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Fcboard");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new Exception("Cannot create recording file");
            pending.add(uri);
            output = getContext().getContentResolver().openOutputStream(uri);
        } else {
            File root = getContext().getExternalFilesDir(Environment.DIRECTORY_MOVIES);
            if (root == null) throw new Exception("Storage unavailable");
            File directory = new File(root, "Fcboard");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("Cannot create recording folder");
            File file = new File(directory, name);
            uri = Uri.fromFile(file); pending.add(uri); output = new FileOutputStream(file);
        }
        if (output == null) throw new Exception("Cannot open recording file");
        try (OutputStream target = output) {
            byte[] buffer = new byte[65536]; int count;
            while ((count = input.read(buffer)) != -1) target.write(buffer, 0, count);
            target.flush();
        }
        return uri.toString();
    }
    @ActivityCallback private void saved(PluginCall call, ActivityResult result) {
        worker.execute(() -> {
            try {
                if (call == null) return;
                if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { call.resolve(new JSObject().put("saved", false));return; }
                try (FileInputStream input = new FileInputStream(current(call).archive); OutputStream output = getContext().getContentResolver().openOutputStream(result.getData().getData())) {
                    if (output == null) throw new Exception("Cannot write recording archive");
                    byte[] buffer = new byte[65536];int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                }
                call.resolve(new JSObject().put("saved", true));
            } catch (Exception error) { if (call != null) call.reject(error.getMessage(), error); }
            finally { saving = false;if (closeAfterSave) clear(); }
        });
    }
    @PluginMethod public void close(PluginCall call) { worker.execute(() -> { if (recording != null && recording.id.equals(call.getString("id"))) clear();call.resolve(); }); }
    @Override protected void handleOnDestroy() { timer.removeCallbacksAndMessages(null);worker.execute(this::clear);worker.shutdown(); }
}
