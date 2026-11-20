package com.airplay.dlna.transport;

import java.io.Closeable;
import java.io.IOException;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** One advertised IPv4 interface. The HTTP listener and SSDP LOCATION always use the same address. */
public final class DlnaEndpoint implements Closeable {
    private static final int PORT = 1900;
    private static final String RENDERER = "urn:schemas-upnp-org:device:MediaRenderer:1";
    private final ServerSocket http = new ServerSocket();
    private final MulticastSocket discovery = new MulticastSocket(null);
    private final InetSocketAddress group = new InetSocketAddress("239.255.255.250", PORT);
    private final ExecutorService listeners = Executors.newFixedThreadPool(2);
    private final ThreadPoolExecutor clients = new ThreadPoolExecutor(0, 6, 10, TimeUnit.SECONDS, new SynchronousQueue<>());
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    private final Set<Socket> open = ConcurrentHashMap.newKeySet();
    private final String uuid = "uuid:" + ManualDlnaHttp.getUdn();
    private final List<String> targets = Arrays.asList("upnp:rootdevice", uuid, RENDERER,
        ManualDlnaHttp.AVT, ManualDlnaHttp.RC, ManualDlnaHttp.CM);
    private volatile boolean closed;
    private String location;

    public DlnaEndpoint(String address) throws IOException {
        try {
            InetAddress ip = InetAddress.getByName(address);
            NetworkInterface nic = NetworkInterface.getByInetAddress(ip);
            if (nic == null) throw new IOException("Network interface disappeared");
            http.bind(new InetSocketAddress(ip, 0), 8);
            discovery.setReuseAddress(true);
            discovery.bind(new InetSocketAddress(PORT));
            discovery.setNetworkInterface(nic);
            discovery.setTimeToLive(2);
            discovery.joinGroup(group, nic);
            location = "http://" + address + ":" + http.getLocalPort() + ManualDlnaHttp.getBase() + "/desc";
            listeners.execute(this::accept);
            listeners.execute(this::discover);
            timer.scheduleWithFixedDelay(() -> announce(true), 0, 30, TimeUnit.SECONDS);
        } catch (IOException | RuntimeException error) {
            close();
            throw error;
        }
    }

    private void accept() {
        while (!closed) {
            try {
                Socket socket = http.accept();
                socket.setSoTimeout(4000);
                open.add(socket);
                try {
                    clients.execute(() -> {
                        try (Socket peer = socket) {
                            DlnaRequest request = DlnaRequest.read(peer);
                            if (!closed && request != null) serve(peer, request);
                        } catch (IOException | RuntimeException ignored) {
                            // This request does not own the player or either listener.
                        } finally { open.remove(socket); }
                    });
                } catch (RejectedExecutionException busy) {
                    open.remove(socket);
                    socket.close();
                }
            } catch (IOException unavailable) { if (closed || http.isClosed()) return; }
        }
    }

