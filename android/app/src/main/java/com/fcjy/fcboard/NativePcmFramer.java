package com.fcjy.fcboard;

import java.util.function.Consumer;

/** Device-rate mono PCM16 -> exact 20ms / 16kHz frames, preserving read tails. */
final class NativePcmFramer {
    private final int inputRate;
    private final Consumer<byte[]> receive;
    private byte[] frame = new byte[640];
    private int offset, phase, count;
    private long sum;

    NativePcmFramer(int inputRate, Consumer<byte[]> receive) {
        if (inputRate < 16000) throw new IllegalArgumentException("Unsupported capture rate");
        this.inputRate = inputRate;
        this.receive = receive;
    }

    void accept(short[] samples, int length) {
        for (int index = 0; index < length; index++) {
            sum += samples[index]; count++; phase += 16000;
            if (phase >= inputRate) {
                int value = (int)Math.round((double)sum / count);
                phase -= inputRate; sum = 0; count = 0;
                frame[offset++] = (byte)value;
                frame[offset++] = (byte)(value >> 8);
                if (offset == frame.length) {
                    byte[] completed = frame;
                    frame = new byte[640]; offset = 0;
                    receive.accept(completed);
                }
            }
        }
    }
}
