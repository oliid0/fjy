package com.fcjy.fcboard;

import android.content.Context;
import android.os.Build;
import android.util.AtomicFile;
import io.github.muntashirakon.adb.AbsAdbConnectionManager;
import io.github.muntashirakon.adb.AdbStream;
import java.io.Closeable;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.KeyFactory;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.PrivateKey;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.util.Date;
import java.math.BigInteger;
import java.security.SecureRandom;
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder;
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
import javax.security.auth.x500.X500Principal;

/** ADB TLS/pairing comes from LibADB; Scrcpy framing follows the pinned 3.3.1 server. */
final class ScrcpyBridge implements Closeable {
    interface PacketSink { void send(int channel, byte[] bytes) throws IOException; }
    private static final String SERVER = "/data/local/tmp/fcboard-scrcpy-3.3.1.jar";
    private final Context context;
    private final String host;
    private final ExecutorService io = Executors.newCachedThreadPool();
    private final AtomicLong generation = new AtomicLong();
    private AbsAdbConnectionManager adb;
    private volatile AdbStream shell;
    private volatile AdbStream video;
    private volatile AdbStream controls;
    private volatile OutputStream controlOutput;

    ScrcpyBridge(Context context, String host) { this.context = context; this.host = host; }

    private AbsAdbConnectionManager identity() throws Exception {
        // LibADB's legacy AUTH uses raw private RSA (Cipher NoPadding), so use its
        // documented software identity, stored atomically in this app's private files.
        AtomicFile identity = new AtomicFile(new File(context.getFilesDir(), "adb-identity"));
        byte[] encodedKey;
        byte[] encodedCertificate;
        try (DataInputStream input = new DataInputStream(identity.openRead())) {
            int keySize = input.readInt(); if (keySize < 1 || keySize > 8192) throw new IOException("ADB identity is invalid");
            encodedKey = new byte[keySize]; input.readFully(encodedKey);
            int certSize = input.readInt(); if (certSize < 1 || certSize > 8192) throw new IOException("ADB certificate is invalid");
            encodedCertificate = new byte[certSize]; input.readFully(encodedCertificate);
        } catch (java.io.FileNotFoundException firstUse) {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(2048);
            java.security.KeyPair keys = generator.generateKeyPair();
            X500Principal subject = new X500Principal("CN=Fcboard");
            encodedCertificate = new JcaX509v3CertificateBuilder(subject, new BigInteger(128, new SecureRandom()), new Date(0), new Date(4102444800000L), subject, keys.getPublic())
                .build(new JcaContentSignerBuilder("SHA256withRSA").build(keys.getPrivate())).getEncoded();
            encodedKey = keys.getPrivate().getEncoded();
            FileOutputStream file = identity.startWrite();
            try {
                DataOutputStream output = new DataOutputStream(file);
                output.writeInt(encodedKey.length); output.write(encodedKey); output.writeInt(encodedCertificate.length); output.write(encodedCertificate); output.flush();
                identity.finishWrite(file);
            } catch (Exception error) { identity.failWrite(file); throw error; }
        }
        PrivateKey key = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(encodedKey));
        Certificate certificate = CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(encodedCertificate));
        AbsAdbConnectionManager manager = new AbsAdbConnectionManager() {
            @Override protected PrivateKey getPrivateKey() { return key; }
            @Override protected Certificate getCertificate() { return certificate; }
            @Override protected String getDeviceName() { return "Fcboard"; }
        };
        manager.setApi(Build.VERSION.SDK_INT);
        manager.setTimeout(15, TimeUnit.SECONDS);
        manager.setThrowOnUnauthorised(true);
        return manager;
    }

    synchronized void connect(int pairPort, String code, int port) throws Exception {
        if (port < 1 || port > 65535) throw new IllegalArgumentException("请输入无线调试主页的连接端口");
        if (!code.isEmpty() && (!code.matches("[0-9]{6}") || pairPort < 1 || pairPort > 65535)) throw new IllegalArgumentException("请输入配对对话框中的端口和六位配对码");
        close();
        if (adb == null) adb = identity();
        try {
            if (!code.isEmpty() && !adb.pair(host, pairPort, code)) throw new IOException("安卓配对失败，请保持配对对话框打开");
            if (!adb.connect(host, port)) throw new IOException("ADB 未连接，请核对连接端口；它与配对端口不同");
        } catch (Exception error) { close(); throw error; }
    }

    private static void syncHeader(OutputStream out, String id, int value) throws IOException {
        out.write(id.getBytes(StandardCharsets.US_ASCII));
        out.write(ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(value).array());
    }

    private void push(AbsAdbConnectionManager connection) throws Exception {
        try (AdbStream stream = connection.openStream("sync:"); InputStream source = context.getAssets().open("scrcpy/server-3.3.1.jar")) {
            OutputStream out = stream.openOutputStream();
            byte[] name = (SERVER + ",33188").getBytes(StandardCharsets.UTF_8);
            syncHeader(out, "SEND", name.length); out.write(name);
            byte[] buffer = new byte[65536]; int count;
            while ((count = source.read(buffer)) != -1) { syncHeader(out, "DATA", count); out.write(buffer, 0, count); }
            syncHeader(out, "DONE", (int)(System.currentTimeMillis() / 1000)); out.flush();
            DataInputStream input = new DataInputStream(stream.openInputStream());
            byte[] status = new byte[4]; input.readFully(status);
            int length = Integer.reverseBytes(input.readInt());
            if (!"OKAY".equals(new String(status, StandardCharsets.US_ASCII))) {
                byte[] detail = new byte[Math.max(0, Math.min(length, 4096))]; input.readFully(detail);
                throw new IOException("Scrcpy 部署失败：" + new String(detail, StandardCharsets.UTF_8));
            }
            syncHeader(out, "QUIT", 0); out.flush();
        }
    }

    void stream(PacketSink sink, Consumer<String> failure) throws IOException {
        AbsAdbConnectionManager connection = adb;
        if (connection == null || !connection.isConnected()) throw new IOException("请先配对并连接无线调试");
        stopStream();
        long active = generation.get();
        StringBuilder diagnostics = new StringBuilder();
        io.execute(() -> {
            try {
                push(connection);
                String scid = String.format(java.util.Locale.ROOT, "%08x", new java.security.SecureRandom().nextInt() & 0x7fffffff);
                // Baseline profile is required by the bundled TinyH264 software decoder.
                shell = connection.openStream("shell:CLASSPATH=" + SERVER + " app_process / com.genymobile.scrcpy.Server 3.3.1 scid=" + scid +
                    " tunnel_forward=true audio=false control=true clipboard_autosync=false send_dummy_byte=false send_device_meta=false max_size=1280 max_fps=30 video_bit_rate=4000000 video_codec_options=profile:int=1,level:int=4096");
                AdbStream command = shell;
                io.execute(() -> {
                    try (InputStream output = command.openInputStream()) {
                        byte[] buffer = new byte[2048];
                        int count;
                        while ((count = output.read(buffer)) != -1) {
                            String message = new String(buffer, 0, count, StandardCharsets.UTF_8);
                            synchronized (diagnostics) { diagnostics.append(message); if (diagnostics.length() > 2048) diagnostics.delete(0, diagnostics.length() - 2048); }
                            if (active == generation.get() && message.contains("INJECT_EVENTS")) failure.accept("系统禁止远程触摸，请在该设备的开发者选项中允许调试输入控制");
                        }
                    } catch (IOException ignored) { }
                });
                Exception last = null;
                for (int attempt = 0; attempt < 40 && active == generation.get(); attempt++) {
                    try { video = connection.openStream("localabstract:scrcpy_" + scid); break; }
                    catch (Exception error) { last = error; Thread.sleep(150); }
                }
                if (active != generation.get()) return;
                if (video == null) throw new IOException("Scrcpy 未能启动，请确认设备允许无线调试与屏幕捕获", last);
                controls = connection.openStream("localabstract:scrcpy_" + scid);
                controlOutput = controls.openOutputStream();
                AdbStream control = controls;
                io.execute(() -> {
                    try (InputStream input = control.openInputStream()) {
                        byte[] buffer = new byte[4096];
                        while (input.read(buffer) != -1) { /* Clipboard autosync is off; paste uses sequence zero. */ }
                    } catch (IOException ignored) { }
                });
                DataInputStream input = new DataInputStream(video.openInputStream());
                byte[] metadata = new byte[12]; input.readFully(metadata); sink.send(0, metadata);
                while (active == generation.get()) {
                    byte[] header = new byte[12]; input.readFully(header);
                    int size = ByteBuffer.wrap(header, 8, 4).getInt();
                    if (size < 1 || size > 8 * 1024 * 1024) throw new IOException("Scrcpy 视频帧无效");
                    byte[] packet = new byte[12 + size]; System.arraycopy(header, 0, packet, 0, 12);
                    input.readFully(packet, 12, size); sink.send(0, packet);
                }
            } catch (Exception error) {
                if (active == generation.get()) {
                    String detail; synchronized (diagnostics) { detail = diagnostics.toString(); }
                    failure.accept("投屏失败：" + error.getMessage() + (detail.isEmpty() ? "" : "\n" + detail)); stopStream();
                }
            }
        });
    }

    synchronized void control(byte[] bytes) throws IOException {
        if (controlOutput == null) throw new IOException("画面尚未连接");
        controlOutput.write(bytes); controlOutput.flush();
    }

    synchronized void stopStream() {
        generation.incrementAndGet(); controlOutput = null;
        for (AdbStream stream : new AdbStream[]{video, controls, shell}) {
            if (stream != null) try { stream.close(); } catch (IOException ignored) { }
        }
        video = null; controls = null; shell = null;
    }
    @Override public synchronized void close() {
        stopStream();
        if (adb != null) try { adb.disconnect(); } catch (IOException ignored) { }
    }
    void dispose() { close(); io.shutdownNow(); }
}
