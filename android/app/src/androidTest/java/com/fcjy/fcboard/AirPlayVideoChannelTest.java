package com.fcjy.fcboard;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.airplay.airplay.AirPlayVideoChannel;
import com.airplay.airplay.handshake.PlistCodec;
import com.airplay.airplay.handshake.MirrorStreamServer;
import java.io.DataInputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class AirPlayVideoChannelTest {
    @Test public void fullMirrorQueueRetainsPredictedPicturesUntilTheDecoderConsumesThem() throws Exception {
        MirrorStreamServer server=new MirrorStreamServer(new byte[16],1L,()->null,1280,720,false,
            current->kotlin.Unit.INSTANCE,current->kotlin.Unit.INSTANCE);
        try {
            assertTrue("A decoder that has not started cannot retain the Surface",server.suspendForMedia().isCompleted());
            server.resumeMirror();
            Class<?> configType=Class.forName(MirrorStreamServer.class.getName()+"$Config");
            java.lang.reflect.Constructor<?> configConstructor=configType.getDeclaredConstructor(String.class,byte[].class,byte[].class,int.class,int.class);
            configConstructor.setAccessible(true);
            Object config=configConstructor.newInstance("video/avc",new byte[0],null,1280,720);
            Class<?> frameType=Class.forName(MirrorStreamServer.class.getName()+"$Frame");
            java.lang.reflect.Constructor<?> frameConstructor=frameType.getDeclaredConstructor(byte[].class,configType,long.class);
            frameConstructor.setAccessible(true);
            java.lang.reflect.Field queueField=MirrorStreamServer.class.getDeclaredField("queue");queueField.setAccessible(true);
            @SuppressWarnings("unchecked") java.util.concurrent.BlockingQueue<Object> queue=(java.util.concurrent.BlockingQueue<Object>)queueField.get(server);
            int capacity=queue.remainingCapacity();
            for(int i=0;i<capacity;i++)queue.add(frameConstructor.newInstance(new byte[]{0,0,0,1,0x41,1},config,(long)i));
            Object first=queue.peek(),next=frameConstructor.newInstance(new byte[]{0,0,0,1,0x41,2},config,(long)capacity);
            java.lang.reflect.Field running=MirrorStreamServer.class.getDeclaredField("running");running.setAccessible(true);running.setBoolean(server,true);
            java.lang.reflect.Method enqueue=MirrorStreamServer.class.getDeclaredMethod("enqueue",frameType);enqueue.setAccessible(true);
            java.util.concurrent.CountDownLatch started=new java.util.concurrent.CountDownLatch(1);
            FutureTask<Void> producer=new FutureTask<>(()->{started.countDown();enqueue.invoke(server,next);return null;});
            new Thread(producer,"mirror-queue-regression").start();
            assertTrue(started.await(2,TimeUnit.SECONDS));
            try{producer.get(150,TimeUnit.MILLISECONDS);fail("The predicted picture must wait instead of being discarded");}
            catch(java.util.concurrent.TimeoutException expected){ }
            assertSame(first,queue.poll());producer.get(2,TimeUnit.SECONDS);
            assertEquals(capacity,queue.size());assertSame(next,queue.toArray()[capacity-1]);
            java.lang.reflect.Field dropped=MirrorStreamServer.class.getDeclaredField("framesDropped");dropped.setAccessible(true);
            assertEquals("The prediction chain stays complete",0,dropped.getInt(server));
        } finally { server.stop(); }
    }
    @Test public void expandsCondensedVideoSegmentsAndPreservesRelativePlaylists() {
        String header = "#EXTM3U\n";
        String fields = ":BASE-URI=\"https://media.example/video\",PARAMS=\"sq,range\",PREFIX=\"s/\"\n";
        for (String tag : new String[]{"URL", "URI"}) {
            byte[] source = (header + "#YT-EXT-CONDENSED-" + tag + fields +
                "#EXTINF:5,\ns/12/100-200\nvideo.m3u8\n#EXT-X-ENDLIST").getBytes(StandardCharsets.UTF_8);
            String result = new String(com.airplay.airplay.AirPlayVideoPlayerKt.expandAirPlayPlaylist(source), StandardCharsets.UTF_8);
            assertEquals(header + "#EXTINF:5,\nhttps://media.example/video/sq/12/range/100-200\nvideo.m3u8\n#EXT-X-ENDLIST\n", result);
        }
        byte[] media = {0, 1, 2};
        assertSame(media, com.airplay.airplay.AirPlayVideoPlayerKt.expandAirPlayPlaylist(media));
    }

    @Test public void receivesSenderPlaylistViaEventAndMatchingAction() throws Exception {
        String url = "mlhls://localhost/master.m3u8";
        byte[] playlist = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=12000\nvideo.m3u8\n".getBytes(StandardCharsets.UTF_8);
        InetAddress local = InetAddress.getLoopbackAddress();
        try (ServerSocket listener = new ServerSocket(0, 1, local);
             Socket client = new Socket(local, listener.getLocalPort());
             Socket accepted = listener.accept()) {
            client.setSoTimeout(5000);
            AirPlayVideoChannel channel = new AirPlayVideoChannel(accepted, "phone-session");
            try {
                FutureTask<byte[]> result = new FutureTask<>(() -> channel.fetch(url));
                new Thread(result).start();
                DataInputStream input = new DataInputStream(client.getInputStream());
                assertEquals("POST /event HTTP/1.1", input.readLine());
                int length = 0;
                String line;
                while ((line = input.readLine()) != null && !line.isEmpty()) {
                    if (line.startsWith("Content-Length: ")) length = Integer.parseInt(line.substring(16));
                }
                assertTrue(length > 0 && length < 8192);
                byte[] body = new byte[length];
                input.readFully(body);
                Map<?, ?> event = PlistCodec.INSTANCE.decode(body);
                Map<?, ?> request = (Map<?, ?>) event.get("request");
                assertEquals(url, request.get("FCUP_Response_URL"));
                Map<String,Object> params = new HashMap<>();
                params.put("FCUP_Response_RequestID", request.get("FCUP_Response_RequestID"));
                params.put("FCUP_Response_URL", "mlhls://localhost/other.m3u8");
                params.put("FCUP_Response_StatusCode", 0);
                params.put("FCUP_Response_Data", playlist);
                Map<String,Object> response = new HashMap<>();
                response.put("type", "unhandledURLResponse");
                response.put("params", params);
                assertFalse(channel.complete(response));
                params.put("FCUP_Response_URL", url);
                assertTrue(channel.complete(response));
                assertArrayEquals(playlist, result.get(5, TimeUnit.SECONDS));
            } finally { channel.close(); }
        }
    }
}
