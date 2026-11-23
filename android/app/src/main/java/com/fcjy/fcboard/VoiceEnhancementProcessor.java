package com.fcjy.fcboard;

import android.content.res.AssetManager;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import androidx.media3.common.C;
import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.common.util.UnstableApi;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Keeps ExoPlayer's PCM format and total frame count fixed through mode changes. */
@UnstableApi
final class VoiceEnhancementProcessor extends BaseAudioProcessor {
    enum Status { OFF, WAITING, LOADING, ACTIVE, ERROR }

    private static final int MODEL_RATE = 48_000;
    private static final int HOP = 512;
    private static final ThreadPoolExecutor MODEL_WORKER = new ThreadPoolExecutor(
        0, 1, 5, TimeUnit.SECONDS, new LinkedBlockingQueue<>(),
        task -> new Thread(task, "fcboard-voice-model")
    );

    private final AssetManager assets;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable statusChanged;
    private final Runnable releaseAfterFade = this::finishFade;
    private final Object lock = new Object();

    // The playback thread borrows a session for one hop. Creation and disposal run
    // on the worker, and no ORT operation runs while the lifecycle lock is held.
    private Session session;
    private boolean active;
    private boolean closed;
    private boolean failed;
    private boolean loading;
    private int request;
    private int level;

    private Block held = new Block();
    private Block next = new Block();
    private int stream;
    private int phase;

    VoiceEnhancementProcessor(AssetManager assets, Runnable statusChanged) {
        this.assets = assets;
        this.statusChanged = statusChanged;
    }

    int level() {
        synchronized (lock) {
            return level;
        }
    }

    Status status() {
        synchronized (lock) {
            if (level == 0) return Status.OFF;
            if (failed) return Status.ERROR;
            if (loading) return Status.LOADING;
            return session == null ? Status.WAITING : Status.ACTIVE;
        }
    }

    void setLevel(int value) {
        if (value < 0 || value > 3) {
            throw new IllegalArgumentException("Invalid enhancement level");
        }
        synchronized (lock) {
            if (closed || (level == value && !failed)) return;
            level = value;
            failed = false;
            main.removeCallbacks(releaseAfterFade);
            if (level == 0) {
                cancelLoad();
                if (session != null) main.postDelayed(releaseAfterFade, 750);
            } else {
                startLoad();
            }
            publish();
        }
    }

    void setPlaybackActive(boolean value) {
        synchronized (lock) {
            if (closed || active == value) return;
            active = value;
            if (active) {
                startLoad();
            } else {
                cancelLoad();
                retire();
            }
            publish();
        }
    }

    void close() {
        synchronized (lock) {
            closed = true;
            main.removeCallbacks(releaseAfterFade);
            main.removeCallbacks(statusChanged);
            cancelLoad();
            retire();
        }
    }

    private void publish() {
        if (!closed) {
            main.removeCallbacks(statusChanged);
            main.post(statusChanged);
        }
    }

    private void cancelLoad() {
        request++;
        loading = false;
    }

    private void startLoad() {
        if (!active || level == 0 || loading || failed || session != null) return;
        loading = true;
        int ticket = ++request;
        MODEL_WORKER.execute(() -> {
            synchronized (lock) {
                if (ticket != request) return;
            }
            long handle = 0;
            try {
                handle = Native.load(assets);
            } catch (LinkageError error) {
                Log.e("VoiceEnhancement", "Native enhancement unavailable", error);
            }
            synchronized (lock) {
                if (ticket == request) {
                    loading = false;
                    failed = handle == 0;
                    session = failed ? null : new Session(handle);
                    publish();
                    return;
                }
            }
            if (handle != 0) Native.release(handle);
        });
    }

    private void finishFade() {
        synchronized (lock) {
            if (level == 0) retire();
        }
    }

    private void retire() {
        Session old = session;
        session = null;
        if (old != null && !old.borrowed) release(old);
    }

    private static void release(Session old) {
        MODEL_WORKER.execute(() -> Native.release(old.handle));
    }

    @Override protected AudioFormat onConfigure(AudioFormat format) {
        return format.encoding == C.ENCODING_PCM_16BIT && format.sampleRate >= 4_000
            && format.sampleRate <= 384_000 && format.channelCount >= 1 && format.channelCount <= 8
            ? format : AudioFormat.NOT_SET;
    }

