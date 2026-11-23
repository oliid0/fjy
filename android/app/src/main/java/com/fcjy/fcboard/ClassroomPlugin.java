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

    /** Settings owns developer-mode consent and the wireless-debugging switch. */
    @PluginMethod
    public void openDebugSettings(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                android.content.ContentResolver resolver = getContext().getContentResolver();
                boolean enabled = android.provider.Settings.Global.getInt(resolver,
                    android.provider.Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1;
                String settings = "com.android.settings";
                java.util.List<android.content.Intent> pages = new java.util.ArrayList<>();
                if (enabled) {
                    android.content.Intent developer = new android.content.Intent(
                        android.provider.Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS).setPackage(settings);
                    android.content.ComponentName page = developer.resolveActivity(getContext().getPackageManager());
                    if (page != null && settings.equals(page.getPackageName()) &&
                            (page.getClassName().endsWith("$DevelopmentSettingsDashboardActivity") ||
                             page.getClassName().endsWith("$DevelopmentSettingsActivity") ||
                             page.getClassName().endsWith(".DevelopmentSettings"))) {
                        android.os.Bundle args = new android.os.Bundle();
                        args.putString(":settings:fragment_args_key", "toggle_adb_wireless");
                        developer.putExtra(":settings:show_fragment_args", args);
                        developer.putExtra(":settings:fragment_args_key", "toggle_adb_wireless");
                        pages.add(developer.setComponent(page));
                    }
                }
                for (String name : new String[] {"Settings$SystemDashboardActivity", "Settings$SystemManagementActivity"}) {
                    pages.add(new android.content.Intent(android.content.Intent.ACTION_MAIN).setPackage(settings)
                        .setClassName(settings, settings + "." + name));
                }
                for (android.content.Intent intent : pages) {
                    try {
                        getActivity().startActivity(intent);
                        JSObject result = new JSObject(); result.put("enabled", enabled);
                        call.resolve(result);
                        return;
                    } catch (android.content.ActivityNotFoundException | SecurityException unavailable) {
                        // OEM settings may omit a page; continue to the next system entry.
                    }
                }
                call.reject("System settings are unavailable on this device");
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

    @PluginMethod public void agentCapabilities(PluginCall call) { call.resolve(new JSObject().put("nativeStep", true)); }

    @PluginMethod public void postAgentStep(PluginCall call) {
        try {
            JSObject inputHeaders = call.getObject("headers", new JSObject());
            java.util.Map<String, String> headers = new java.util.HashMap<>();
            headers.put("Content-Type", "application/json");
            headers.put("Authorization", inputHeaders.getString("Authorization", ""));
            NativeAgentResponse response = new NativeAgentResponse();
            aiTransport.start(call.getString("id"), call.getString("url"), headers, call.getString("body"), new AIStreamTransport.Callback() {
                public void chunk(String text) {
                    try { response.accept(text); }
                    catch (Exception error) { throw new IllegalStateException(error.getMessage(), error); }
                }
                public void complete(int status, String data, boolean stream) {
                    try {
                        String result = stream ? response.finish().toString() : data;
                        call.resolve(new JSObject().put("status", status).put("data", result).put("stream", false));
                    } catch (Exception error) { call.reject("Agent response failed", error); }
                }
                public void failed(Exception error) { call.reject("Agent request failed", error); }
            });
        } catch (Exception error) { call.reject("Agent request unavailable", error); }
    }

    private WebResourceDialog webResource;

    @PluginMethod
    public void openWebResource(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                String url = WebResourceDialog.checkedUrl(call.getString("url"));
                if (webResource != null) webResource.dismiss();
                webResource = new WebResourceDialog(getActivity(), url, call.getString("language", java.util.Locale.getDefault().toLanguageTag()), selected -> notifyListeners("webSelection", selected), call.getBoolean("teaching", false));
                webResource.show();
                call.resolve();
            } catch (Exception error) { call.reject("Unable to open the teaching page: " + error.getMessage(), error); }
        });
    }

    @PluginMethod
    public void webResourceAction(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (webResource == null || !webResource.isShowing()) { call.reject("Open a teaching page first"); return; }
            webResource.action(call.getData(), call);
        });
    }
    private Receiver receiver;
    private SignalResourceDialog signalResource;
    private final java.util.concurrent.ExecutorService inputDiscovery = java.util.concurrent.Executors.newSingleThreadExecutor(
        task -> new Thread(task, "tv-input-discovery"));
    @PluginMethod
    public void getFactoryInsertions(PluginCall call) {
        inputDiscovery.execute(() -> listInsertions(call));
    }
    private void listInsertions(PluginCall call) {
        try {
            JSArray available = new JSArray();
            boolean embeddedSignal = !SignalResourceDialog.availableInputs(getContext()).isEmpty();
            available.put("document"); available.put("media");
            if (embeddedSignal) available.put("signal");
            JSArray embedded = new JSArray();
            if (embeddedSignal) embedded.put("signal");
            JSObject result = new JSObject(); result.put("available", available); result.put("embedded", embedded); call.resolve(result);
        } catch (Exception error) { call.reject("Unable to read available insertion apps", error); }
    }

    @PluginMethod
    public void openFactoryInsertion(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                String insertion = call.getString("insertion");
                if ("signal".equals(insertion) && !SignalResourceDialog.availableInputs(getContext()).isEmpty()) {
                    closeSignalResource();
                    signalResource = new SignalResourceDialog(getActivity(), call.getString("language", java.util.Locale.getDefault().toLanguageTag()),
                        call.getBoolean("preferOps", false));
                    signalResource.show();
                    JSObject result = new JSObject(); result.put("embedded", true); call.resolve(result);
                    return;
                }
                call.reject("No signal input is available; check the TV input service and hardware connection");
            } catch (Exception error) { closeSignalResource(); call.reject("Unable to open the insertion app: " + error.getMessage(), error); }
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
            if (pages == null || pages.length() < 1 || pages.length() > 20) throw new IOException("Choose 1 to 20 pages to share");
            List<byte[]> images = new ArrayList<>();
            int total = 0;
            for (int index = 0; index < pages.length(); index++) {
                String value = pages.getString(index);
                if (!value.startsWith("data:image/png;base64,") || value.length() > 14000000) throw new IOException("Invalid shared page format or size");
                byte[] image = Base64.decode(value.substring(22), Base64.DEFAULT);
                if (image.length < 8 || image[0] != (byte)137 || image[1] != 80 || image[2] != 78 || image[3] != 71) throw new IOException("Shared pages must be PNG images");
                total += image.length;
                if (total > 20000000) throw new IOException("Shared images exceed 20 MB; select fewer pages");
                images.add(image);
            }
            List<String> addresses = NetworkPlugin.lanAddresses(getContext());
            if (addresses.isEmpty()) throw new IOException("Connect to a LAN before sharing");
            stopBoardShare();
            PageLocalization.configure(call.getObject("localization"));
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
            if (boardShare == null) throw new IOException("Sharing ended; generate a new QR code");
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
                    getActivity().startActivity(android.content.Intent.createChooser(intent, "Email / share whiteboard"));
                    call.resolve();
                } catch (Exception error) { call.reject("Unable to open an email or sharing app", error); }
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

    /** Capture only this app's visible WebView, including Office frames and transparent ink. */
    @PluginMethod
    public void captureFrame(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                boolean resourceOpen = webResource != null && webResource.isShowing();
                if (!resourceOpen && !((MainActivity)getActivity()).isBoardUsable()) {
                    call.reject("The whiteboard is still loading; try again shortly"); return;
                }
                android.webkit.WebView view = resourceOpen ? webResource.web : getBridge().getWebView();
                android.view.Window window = resourceOpen ? webResource.getWindow() : getActivity().getWindow();
                int[] location = new int[2]; view.getLocationInWindow(location);
                JSObject region = call.getObject("region");
                double x = region == null ? 0 : region.optDouble("x", 0);
                double y = region == null ? 0 : region.optDouble("y", 0);
                double w = region == null ? 1 : region.optDouble("width", 1);
                double h = region == null ? 1 : region.optDouble("height", 1);
                if (!Double.isFinite(x + y + w + h) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.001 || y + h > 1.001 || view.getWidth() == 0 || view.getHeight() == 0) {
                    call.reject("Invalid capture area"); return;
                }
                Rect area = new Rect(location[0] + (int)(x * view.getWidth()), location[1] + (int)(y * view.getHeight()), location[0] + (int)((x + w) * view.getWidth()), location[1] + (int)((y + h) * view.getHeight()));
                double scale = Math.min(1, 1280.0 / Math.max(area.width(), area.height()));
                Bitmap bitmap = Bitmap.createBitmap(Math.max(1, (int)(area.width() * scale)), Math.max(1, (int)(area.height() * scale)), Bitmap.Config.ARGB_8888);
                java.util.function.IntConsumer captured = status -> {
                    if (imageEncoder.isShutdown()) { bitmap.recycle(); return; }
                    if (status != PixelCopy.SUCCESS) { bitmap.recycle(); call.reject("The screen is not ready; try again shortly"); return; }
                    imageEncoder.execute(() -> {
                        try {
                            ByteArrayOutputStream output = new ByteArrayOutputStream();
                            bitmap.compress(Bitmap.CompressFormat.JPEG, 85, output);
                            JSObject result = new JSObject(); result.put("image", "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
                            call.resolve(result);
                        } catch (Exception error) { call.reject("Screen capture failed", error); }
                        finally { bitmap.recycle(); }
                    });
                };
                if (view.isHardwareAccelerated()) {
                    PixelCopy.request(window, area, bitmap, captured::accept, new Handler(Looper.getMainLooper()));
                } else {
                    // Software WebViews have no GPU surface for PixelCopy. Capture
                    // the same bounded region through the actual View drawing path.
                    try {
                        android.graphics.Canvas frame = new android.graphics.Canvas(bitmap);
                        frame.scale((float) scale, (float) scale);
                        frame.translate(-(area.left - location[0]), -(area.top - location[1]));
                        view.draw(frame);
                        captured.accept(PixelCopy.SUCCESS);
                    } catch (RuntimeException | OutOfMemoryError error) {
                        bitmap.recycle();
                        call.reject("This screen cannot be captured; try a smaller area");
                    }
                }
            } catch (OutOfMemoryError error) { call.reject("Insufficient device memory; try a smaller capture area"); }
            catch (Exception error) { call.reject("Screen capture failed", error); }
        });
    }
    private File directory() {
        File dir = new File(getContext().getFilesDir(), "fcboard-uploads");
        if (!dir.exists()) { dir.mkdirs(); }
        return dir;
    }

    @PluginMethod public void setPageLocalization(PluginCall call) {
        try { PageLocalization.configure(call.getObject("localization")); call.resolve(); }
        catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    @PluginMethod
    public synchronized void startReceiver(PluginCall call) {
        try {
            PageLocalization.configure(call.getObject("localization"));
            List<String> addresses = NetworkPlugin.lanAddresses(getContext());
            if (addresses.isEmpty()) { call.reject("Connect to a LAN using Wi-Fi or Ethernet"); return; }
            if (receiver == null) {
                String transferPage;
                try (InputStream input = getContext().getAssets().open("transfer.html")) { java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count; while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count); transferPage = bytes.toString("UTF-8"); }
                receiver = new Receiver(directory(), (item) -> {
                    JSObject file = new JSObject();
                    file.put("id", item.getName().substring(0, 36));
                    file.put("name", item.getName().substring(37));
                    file.put("path", item.getAbsolutePath()); file.put("size", item.length());
                    notifyListeners("fileReceived", file, true);
                }, transferPage);
                receiver.start(15000, true);
            }
            JSArray urls = new JSArray();
            for (String address : addresses) { urls.put("http://" + address + ":" + receiver.getListeningPort() + "/" + receiver.token + "/"); }
            JSObject result = new JSObject(); result.put("urls", urls); call.resolve(result);
        } catch (Exception error) {
            if (receiver != null) { receiver.stop(); receiver = null; }
            call.reject("Unable to start LAN file reception: " + error.getMessage());
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
        if (!id.matches("[a-f0-9-]{36}")) { call.reject("Invalid file ID"); return; }
        File[] files = directory().listFiles();
        if (files != null) {
            for (File file : files) {
                if (file.getName().startsWith(id + "_") && !file.delete()) { call.reject("Unable to delete the file"); return; }
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
        if (resource != null) getActivity().runOnUiThread(resource::dismiss);
        stopBoardShare();
        inputDiscovery.shutdownNow();
        imageEncoder.shutdownNow();
        if (receiver != null) { receiver.stop(); receiver = null; }
    }

    static final class Receiver extends NanoHTTPD {
        final String token = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        private final File directory;
        private final AtomicInteger receiving = new AtomicInteger();
        private final java.util.function.Consumer<File> onReceived;
        private final String page;
        Receiver(File directory, java.util.function.Consumer<File> onReceived, String page) {
            super("0.0.0.0", 0); this.directory = directory; this.onReceived = onReceived; this.page = page;
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
            if (!session.getUri().equals(base) && !session.getUri().equals(base + "upload")) { return reply(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "The reception address is invalid or closed"); }
            if (session.getMethod() == Method.GET && session.getUri().equals(base)) {
                return reply(Response.Status.OK, "text/html; charset=utf-8", PageLocalization.render(page));
            }
            if (session.getMethod() != Method.POST || !session.getUri().equals(base + "upload")) { return reply(Response.Status.METHOD_NOT_ALLOWED, MIME_PLAINTEXT, "Unsupported operation"); }
            String name = session.getParms().get("name");
            if (name == null || name.length() > 160 || !name.toLowerCase(java.util.Locale.ROOT).matches(".+\\.(ppt|pptx|pps|ppsx|doc|docx|xls|xlsx|csv|odt|ods|odp|rtf|txt|pdf|png|jpg|jpeg|webp|gif)") || name.contains("/") || name.contains("\\") || name.chars().anyMatch(c -> c < 32)) { return reply(Response.Status.BAD_REQUEST, MIME_PLAINTEXT, "Unsupported filename or file format"); }
            long length;
            try { length = Long.parseLong(session.getHeaders().getOrDefault("content-length", "0")); } catch (NumberFormatException error) { length = 0; }
            if (length <= 0 || length > 104857600) { return reply(Response.Status.BAD_REQUEST, MIME_PLAINTEXT, "The file is empty or exceeds 100 MB"); }
            if (directory.getUsableSpace() < length + 52428800) { return reply(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, "Insufficient whiteboard storage"); }
            if (!receiving.compareAndSet(0, 1)) { return reply(Response.Status.SERVICE_UNAVAILABLE, MIME_PLAINTEXT, "The board is receiving a file; try again shortly"); }
            File target = new File(directory, UUID.randomUUID().toString() + "_" + name);
            try {
                File pending = new File(directory, ".pending-" + UUID.randomUUID());
                try (FileOutputStream output = new FileOutputStream(pending)) {
                    InputStream input = session.getInputStream();
                    byte[] buffer = new byte[65536];
                    long remaining = length;
                    while (remaining > 0) {
                        int read = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                        if (read < 0) { throw new IOException("Incomplete file transfer"); }
                        output.write(buffer, 0, read);
                        remaining -= read;
                    }
                } catch (IOException error) {
                    pending.delete();
                    throw error;
                }
                if (!pending.renameTo(target)) { pending.delete(); throw new IOException("Unable to save the file"); }
                if (onReceived != null) { onReceived.accept(target); }
                return reply(Response.Status.OK, MIME_PLAINTEXT, "Upload complete");
            } catch (IOException error) {
                target.delete();
                return reply(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, "Upload failed; retry");
            } finally { receiving.set(0); }
        }
    }
}
