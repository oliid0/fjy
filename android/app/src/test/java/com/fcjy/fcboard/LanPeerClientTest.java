package com.fcjy.fcboard;

import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

/** Real native OkHttp clients and the APK relay, including simultaneous writers. */
public class LanPeerClientTest {
    @Test public void tenNativeDevicesWriteConcurrentlyAndEveryDeviceReceivesAllStrokes() throws Exception {
        LanServer server = new LanServer(path -> new ByteArrayInputStream(new byte[0]), ignored -> {});
        List<LanPeerClient> clients = new ArrayList<>();
        List<BlockingQueue<JSONObject>> queues = new ArrayList<>();
        ExecutorService writers = Executors.newFixedThreadPool(10);
        server.start(5000, true);
        try {
            String token = server.startRoom(new JSONObject());
            for (int i=0;i<10;i++) {
                BlockingQueue<JSONObject> queue = new LinkedBlockingQueue<>(); queues.add(queue);
                LanPeerClient client = new LanPeerClient(queue::add); clients.add(client);
                client.connect("writer-"+i, "ws://127.0.0.1:"+server.getListeningPort()+"/board/"+token);
                JSONObject initial = packet(queue);
                assertEquals("initial", initial.getString("kind"));
            }
            CountDownLatch start = new CountDownLatch(1);
            List<Future<?>> pending = new ArrayList<>();
            for (int i=0;i<10;i++) {
                final int index=i;
                JSONObject stroke = new JSONObject().put("id","ink-"+i).put("type","freedraw").put("version",1).put("versionNonce",i)
                    .put("isDeleted",false).put("points",new JSONArray("[[0,0],[20,30]]"));
                String scene = new JSONObject().put("kind","scene").put("elements",new JSONArray().put(stroke)).put("files",new JSONObject()).toString();
                pending.add(writers.submit(() -> { try { start.await(); clients.get(index).send("writer-"+index,scene); }
                    catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IllegalStateException(error); } }));
            }
            start.countDown(); for(Future<?> sent:pending) sent.get(3,TimeUnit.SECONDS);
            for(BlockingQueue<JSONObject> queue:queues) {
                Set<String> seen=new HashSet<>();
                while(seen.size()<10) {
                    JSONArray elements=packet(queue).getJSONArray("elements");
                    for(int i=0;i<elements.length();i++) seen.add(elements.getJSONObject(i).getString("id"));
                }
                assertEquals(10,seen.size());
            }
            assertEquals(10,server.snapshotRoom().getJSONArray("elements").length());
        } finally { writers.shutdownNow(); for(LanPeerClient client:clients) client.close(); server.stop(); }
    }
    private static JSONObject packet(BlockingQueue<JSONObject> queue) throws Exception {
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(4);
        while(System.nanoTime()<deadline) {
            JSONObject event=queue.poll(4,TimeUnit.SECONDS); assertNotNull("Native socket did not receive a packet",event);
            assertNotEquals("Native socket closed before synchronization", "close",event.optString("type"));
            if(event.optString("type").equals("message")) return new JSONObject(event.getString("text"));
        }
        throw new AssertionError("Native packet timeout");
    }
}
