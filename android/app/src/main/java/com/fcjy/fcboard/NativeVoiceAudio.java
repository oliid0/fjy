package com.fcjy.fcboard;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.NoiseSuppressor;
import android.os.Process;
import android.util.Log;
import java.io.IOException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/** Real microphone and speaker stay native even while WebView/model tools are busy. */
final class NativeVoiceAudio implements AutoCloseable {
    private final Context context;
    private final Consumer<byte[]> input;
    private final Consumer<String> inputFailure;
    private final Consumer<Boolean> speaking;
    private final ScheduledThreadPoolExecutor output = new ScheduledThreadPoolExecutor(1);
    private final AtomicLong queuedBytes = new AtomicLong();
    private volatile boolean closed;
    private volatile long playbackEpoch;
    private volatile AudioRecord recorder;
    private volatile AudioTrack speaker;
    private AcousticEchoCanceler echo;
    private NoiseSuppressor noise;
    private Thread capture;
    private long writtenFrames;
    private Byte carry;

    NativeVoiceAudio(Context context, Consumer<byte[]> input, Consumer<String> inputFailure, Consumer<Boolean> speaking) {
        this.context = context.getApplicationContext();
        this.input = input; this.inputFailure = inputFailure; this.speaking = speaking;
    }

    void startCapture() throws Exception {
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            throw new SecurityException("Microphone permission denied");
        }
        Exception failure = null;
        for (int rate : new int[]{16000, 48000, 44100}) {
            if (closed) throw new IOException("Native capture cancelled");
            int minimum = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (minimum <= 0) continue;
            for (int source : new int[]{MediaRecorder.AudioSource.VOICE_COMMUNICATION, MediaRecorder.AudioSource.MIC}) {
                AudioRecord candidate = null;
                try {
                    candidate = new AudioRecord.Builder().setAudioSource(source)
                        .setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build())
                        .setBufferSizeInBytes(Math.max(minimum * 2, rate / 5)).build();
                    if (candidate.getState() != AudioRecord.STATE_INITIALIZED) throw new IOException("Microphone initialization failed");
                    candidate.startRecording();
                    if (candidate.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) throw new IOException("Microphone did not start");
                    synchronized (this) {
                        if (closed) throw new IOException("Native capture cancelled");
                        recorder = candidate;
                    }
                } catch (Exception error) {
                    failure = error;
                    if (candidate != null) candidate.release();
                    if (closed) throw new IOException("Native capture cancelled", error);
                    continue;
                }
                try { startReader(rate); return; }
                catch (Exception error) { stopCapture(); throw error; }
            }
        }
        close();
        throw new IOException("Native microphone unavailable", failure);
    }

    private void startReader(int rate) throws Exception {
        AudioRecord source;
        CountDownLatch first = new CountDownLatch(1);
        String[] captureError = {null};
        synchronized (this) {
            source = recorder;
            if (closed || source == null) throw new IOException("Native capture cancelled");
            if (AcousticEchoCanceler.isAvailable()) {
                try { echo = AcousticEchoCanceler.create(source.getAudioSessionId()); if (echo != null) echo.setEnabled(true); }
                catch (RuntimeException error) { Log.w("FcboardVoice", "Echo cancellation unavailable", error); }
            }
            if (NoiseSuppressor.isAvailable()) {
                try { noise = NoiseSuppressor.create(source.getAudioSessionId()); if (noise != null) noise.setEnabled(true); }
                catch (RuntimeException error) { Log.w("FcboardVoice", "Noise suppression unavailable", error); }
            }
            NativePcmFramer frames = new NativePcmFramer(rate, (frame) -> {
                first.countDown();
                if (!closed) input.accept(frame);
            });
            capture = new Thread(() -> {
                Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
                short[] samples = new short[rate / 50];
                try {
                    while (!closed && recorder == source) {
                        int count = source.read(samples, 0, samples.length, AudioRecord.READ_BLOCKING);
                        if (count < 0) throw new IOException("Microphone read failed: " + count);
                        if (count > 0) frames.accept(samples, count);
                        else Thread.sleep(10);
                    }
                } catch (Exception failure) {
                    captureError[0] = failure.getMessage();
                    if (!closed && recorder == source) inputFailure.accept("Native microphone: " + captureError[0]);
                } finally { first.countDown(); }
            }, "FcboardMicrophone");
            capture.start();
        }
        if (!first.await(8, TimeUnit.SECONDS) || captureError[0] != null || closed || recorder != source) {
            throw new IOException(captureError[0] == null ? "Microphone produced no PCM" : captureError[0]);
        }
    }

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

    void stopCapture() {
        AudioRecord source;
        synchronized (this) { source = recorder; recorder = null; }
        if (source != null) {
            try { source.stop(); } catch (IllegalStateException ignored) {}
        }
        if (capture != null && capture != Thread.currentThread()) {
            try { capture.join(1000); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        }
        if (echo != null) { echo.release(); echo = null; }
        if (noise != null) { noise.release(); noise = null; }
        if (source != null) source.release();
        capture = null;
    }

    @Override public synchronized void close() {
        if (closed) return;
        closed = true; playbackEpoch++;
        stopCapture();
        AudioTrack track = speaker; speaker = null;
        if (track != null) {
            try { track.pause(); track.flush(); } catch (IllegalStateException ignored) {}
        }
        output.shutdownNow();
        if (track != null) track.release();
    }
}
