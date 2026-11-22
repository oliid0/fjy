package com.fcjy.fcboard;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.airplay.airplay.AirPlayVideoChannel;
import com.airplay.airplay.handshake.PlistCodec;
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