    @Override protected void onFlush(StreamMetadata metadata) {
        stream++;
        phase = 0;
        if (outputAudioFormat == AudioFormat.NOT_SET) return;
        int capacity = (inputAudioFormat.sampleRate * HOP + MODEL_RATE - 1) / MODEL_RATE
            * inputAudioFormat.bytesPerFrame;
        held.allocate(capacity);
        next.allocate(capacity);
        fillNext();
    }

    @Override protected void onReset() {
        stream++;
        held = new Block();
        next = new Block();
    }

    private void fillNext() {
        // Take the ceiling of each cumulative hop boundary. Keeping the residue
        // prevents rounding drift at rates such as 44.1 kHz.
        int scaled = inputAudioFormat.sampleRate * HOP - phase;
        int frames = (scaled + MODEL_RATE - 1) / MODEL_RATE;
        next.phase = phase;
        phase = frames * MODEL_RATE - scaled;
        next.pcm.clear();
        next.pcm.limit(frames * inputAudioFormat.bytesPerFrame);
    }

    @Override public void queueInput(ByteBuffer input) {
        if (!input.hasRemaining()) return;
        boolean bypass;
        synchronized (lock) {
            bypass = session == null;
        }
        if (bypass) {
            int pending = held.pcm.position() + next.pcm.position();
            ByteBuffer output = replaceOutputBuffer(pending + input.remaining());
            if (pending > 0) {
                // The fade or a pause may retire the session between two buffers.
                held.pcm.flip();
                next.pcm.flip();
                output.put(held.pcm).put(next.pcm);
                held.pcm.clear();
                phase = 0;
                fillNext();
            }
            output.put(input).flip();
            return;
        }
        int size = Math.min(input.remaining(), 2 * next.pcm.capacity());
        if (size == 0) return;
        ByteBuffer output = replaceOutputBuffer(size + held.pcm.capacity());
        int end = input.position() + size;
        int limit = input.limit();
        while (input.position() < end) {
            input.limit(Math.min(end, input.position() + next.pcm.remaining()));
            next.pcm.put(input);
            if (!next.pcm.hasRemaining()) push(output);
        }
        input.limit(limit);
        output.flip();
    }

    private void push(ByteBuffer output) {
        int offset = output.position();
        int bytes = held.pcm.position();
        held.pcm.flip();
        output.put(held.pcm);
        int bytesPerFrame = inputAudioFormat.bytesPerFrame;
        enhance(output, offset, bytes / bytesPerFrame, next.pcm.position() / bytesPerFrame);
        Block previous = held;
        held = next;
        next = previous;
        fillNext();
    }

    @Override protected void onQueueEndOfStream() {
        // Feed a final zero-padded lookahead, yielding only the real pending PCM.
        if (held.pcm.position() == 0 && next.pcm.position() == 0) return;
        ByteBuffer output = replaceOutputBuffer(held.pcm.position() + next.pcm.position());
        if (next.pcm.position() > 0) push(output);
        push(output);
        held.pcm.clear();
        output.flip();
    }

    private void enhance(ByteBuffer output, int offset, int frames, int nextFrames) {
        Session current;
        int target;
        synchronized (lock) {
            current = session;
            if (current == null) return;
            target = level;
            current.borrowed = true;
        }
        int keep = Native.process(current.handle, output, offset, frames, held.phase,
            next.pcm, nextFrames, next.phase, next.pcm.limit() / inputAudioFormat.bytesPerFrame,
            inputAudioFormat.channelCount, inputAudioFormat.sampleRate, target, current.stream != stream);
        current.stream = stream;
        synchronized (lock) {
            current.borrowed = false;
            if (current != session) {
                release(current);
            } else if (keep < 0) {
                failed = level != 0;
                retire();
                publish();
            } else if (keep == 0 && level == 0) {
                retire();
            }
        }
    }

    private static final class Block {
        ByteBuffer pcm = EMPTY_BUFFER;
        int phase;

        void allocate(int capacity) {
            if (pcm.capacity() < capacity) {
                pcm = ByteBuffer.allocateDirect(capacity).order(ByteOrder.nativeOrder());
            }
            pcm.clear();
            phase = 0;
        }
    }

    private static final class Session {
        final long handle;
        int stream = -1;
        boolean borrowed;

        Session(long handle) {
            this.handle = handle;
        }
    }

    private static final class Native {
        static {
            System.loadLibrary("voice_enhancement");
        }

        static native long load(AssetManager assets);
        static native int process(long handle, ByteBuffer dry, int offset, int frames, int phase,
            ByteBuffer next, int nextFrames, int nextPhase, int nextCapacity, int channels, int rate,
            int level, boolean reset);
        static native void release(long handle);
    }
}
