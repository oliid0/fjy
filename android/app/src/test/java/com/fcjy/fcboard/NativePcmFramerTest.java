package com.fcjy.fcboard;

import static org.junit.Assert.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;

public class NativePcmFramerTest {
    @Test public void deviceRatesProduceExactTwentyMillisecondFramesAcrossShortReads() {
        for (int rate : new int[]{16000, 44100, 48000}) {
            List<byte[]> frames = new ArrayList<>();
            NativePcmFramer framer = new NativePcmFramer(rate, frames::add);
            short[] samples = new short[rate]; Arrays.fill(samples, (short)-12345);
            for (int offset = 0; offset < samples.length; offset += 137) {
                short[] block = Arrays.copyOfRange(samples, offset, Math.min(samples.length, offset + 137));
                framer.accept(block, block.length);
            }
            assertEquals(50, frames.size());
            for (byte[] frame : frames) {
                assertEquals(640, frame.length);
                ByteBuffer pcm = ByteBuffer.wrap(frame).order(ByteOrder.LITTLE_ENDIAN);
                while (pcm.hasRemaining()) assertEquals(-12345, pcm.getShort());
            }
        }
    }

    @Test public void preservesPartialFrameAndSignedSampleExtremes() {
        List<byte[]> frames = new ArrayList<>();
        NativePcmFramer framer = new NativePcmFramer(16000, frames::add);
        short[] first = new short[319]; Arrays.fill(first, Short.MIN_VALUE);
        framer.accept(first, first.length);
        assertTrue(frames.isEmpty());
        framer.accept(new short[]{Short.MAX_VALUE}, 1);
        ByteBuffer pcm = ByteBuffer.wrap(frames.get(0)).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < 319; i++) assertEquals(Short.MIN_VALUE, pcm.getShort());
        assertEquals(Short.MAX_VALUE, pcm.getShort());
    }
}
