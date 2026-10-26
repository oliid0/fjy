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
                recording = new RecordingPackage(getContext().getCacheDir(), call.getLong("size", 0L), call.getString("mime", ""), call.getString("transcript"), call.getString("summary"));
                call.resolve(new JSObject().put("id", recording.id));
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    @PluginMethod public void append(PluginCall call) {
        worker.execute(() -> {
            try {
                String data = call.getString("data", "");
                if (data.length() > 350000) throw new Exception("Recording chunk is too large");
                current(call).append(call.getLong("offset", -1L), Base64.decode(data, Base64.DEFAULT));
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
