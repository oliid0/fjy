package com.fcjy.fcboard;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import fi.iki.elonen.NanoHTTPD;
import java.io.File;
import java.io.IOException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.view.PixelCopy;
import android.util.Base64;
import java.io.ByteArrayOutputStream;

/** Paired, opt-in LAN uploads. Reading received files stays inside Capacitor's bridge. */
@CapacitorPlugin(name = "FcboardClassroom")
public class ClassroomPlugin extends Plugin {
    private final AIStreamTransport aiTransport = new AIStreamTransport();

    @PluginMethod
    public void getAppVersion(PluginCall call) {
        try {
            android.content.pm.PackageInfo info = getContext().getPackageManager()
                .getPackageInfo(getContext().getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("name", info.versionName);
            result.put("code", androidx.core.content.pm.PackageInfoCompat.getLongVersionCode(info));
            call.resolve(result);
        } catch (Exception error) { call.reject("Could not read app version", error); }
    }

    /** System installations can enable developer mode; debugging stays in the system Settings UI. */
    @PluginMethod
    public void openDebugSettings(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                android.content.ContentResolver resolver = getContext().getContentResolver();
                if (getContext().checkSelfPermission(android.Manifest.permission.WRITE_SECURE_SETTINGS)
                    == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    if (!android.provider.Settings.Global.putInt(resolver,
                        android.provider.Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 1)) {
                        call.reject("Could not enable developer settings");
                        return;
                    }
                }
                android.content.Intent intent = new android.content.Intent(
                    android.provider.Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS);
                if (intent.resolveActivity(getContext().getPackageManager()) == null) {
                    call.reject("Developer settings are unavailable on this device");
                    return;
                }
                getActivity().startActivity(intent);
                JSObject result = new JSObject();
                result.put("enabled", android.provider.Settings.Global.getInt(resolver,
                    android.provider.Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1);
                call.resolve(result);
            } catch (Exception error) { call.reject("Could not open developer settings", error); }
        });
    }

    @PluginMethod
    public void postAIStream(PluginCall call) {
        try {
            String id = call.getString("id");
            JSObject inputHeaders = call.getObject("headers", new JSObject());
            java.util.Map<String, String> headers = new java.util.HashMap<>();
            headers.put("Content-Type", "application/json");
            headers.put("Authorization", inputHeaders.getString("Authorization", ""));
            aiTransport.start(id, call.getString("url"), headers, call.getString("body"), new AIStreamTransport.Callback() {
                public void chunk(String chunk) {
                    JSObject event = new JSObject(); event.put("id", id); event.put("chunk", chunk);
                    notifyListeners("aiStream", event);
                }
                public void complete(int status, String data, boolean stream) {
                    JSObject result = new JSObject(); result.put("status", status); result.put("data", data); result.put("stream", stream);
                    call.resolve(result);
                }
                public void failed(Exception error) { call.reject("AI connection failed", error); }
            });
        } catch (Exception error) { call.reject("AI request failed", error); }
    }

    @PluginMethod
    public void cancelAIStream(PluginCall call) { aiTransport.cancel(call.getString("id")); call.resolve(); }

    private WebResourceDialog webResource;

    @PluginMethod
    public void openWebResource(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                String url = WebResourceDialog.checkedUrl(call.getString("url"));
                if (webResource != null && webResource.isShowing()) webResource.dismiss();
                webResource = new WebResourceDialog(getActivity(), url, call.getString("language", java.util.Locale.getDefault().toLanguageTag()), selected -> notifyListeners("webSelection", selected));
                webResource.show();
                call.resolve();
            } catch (Exception error) { call.reject("无法打开教学网页：" + error.getMessage(), error); }
        });
    }

    @PluginMethod
    public void webResourceAction(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (webResource == null || !webResource.isShowing()) { call.reject("请先打开教学网页"); return; }
            webResource.action(call.getData(), call);
        });
    }
    @PluginMethod
    public void getFactoryTools(PluginCall call) {
        try {
            JSArray available = new JSArray();
            for (String tool : FactoryTools.PACKAGES.keySet()) {
                if (FactoryTools.resolve(getContext(), tool) != null) available.put(tool);
            }
            JSObject result = new JSObject(); result.put("available", available); call.resolve(result);
        } catch (Exception error) { call.reject("无法读取大屏工具", error); }
    }

    @PluginMethod
    public void openFactoryTool(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                android.content.Intent intent = FactoryTools.resolve(getContext(), call.getString("tool"));
                if (intent == null) { call.reject("当前设备未安装或未开放这项大屏工具"); return; }
                getActivity().startActivity(intent);
                call.resolve();
            } catch (Exception error) { call.reject("无法打开大屏工具：" + error.getMessage(), error); }
        });
    }

    private Receiver receiver;
    private SignalResourceDialog signalResource;
    @PluginMethod
    public void getFactoryInsertions(PluginCall call) {
        try {
            JSArray available = new JSArray();
            boolean embeddedSignal = !SignalResourceDialog.availableInputs(getContext()).isEmpty();
            for (String insertion : FactoryTools.INSERTIONS.keySet()) {
                if (("signal".equals(insertion) && embeddedSignal)
                    || FactoryTools.resolveInsertion(getContext(), insertion) != null) available.put(insertion);
            }
            JSArray embedded = new JSArray();
            if (embeddedSignal) embedded.put("signal");
            JSObject result = new JSObject(); result.put("available", available); result.put("embedded", embedded); call.resolve(result);
        } catch (Exception error) { call.reject("无法读取插入应用", error); }
    }

    @PluginMethod
    public void openFactoryInsertion(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                String insertion = call.getString("insertion");
                if ("signal".equals(insertion) && !SignalResourceDialog.availableInputs(getContext()).isEmpty()) {
                    closeSignalResource();
                    signalResource = new SignalResourceDialog(getActivity(), call.getString("language", java.util.Locale.getDefault().toLanguageTag()));
                    signalResource.show();
                    JSObject result = new JSObject(); result.put("embedded", true); call.resolve(result);
                    return;
                }
                android.content.Intent intent = FactoryTools.resolveInsertion(getContext(), insertion);
                if (intent == null) { call.reject("当前设备未安装或未开放这项插入应用"); return; }
                if ("signal".equals(insertion)) android.widget.Toast.makeText(getContext(), R.string.signal_external, android.widget.Toast.LENGTH_LONG).show();
                getActivity().startActivity(intent);
                JSObject result = new JSObject(); result.put("embedded", false); call.resolve(result);
            } catch (Exception error) { closeSignalResource(); call.reject("无法打开插入应用：" + error.getMessage(), error); }
        });
    }

    @PluginMethod
    public void signalAction(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                String action = call.getString("action", "read");
                if (!java.util.Arrays.asList("read", "select", "reload", "reset", "close").contains(action)) {
                    call.reject("Unknown signal source action");
                    return;
                }
                String language = call.getString("language", java.util.Locale.getDefault().toLanguageTag());
                if (signalResource == null || !signalResource.isShowing()) {
                    signalResource = null;
                    if ("read".equals(action) || "close".equals(action)) {
                        call.resolve(SignalResourceDialog.closedState(getContext(), language));
                    } else {
                        call.reject(getContext().getString(R.string.signal_control_unavailable));
                    }
                    return;
                }
                JSObject result = signalResource.action(action, call.getString("id"));
                if ("close".equals(action)) signalResource = null;
                call.resolve(result);
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }

    private BoardShareServer boardShare;
    private final Handler shareTimer = new Handler(Looper.getMainLooper());

    @PluginMethod
    public synchronized void startShare(PluginCall call) {
        try {
            JSArray pages = call.getArray("pages");
            if (pages == null || pages.length() < 1 || pages.length() > 20) throw new IOException("请选择 1 至 20 页分享");
            List<byte[]> images = new ArrayList<>();
            int total = 0;
            for (int index = 0; index < pages.length(); index++) {
                String value = pages.getString(index);
                if (!value.startsWith("data:image/png;base64,") || value.length() > 14000000) throw new IOException("分享页面格式或大小无效");
                byte[] image = Base64.decode(value.substring(22), Base64.DEFAULT);
                if (image.length < 8 || image[0] != (byte)137 || image[1] != 80 || image[2] != 78 || image[3] != 71) throw new IOException("分享页面必须是 PNG 图片");
                total += image.length;
                if (total > 20000000) throw new IOException("分享图片总大小超过 20 MB，请减少页数");
                images.add(image);
            }
            List<String> addresses = new ArrayList<>();
            for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!network.isUp() || network.isLoopback()) continue;
                for (InetAddress address : Collections.list(network.getInetAddresses())) {
                    if (address instanceof Inet4Address && address.isSiteLocalAddress()) addresses.add(address.getHostAddress());
                }
            }
            if (addresses.isEmpty()) throw new IOException("请先连接局域网后再分享");
            stopBoardShare();
            boardShare = new BoardShareServer(images, 600000);
            boardShare.start(15000, true);
            JSArray urls = new JSArray();
            for (String address : addresses) urls.put("http://" + address + ":" + boardShare.getListeningPort() + "/" + boardShare.token + "/");
            shareTimer.postDelayed(this::stopBoardShare, 600000);
            JSObject result = new JSObject(); result.put("urls", urls); call.resolve(result);
        } catch (Exception error) { stopBoardShare(); call.reject(error.getMessage(), error); }
    }

    private synchronized void stopBoardShare() {
        shareTimer.removeCallbacksAndMessages(null);
        if (boardShare != null) { boardShare.stop(); boardShare = null; }
    }

    @PluginMethod
    public void stopShare(PluginCall call) { stopBoardShare(); call.resolve(); }

    /** QRHttpPopu / ScreenshotPwdUtils: empty disables, four digits enables. */
    @PluginMethod
    public synchronized void setSharePassword(PluginCall call) {
        try {
            if (boardShare == null) throw new IOException("分享已结束，请重新生成二维码");
            boardShare.setPassword(call.getString("password", "")); call.resolve();
        } catch (Exception error) { call.reject(error.getMessage()); }
    }

    /** Open the system attachment composer; the user chooses the recipient and sends. */
    @PluginMethod
    public void sharePages(PluginCall call) {
        try {
            android.content.Intent intent = BoardAttachments.create(getContext(), call.getArray("pages"), call.getString("format", "png"));
            getActivity().runOnUiThread(() -> {
                try {
                    getActivity().startActivity(android.content.Intent.createChooser(intent, "邮件发送 / 分享白板"));
                    call.resolve();
                } catch (Exception error) { call.reject("无法打开邮件或分享应用", error); }
            });
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    @PluginMethod
    public void exitApp(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            call.resolve();
            getActivity().finish();
        });
    }
    private final java.util.concurrent.ExecutorService imageEncoder = java.util.concurrent.Executors.newSingleThreadExecutor();

    /** The factory whiteboard uses physical pixels and the manufacturer's touch calibration. */
    @PluginMethod
    public void getInkProfile(PluginCall call) {
        JSObject result = new JSObject();
        result.put("hardPenWidth", 4);
        result.put("brushPenWidth", 15);
        result.put("eraserSize", 150);
        // HDataSet.hasNib / HPenSettingWindow: nib firmware uses 2..20, otherwise 2..40.
        int penWidthMax = 40;
        try {
            Object nib = Class.forName("android.os.SystemProperties")
                .getMethod("getInt", String.class, int.class)
                .invoke(null, "persist.sys.wb.addNib", 1);
            if (Integer.valueOf(1).equals(nib)) penWidthMax = 20;
            boolean nibAvailable = Integer.valueOf(1).equals(nib);
            result.put("hardNibAvailable", nibAvailable);
            Object nibEnabled = Class.forName("android.os.SystemProperties")
                .getMethod("getInt", String.class, int.class)
                .invoke(null, "persist.sys.nib.switch", 1);
            result.put("hardNib", nibAvailable && Integer.valueOf(1).equals(nibEnabled));
            Object dual = Class.forName("android.os.SystemProperties")
                .getMethod("getInt", String.class, int.class)
                .invoke(null, "persist.sys.custom.doublePen.switch", 0);
            result.put("dualPen", Integer.valueOf(1).equals(dual));
        } catch (ReflectiveOperationException | SecurityException unavailable) {
            // Non-factory Android devices can prohibit access to this firmware property.
        }
        try {
            Object pressure = Class.forName("android.os.SystemProperties")
                .getMethod("getBoolean", String.class, boolean.class)
                .invoke(null, "persist.sys.pressure.sensitivity.switch", false);
            result.put("touchPressure", Boolean.TRUE.equals(pressure));
        } catch (ReflectiveOperationException | SecurityException unavailable) {
            // Keep simulated touch pressure unless the firmware explicitly enables it.
        }
        result.put("penWidthMax", penWidthMax);
        try (android.database.Cursor cursor = getContext().getContentResolver().query(
                android.net.Uri.parse("content://com.bsd.systemservice.db.sourceContentProvider/tbl_Settings"),
                new String[]{"touch_threshold"}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                float threshold = cursor.getFloat(cursor.getColumnIndexOrThrow("touch_threshold"));
                if (Float.isFinite(threshold) && threshold > 0) result.put("palmThreshold", threshold * 2.0 / 3.0);
            }
        } catch (Exception unavailable) {
            // Other Android devices need no vendor provider; keep the manual CSS-pixel setting.
        }
        // ZWhiteBoardActivity.getThickSize applies 4/5 to the stored physical contact threshold.
        try (android.database.Cursor cursor = getContext().getContentResolver().query(
                android.net.Uri.parse("content://com.bsd.systemservice.db.sourceContentProvider/tbl_Settings"),
                new String[]{"pen_threshold"}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                float threshold = cursor.getFloat(cursor.getColumnIndexOrThrow("pen_threshold"));
                if (Float.isFinite(threshold) && threshold > 0) result.put("fineThreshold", threshold * 4.0 / 5.0);
            }
        } catch (Exception unavailable) { /* Calibration can be entered manually on other firmware. */ }
        try (android.database.Cursor cursor = getContext().getContentResolver().query(
                android.net.Uri.parse("content://com.bsd.systemservice.db.sourceContentProvider/tbl_Settings"),
                new String[]{"thick_threshold"}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                float threshold = cursor.getFloat(cursor.getColumnIndexOrThrow("thick_threshold"));
                if (Float.isFinite(threshold) && threshold > 0) result.put("thickThreshold", threshold * 4.0 / 5.0);
            }
        } catch (Exception unavailable) {
            // Manual calibration and explicit fine/thick selection remain available.
        }
        // ThresholdPopu reset reads these exact factory properties, in physical pixels.
        JSObject defaults = new JSObject();
        String[][] fields = {{"palm", "persist.sys.whiteboard.threshold"}, {"fine", "persist.sys.whiteboard.pen_threshold"}, {"thick", "persist.sys.whiteboard.thick_threshold"}};
        for (String[] field : fields) {
            try {
                String raw = (String)Class.forName("android.os.SystemProperties").getMethod("get", String.class, String.class).invoke(null, field[1], "");
                float value = Float.parseFloat(raw);
                if (Float.isFinite(value) && value > 0) defaults.put(field[0], value);
            } catch (Exception unavailable) { /* No factory default for this contact on this device. */ }
        }
        result.put("factoryThresholds", defaults);
        call.resolve(result);
    }

    /** Capture only this app's visible WebView, including Office frames and transparent ink. */
    @PluginMethod
    public void captureFrame(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                boolean resourceOpen = webResource != null && webResource.isShowing();
                android.webkit.WebView view = resourceOpen ? webResource.web : getBridge().getWebView();
                android.view.Window window = resourceOpen ? webResource.getWindow() : getActivity().getWindow();
                int[] location = new int[2]; view.getLocationInWindow(location);
                JSObject region = call.getObject("region");
                double x = region == null ? 0 : region.optDouble("x", 0);
                double y = region == null ? 0 : region.optDouble("y", 0);
                double w = region == null ? 1 : region.optDouble("width", 1);
                double h = region == null ? 1 : region.optDouble("height", 1);
                if (!Double.isFinite(x + y + w + h) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.001 || y + h > 1.001 || view.getWidth() == 0 || view.getHeight() == 0) {
                    call.reject("截图范围无效"); return;
                }
                Rect area = new Rect(location[0] + (int)(x * view.getWidth()), location[1] + (int)(y * view.getHeight()), location[0] + (int)((x + w) * view.getWidth()), location[1] + (int)((y + h) * view.getHeight()));
                double scale = Math.min(1, 1280.0 / Math.max(area.width(), area.height()));
                Bitmap bitmap = Bitmap.createBitmap(Math.max(1, (int)(area.width() * scale)), Math.max(1, (int)(area.height() * scale)), Bitmap.Config.ARGB_8888);
                PixelCopy.request(window, area, bitmap, status -> {
                    if (imageEncoder.isShutdown()) { bitmap.recycle(); return; }
                    if (status != PixelCopy.SUCCESS) { bitmap.recycle(); call.reject("当前画面尚未准备好，请稍后重试"); return; }
                    imageEncoder.execute(() -> {
                        try {
                            ByteArrayOutputStream output = new ByteArrayOutputStream();
                            bitmap.compress(Bitmap.CompressFormat.JPEG, 85, output);
                            JSObject result = new JSObject(); result.put("image", "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
                            call.resolve(result);
                        } catch (Exception error) { call.reject("画面捕获失败", error); }
                        finally { bitmap.recycle(); }
                    });
                }, new Handler(Looper.getMainLooper()));
            } catch (Exception error) { call.reject("画面捕获失败", error); }
        });
    }
    private File directory() {
        File dir = new File(getContext().getFilesDir(), "fcboard-uploads");
        if (!dir.exists()) { dir.mkdirs(); }
        return dir;
    }

    @PluginMethod
    public synchronized void startReceiver(PluginCall call) {
        try {
            List<String> addresses = new ArrayList<>();
            for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!network.isUp() || network.isLoopback()) { continue; }
                for (InetAddress address : Collections.list(network.getInetAddresses())) {
                    if (address instanceof Inet4Address && address.isSiteLocalAddress()) { addresses.add(address.getHostAddress()); }
                }
            }
            if (addresses.isEmpty()) { call.reject("未连接局域网，请先连接 Wi-Fi 或有线网络"); return; }
            if (receiver == null) {
                receiver = new Receiver(directory(), (item) -> {
                    JSObject file = new JSObject();
                    file.put("id", item.getName().substring(0, 36));
                    file.put("name", item.getName().substring(37));
                    file.put("path", item.getAbsolutePath()); file.put("size", item.length());
                    notifyListeners("fileReceived", file, true);
                });
                receiver.start(15000, true);
            }
            JSArray urls = new JSArray();
            for (String address : addresses) { urls.put("http://" + address + ":" + receiver.getListeningPort() + "/" + receiver.token + "/"); }
            JSObject result = new JSObject(); result.put("urls", urls); call.resolve(result);
        } catch (Exception error) {
            if (receiver != null) { receiver.stop(); receiver = null; }
            call.reject("无法开启局域网接收：" + error.getMessage());
        }
    }

    @PluginMethod
    public synchronized void stopReceiver(PluginCall call) {
        if (receiver != null) { receiver.stop(); receiver = null; }
        call.resolve();
    }

    @PluginMethod
    public void listUploads(PluginCall call) {
        JSArray files = new JSArray();
        File[] items = directory().listFiles();
        if (items != null) {
            java.util.Arrays.sort(items, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
            for (File item : items) {
                if (!item.isFile() || !item.getName().matches("[a-f0-9-]{36}_.+")) { continue; }
                JSObject file = new JSObject();
                file.put("id", item.getName().substring(0, 36)); file.put("name", item.getName().substring(37));
                file.put("path", item.getAbsolutePath()); file.put("size", item.length()); files.put(file);
            }
        }
        JSObject result = new JSObject(); result.put("files", files); call.resolve(result);
    }

    @PluginMethod
    public void deleteUpload(PluginCall call) {
        String id = call.getString("id", "");
        if (!id.matches("[a-f0-9-]{36}")) { call.reject("文件 ID 无效"); return; }
        File[] files = directory().listFiles();
        if (files != null) {
            for (File file : files) {
                if (file.getName().startsWith(id + "_") && !file.delete()) { call.reject("文件删除失败"); return; }
            }
        }
        call.resolve();
    }

    private void closeSignalResource() {
        SignalResourceDialog resource = signalResource;
        signalResource = null;
        if (resource != null) getActivity().runOnUiThread(() -> { if (resource.isShowing()) resource.dismiss(); });
    }

    @Override
    protected void handleOnPause() {
        closeSignalResource();
    }

    @Override
    protected synchronized void handleOnDestroy() {
        aiTransport.close();
        closeSignalResource();
        WebResourceDialog resource = webResource;
        webResource = null;
        if (resource != null) getActivity().runOnUiThread(() -> { if (resource.isShowing()) resource.dismiss(); });
        stopBoardShare();
        imageEncoder.shutdownNow();
        if (receiver != null) { receiver.stop(); receiver = null; }
    }

    static final class Receiver extends NanoHTTPD {
        final String token = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        private final File directory;
        private final AtomicInteger receiving = new AtomicInteger();
        private final java.util.function.Consumer<File> onReceived;
        Receiver(File directory) { this(directory, null); }
        Receiver(File directory, java.util.function.Consumer<File> onReceived) {
            super("0.0.0.0", 0); this.directory = directory; this.onReceived = onReceived;
        }

        private Response reply(Response.Status status, String mime, String body) {
            Response response = newFixedLengthResponse(status, mime, body);
            response.addHeader("Cache-Control", "no-store");
            response.addHeader("X-Content-Type-Options", "nosniff");
            response.addHeader("Referrer-Policy", "no-referrer");
            return response;
        }

        @Override
        public Response serve(IHTTPSession session) {
            String base = "/" + token + "/";
            if (!session.getUri().equals(base) && !session.getUri().equals(base + "upload")) { return reply(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "接收地址无效或已关闭"); }
            if (session.getMethod() == Method.GET && session.getUri().equals(base)) {
                return reply(Response.Status.OK, "text/html; charset=utf-8", "<!doctype html><html lang='zh-CN'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>方成教育快传</title><style>body{font:18px system-ui;max-width:560px;margin:60px auto;padding:24px;color:#17243c}button,input{font:inherit;padding:16px;max-width:100%}button{background:#245bd6;color:white;border:0;border-radius:10px}p{line-height:1.8}</style><h1>Fcboard · 方成教育</h1><h2>局域网课件快传</h2><p>手机与白板连同一网络，选好课件立即上屏。支持 PowerPoint、Word、Excel、PDF 和图片，单个文件上限 100 MB。</p><input id='files' type='file' hidden multiple accept='.ppt,.pptx,.pps,.ppsx,.doc,.docx,.xls,.xlsx,.csv,.odt,.ods,.odp,.rtf,.txt,.pdf,.png,.jpg,.jpeg,.webp,.gif'><p><button id='send'>选择文件上屏</button></p><p id='status' role='status'></p><script>const button=document.getElementById('send');const picker=document.getElementById('files');button.onclick=()=>picker.click();picker.onchange=async()=>{const files=picker.files;const status=document.getElementById('status');if(!files.length){status.textContent='请先选择文件';return;}button.disabled=true;try{for(const file of files){if(file.size>104857600)throw Error('文件超过 100 MB');status.textContent='正在发送 '+file.name;const response=await fetch('upload?name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});if(!response.ok)throw Error(await response.text());}status.textContent='已发送到白板，课件将自动上屏';}catch(error){status.textContent='发送失败：'+error.message;}finally{button.disabled=false;picker.value='';}};</script></html>");
            }
            if (session.getMethod() != Method.POST || !session.getUri().equals(base + "upload")) { return reply(Response.Status.METHOD_NOT_ALLOWED, MIME_PLAINTEXT, "不支持此操作"); }
            String name = session.getParms().get("name");
            if (name == null || name.length() > 160 || !name.toLowerCase(java.util.Locale.ROOT).matches(".+\\.(ppt|pptx|pps|ppsx|doc|docx|xls|xlsx|csv|odt|ods|odp|rtf|txt|pdf|png|jpg|jpeg|webp|gif)") || name.contains("/") || name.contains("\\") || name.chars().anyMatch(c -> c < 32)) { return reply(Response.Status.BAD_REQUEST, MIME_PLAINTEXT, "文件名或格式不支持"); }
            long length;
            try { length = Long.parseLong(session.getHeaders().getOrDefault("content-length", "0")); } catch (NumberFormatException error) { length = 0; }
            if (length <= 0 || length > 104857600) { return reply(Response.Status.BAD_REQUEST, MIME_PLAINTEXT, "文件为空或超过 100 MB"); }
            if (directory.getUsableSpace() < length + 52428800) { return reply(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, "白板存储空间不足"); }
            if (!receiving.compareAndSet(0, 1)) { return reply(Response.Status.SERVICE_UNAVAILABLE, MIME_PLAINTEXT, "白板正在接收文件，请稍后重试"); }
            File target = new File(directory, UUID.randomUUID().toString() + "_" + name);
            try {
                File pending = new File(directory, ".pending-" + UUID.randomUUID());
                try (FileOutputStream output = new FileOutputStream(pending)) {
                    InputStream input = session.getInputStream();
                    byte[] buffer = new byte[65536];
                    long remaining = length;
                    while (remaining > 0) {
                        int read = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                        if (read < 0) { throw new IOException("文件传输不完整"); }
                        output.write(buffer, 0, read);
                        remaining -= read;
                    }
                } catch (IOException error) {
                    pending.delete();
                    throw error;
                }
                if (!pending.renameTo(target)) { pending.delete(); throw new IOException("无法保存文件"); }
                if (onReceived != null) { onReceived.accept(target); }
                return reply(Response.Status.OK, MIME_PLAINTEXT, "上传成功");
            } catch (IOException error) {
                target.delete();
                return reply(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, "上传失败，请重试");
            } finally { receiving.set(0); }
        }
    }
}
