package com.fcjy.fcboard;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.util.Log;
import java.io.IOException;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/** Output-only native PCM speaker, independent of ASR and recording microphone ownership. */
final class NativeVoiceAudio implements AutoCloseable {
    private final Consumer<Boolean> speaking;
    private final ScheduledThreadPoolExecutor output = new ScheduledThreadPoolExecutor(1);
    private final AtomicLong queuedBytes = new AtomicLong();
    private volatile boolean closed;
    private volatile long playbackEpoch;
    private volatile AudioTrack speaker;
    private long writtenFrames;
    private Byte carry;

    NativeVoiceAudio(Consumer<Boolean> speaking) { this.speaking = speaking; }

    void play(byte[] pcm) {
        if (closed || pcm.length == 0) return;
        long epoch = playbackEpoch;
        if (queuedBytes.addAndGet(pcm.length) > 24000 * 2 * 120) {
            interrupt(); Log.e("FcboardVoice", "Native playback buffer exceeded120seconds"); return;
        }
        try { output.execute(() -> {
            try {
                if (closed || epoch != playbackEpoch) return;
                byte[] data;
                if (carry == null && pcm.length % 2 == 0) data = pcm;
                else {
                    byte[] combined = new byte[pcm.length + (carry == null ? 0 : 1)];
                    int start = carry == null ? 0 : 1;
                    if (carry != null) combined[0] = carry;
                    System.arraycopy(pcm, 0, combined, start, pcm.length);
                    carry = combined.length % 2 == 0 ? null : combined[combined.length - 1];
                    data = java.util.Arrays.copyOf(combined, combined.length - combined.length % 2);
                }
                if (data.length == 0) return;
                AudioTrack track = speaker;
                if (track == null) {
                    int minimum = AudioTrack.getMinBufferSize(24000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
                    if (minimum <= 0) throw new IOException("Native speaker format unsupported");
                    track = new AudioTrack.Builder()
                        .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                        .setAudioFormat(new AudioFormat.Builder().setSampleRate(24000).setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                        .setTransferMode(AudioTrack.MODE_STREAM).setBufferSizeInBytes(Math.max(minimum, 4800)).build();
                    if (track.getState() != AudioTrack.STATE_INITIALIZED) { track.release(); throw new IOException("Native speaker initialization failed"); }
                    synchronized (this) {
                        if (closed) { track.release(); return; }
                        speaker = track;
                    }
                }
                if (closed || epoch != playbackEpoch) return;
                track.play(); speaking.accept(true);
                int offset = 0;
                while (offset < data.length && !closed && epoch == playbackEpoch) {
                    int count = track.write(data, offset, data.length - offset, AudioTrack.WRITE_BLOCKING);
                    if (count <= 0) throw new IOException("Native playback write failed: " + count);
                    offset += count;
                }
                if (epoch != playbackEpoch) return;
                writtenFrames += offset / 2;
                awaitPlayback(epoch, writtenFrames);
            } catch (Exception error) {
                // Speaker failures never stop the microphone or socket.
                Log.e("FcboardVoice", "Native playback failed", error);
                speaking.accept(false);
            } finally {
                if (epoch == playbackEpoch) queuedBytes.addAndGet(-pcm.length);
            }
        }); } catch (RejectedExecutionException ignored) { /* Session closed while PCM arrived. */ }
    }

    private void awaitPlayback(long epoch, long frames) {
        output.schedule(() -> {
            AudioTrack track = speaker;
            if (closed || epoch != playbackEpoch || frames != writtenFrames || track == null) return;
            if ((track.getPlaybackHeadPosition() & 0xffffffffL) >= frames) speaking.accept(false);
            else awaitPlayback(epoch, frames);
        }, 20, TimeUnit.MILLISECONDS);
    }

    void interrupt() {
        playbackEpoch++;
        output.getQueue().clear();
        queuedBytes.set(0);
        AudioTrack track = speaker;
        if (track != null) {
            try { track.pause(); track.flush(); } catch (IllegalStateException ignored) {}
        }
        if (!closed) {
            try { output.execute(() -> { writtenFrames = 0; carry = null; speaking.accept(false); }); }
            catch (RejectedExecutionException ignored) { /* Concurrent close owns cleanup. */ }
        }
    }

    @Override public synchronized void close() {
        if (closed) return;
        closed = true; playbackEpoch++;
        AudioTrack track = speaker; speaker = null;
        if (track != null) {
            try { track.pause(); track.flush(); } catch (IllegalStateException ignored) {}
        }
        output.shutdownNow();
        if (track != null) track.release();
    }
}