    private void serve(Socket peer, DlnaRequest request) throws IOException {
        String path = request.uri.getPath();
        if (path == null) return;
        String status = "404 Not Found", xml = "", headers = "";
        if (request.method.equals("GET") || request.method.equals("HEAD")) {
            if (ManualDlnaHttp.isDeviceDesc(path)) xml = ManualDlnaHttp.deviceDescriptorXml();
            else if (ManualDlnaHttp.isScpd(path)) xml = ManualDlnaHttp.scpdXml(path);
            if (xml != null && !xml.isEmpty()) status = "200 OK";
        } else if (request.method.equals("POST") && ManualDlnaHttp.isAction(path)) {
            String result = ManualDlnaHttp.handleAction(path, new String(request.body, StandardCharsets.UTF_8));
            status = result == null ? "500 Internal Server Error" : "200 OK";
            xml = ManualDlnaHttp.wrapEnvelope(result == null ? ManualDlnaHttp.takeFaultBody() : result);
        } else if (ManualDlnaHttp.isService(path) && path.endsWith("/event")) {
            String service = ManualDlnaHttp.serviceOf(path);
            if (!Arrays.asList("AVTransport", "RenderingControl", "ConnectionManager").contains(service)) return;
            String sid = request.header("sid");
            status = "412 Precondition Failed";
            if (request.method.equals("UNSUBSCRIBE")) {
                if (!sid.isEmpty() && sid.equals(GenaNotifier.currentSid(service))) {
                    GenaNotifier.unsubscribe(service);
                    status = "200 OK";
                }
            } else if (request.method.equals("SUBSCRIBE")) {
                boolean accepted = false;
                if (sid.isEmpty()) {
                    String callback = request.header("callback");
                    if (request.header("nt").equalsIgnoreCase("upnp:event") && callback.startsWith("<") && callback.endsWith(">")) {
                        String url = callback.substring(1, callback.length() - 1);
                        sid = "uuid:" + UUID.randomUUID();
                        if (peer.getInetAddress().getHostAddress().equals(URI.create(url).getHost())) {
                            accepted = GenaNotifier.register(service, url, sid, 1800);
                        }
                    }
                } else if (sid.equals(GenaNotifier.currentSid(service))) accepted = GenaNotifier.renew(service, 1800);
                if (accepted) {
                    status = "200 OK";
                    headers = "SID: " + sid + "\r\nTIMEOUT: Second-1800\r\n";
                }
            }
        }
        byte[] payload = (xml == null ? "" : xml).getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + status + "\r\nConnection: close\r\nContent-Type: text/xml; charset=utf-8\r\n"
            + headers + "Content-Length: " + payload.length + "\r\n\r\n";
        peer.getOutputStream().write(head.getBytes(StandardCharsets.US_ASCII));
        if (!request.method.equals("HEAD")) peer.getOutputStream().write(payload);
    }

    private void discover() {
        byte[] data = new byte[4096];
        while (!closed) {
            DatagramPacket packet = new DatagramPacket(data, data.length);
            try {
                discovery.receive(packet);
                String message = new String(data, 0, packet.getLength(), StandardCharsets.US_ASCII);
                String[] lines = message.split("\r\n");
                if (lines.length == 0 || !"M-SEARCH * HTTP/1.1".equalsIgnoreCase(lines[0])) continue;
                String search = "", man = "";
                for (String line : lines) {
                    int split = line.indexOf(':');
                    if (split < 0) continue;
                    String key = line.substring(0, split).trim();
                    if ("ST".equalsIgnoreCase(key)) search = line.substring(split + 1).trim();
                    if ("MAN".equalsIgnoreCase(key)) man = line.substring(split + 1).trim();
                }
                if (!man.equalsIgnoreCase("\"ssdp:discover\"")) continue;
                for (String target : targets) {
                    if (search.equalsIgnoreCase("ssdp:all") || search.equalsIgnoreCase(target))
                        send(packet.getSocketAddress(), "HTTP/1.1 200 OK\r\nEXT:\r\nST: " + target + "\r\n" + identity(target));
                }
            } catch (IOException failure) { if (closed || discovery.isClosed()) return; }
        }
    }

    private String identity(String target) {
        return "USN: " + uuid + (target.equals(uuid) ? "" : "::" + target) + "\r\nLOCATION: " + location +
            "\r\nCACHE-CONTROL: max-age=120\r\nSERVER: Android/1 UPnP/1.0 Fcboard/1\r\n\r\n";
    }

    private void announce(boolean alive) {
        if (location == null) return;
        for (String target : targets) {
            try {
                send(group, "NOTIFY * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nNT: " + target +
                    "\r\nNTS: ssdp:" + (alive ? "alive" : "byebye") + "\r\n" + identity(target));
            } catch (IOException ignored) { return; }
        }
    }

    private void send(SocketAddress dest, String message) throws IOException {
        byte[] data = message.getBytes(StandardCharsets.US_ASCII);
        discovery.send(new DatagramPacket(data, data.length, dest));
    }

    @Override public void close() {
        closed = true;
        timer.shutdownNow();
        announce(false);
        discovery.close();
        try { http.close(); } catch (IOException ignored) {}
        for (Socket socket : open) try { socket.close(); } catch (IOException ignored) {}
        clients.shutdownNow();
        listeners.shutdownNow();
    }
}
