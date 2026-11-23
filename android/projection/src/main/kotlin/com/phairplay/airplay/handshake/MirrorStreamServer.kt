package com.airplay.airplay.handshake

import android.media.MediaFormat
import android.util.Log
import android.view.Surface
import com.airplay.airplay.StreamStats
import com.airplay.airplay.VideoDecoder
import com.airplay.util.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.ServerSocket
import java.net.Socket
import java.nio.ByteBuffer
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * MirrorStreamServer — receives and decodes the AirPlay 2 mirroring video stream.
 *
 * macOS connects to [dataPort] and sends [128-byte header][payload] packets:
 *  - payload_size = little-endian int at header offset 0
 *  - payload_type = little-endian short at header offset 4, low byte
 *      • type 1: unencrypted AVC or HEVC configuration → (re)configure the decoder
 *      • type 0: AES-CTR-encrypted length-prefixed NAL units → convert to Annex-B and decode
 *
 * Architecture: a network thread reads + decrypts packets (keeping the AES-CTR keystream strictly
 * ordered) and pushes work onto a bounded queue; a separate decoder thread consumes it. This way
 * the socket is always drained fast — if the decoder can't keep up (this SoC is modest, and the
 * audio codec competes for resources), frames are dropped from the queue instead of stalling the
 * socket, which previously caused macOS to drop the whole session.
 *
 * Reference: RPiPlay lib/raop_rtp_mirror.c (raop_rtp_mirror_thread).
 */
class MirrorStreamServer(
    aesKey: ByteArray,
    streamConnectionId: Long,
    private val surfaceProvider: () -> Surface?,
    private val width: Int,
    private val height: Int,
    private val allowHevc: Boolean,
    private val onFirstFrame: (MirrorStreamServer) -> Unit,
    private val onStreamFailure: (MirrorStreamServer) -> Unit,
) {
    private class Config(val mime: String, val csd0: ByteArray, val csd1: ByteArray?, val width: Int, val height: Int) {
        fun matches(other: Config?): Boolean = other != null && mime == other.mime &&
            width == other.width && height == other.height &&
            csd0.contentEquals(other.csd0) && csd1.contentEquals(other.csd1)
    }
    private class Frame(val annexB: ByteArray, val config: Config, val sequence: Long)

    private val cipher = MirrorCrypto.streamCipher(aesKey, streamConnectionId)
    private val serverSocket = ServerSocket(0)            // OS-assigned free port
    private val queue = ArrayBlockingQueue<Frame>(QUEUE_CAPACITY)

    @Volatile private var running = false
    @Volatile private var client: Socket? = null
    @Volatile private var decoder: VideoDecoder? = null   // owned by the decoder thread
    private var configured: Config? = null
    @Volatile var hasRenderedFirstFrame = false
        private set
    @Volatile var renderedSurface: Surface? = null
        private set
    private var startup: Job? = null
    // The Surface the current decoder was built against. The SurfaceView destroys its Surface when
    // the app backgrounds and creates a NEW one on return, so we watch for the identity changing
    // and rebuild the decoder — otherwise video stays black after foregrounding.
    @Volatile private var configuredSurface: Surface? = null
    private var framePtsUs = 0L
    private var framesIn = 0
    private var framesDropped = 0
    private var lastStatMs = 0L
    // Only the decoder thread changes reference-frame state.
    private var awaitingKeyframe = true
    // A sender can pause after an IDR and a few predicted frames. Keep that
    // short prefix until the codec displays a frame, so EOS can drain it and
    // a subsequent predicted frame can still use exactly the same references.
    private val startupPictures = mutableListOf<ByteArray>()
    private var stillFinished = false

    /** The OS-assigned TCP port macOS should connect to (returned in the SETUP response). */
    val dataPort: Int get() = serverSocket.localPort

    fun start(scope: CoroutineScope) {
        running = true
        startup = scope.launch {
            delay(STARTUP_TIMEOUT_MS)
            if (!hasRenderedFirstFrame) {
                val reason = if (client == null) "sender never opened media TCP" else "media TCP opened but no first frame"
                Log.w("FcboardProjection", "AirPlay mirror setup timed out: $reason")
                onStreamFailure(this@MirrorStreamServer)
            }
        }
        scope.launch(Dispatchers.IO) { runReader() }
        scope.launch(Dispatchers.IO) { runDecoder() }
    }

    fun stop() {
        running = false
        startup?.cancel()
        runCatching { client?.close() }
        runCatching { serverSocket.close() }
        queue.clear()
        Logger.i("MirrorStreamServer stopped")
    }

    // ─── Network reader thread: read + decrypt (ordered), enqueue, never block on decode ──────
    private fun runReader() {
        try {
            Logger.i("MirrorStreamServer listening on data port $dataPort")
            val socket = serverSocket.accept().also { client = it }
            Log.i("FcboardProjection", "AirPlay mirror TCP data connected")
            val input = socket.getInputStream()
            var config: Config? = null
            var sequence = 0L
            var invalidVideoPacket = false
            var emptyConfig = false
            val header = ByteArray(128)
            while (running && !socket.isClosed) {
                if (!readFully(input, header, 128)) break
                val payloadSize = leInt(header, 0)
                val payloadType = leShort(header, 4) and 0xFF
                if (payloadSize < 0 || payloadSize > VideoDecoder.MAX_ACCESS_UNIT_BYTES) {
                    Logger.w("Mirror: bad payloadSize=$payloadSize type=$payloadType — stopping")
                    break
                }
                if (payloadSize == 0) {
                    if (payloadType == 1 && config == null && !emptyConfig) {
                        emptyConfig = true
                        Log.w("FcboardProjection", "AirPlay mirror sent an empty codec configuration (HEVC advertised=$allowHevc)")
                    }
                    continue
                }
                val payload = ByteArray(payloadSize)
                if (!readFully(input, payload, payloadSize)) break
                when (payloadType) {
                    0 -> {
                        // ALWAYS advance the AES-CTR keystream, in order, for every video payload —
                        // skipping any packet desyncs the keystream and corrupts all later frames.
                        val annexB = MirrorCrypto.lengthPrefixedToAnnexB(cipher.update(payload))
                        val current = config
                        if (annexB.isEmpty() && !invalidVideoPacket) {
                            invalidVideoPacket = true
                            Log.w("FcboardProjection", "AirPlay decrypted video has invalid NAL lengths")
                        }
                        if (current != null) {
                            val frameNumber = sequence++
                            if (annexB.isNotEmpty()) enqueue(Frame(annexB, current, frameNumber))
                        }
                    }
                    1 -> {
                        val next = parseConfig(payload, header)
                        if (next == null) {
                            Log.w("FcboardProjection", "AirPlay mirror rejected codec configuration (${payload.size} bytes)")
                            config = null
                        } else if (!next.matches(config)) {
                            config = next
                            Log.i("FcboardProjection", "AirPlay mirror codec ${next.mime} (${next.width}x${next.height})")
                        }
                    }
                    else -> Logger.v("Mirror: ignoring payload type $payloadType ($payloadSize B)")
                }
            }
        } catch (e: Exception) {
            if (running) Logger.e("Mirror reader error", e)
        } finally {
            if (running) onStreamFailure(this)
            running = false
            runCatching { client?.close() }
            runCatching { serverSocket.close() }
            Logger.i("Mirror data connection ended")
        }
    }

    /** Keep the queued decoding prefix, especially its IDR, when codec startup lags. */
    private fun enqueue(item: Frame) {
        framesIn++
        if (!queue.offer(item)) {
            if (isKeyframe(item.annexB, item.config.mime == MediaFormat.MIMETYPE_VIDEO_HEVC)) {
                framesDropped += queue.size
                queue.clear()
                queue.offer(item)
            } else {
                framesDropped++
            }
        }
        StreamStats.videoQueue = queue.size
        if (framesIn % 300 == 0) {
            val now = System.currentTimeMillis()
            if (lastStatMs != 0L) StreamStats.videoFps = (300_000L / (now - lastStatMs).coerceAtLeast(1)).toInt()
            lastStatMs = now
            StreamStats.videoDropPct = framesDropped * 100 / framesIn
            Logger.i("Video stats: in=$framesIn dropped=$framesDropped " +
                "(${StreamStats.videoDropPct}%) queue=${queue.size}/$QUEUE_CAPACITY ${StreamStats.videoFps}fps")
        }
    }

    private fun parseConfig(payload: ByteArray, header: ByteArray): Config? = runCatching {
        val sizeHintWidth = Float.fromBits(leInt(header, 40)).toInt()
        val sizeHintHeight = Float.fromBits(leInt(header, 44)).toInt()
        val (codedWidth, codedHeight) = if (sizeHintWidth in 64..8192 && sizeHintHeight in 64..8192) {
            sizeHintWidth to sizeHintHeight
        } else {
            width to height
        }
        val packet = ByteBuffer.wrap(payload)
        val tag = if (packet.remaining() >= 8) packet.getInt(4) else 0
        val avc = when (tag) {
            AVC1, AVCC -> true
            HVC1, HEV1, HVCC -> false
            else -> payload.size >= 7 && (payload[4].toInt() and 0xfc) == 0xfc &&
                (payload[5].toInt() and 0xe0) == 0xe0
        }
        if (!avc && !allowHevc) return@runCatching null
        val config = when (tag) {
            AVC1, AVCC, HVC1, HEV1, HVCC -> configRecord(packet, if (avc) AVCC else HVCC)
                ?: return@runCatching null
            else -> packet
        }
        if (!avc) {
            val csd = readHevcConfig(config) ?: return@runCatching null
            return@runCatching Config(MediaFormat.MIMETYPE_VIDEO_HEVC, csd, null, codedWidth, codedHeight)
        }

        if (config.get(0).toInt() != 1 || config.get(4).toInt() and 3 != 3) return@runCatching null
        config.position(5)
        val sps = readParameterSets(config, config.get().toInt() and 31, 7, hevc = false) ?: return@runCatching null
        val pps = readParameterSets(config, config.get().toInt() and 255, 8, hevc = false) ?: return@runCatching null
        Config(MediaFormat.MIMETYPE_VIDEO_AVC, sps, pps, codedWidth, codedHeight)
    }.getOrNull()

    private fun configRecord(packet: ByteBuffer, expectedTag: Int): ByteBuffer? {
        val totalSize = packet.int
        val outerTag = packet.int
        if (totalSize !in 8..packet.limit()) return null
        packet.limit(totalSize)
        if (outerTag == expectedTag) return packet.slice()
        if (totalSize < VISUAL_SAMPLE_ENTRY_BYTES) return null
        packet.position(VISUAL_SAMPLE_ENTRY_BYTES)
        while (packet.remaining() >= 8) {
            val start = packet.position()
            val size = packet.int
            val tag = packet.int
            if (size !in 8..(totalSize - start)) return null
            if (tag == expectedTag) {
                packet.limit(start + size)
                return packet.slice()
            }
            packet.position(start + size)
        }
        return null
    }

    private fun readHevcConfig(config: ByteBuffer): ByteArray? {
        val start = config.position()
        if (config.remaining() < 23 || config.get(start).toInt() != 1 || config.get(start + 21).toInt() and 3 != 3) return null
        config.position(start + 22)
        val arrays = config.get().toInt() and 255
        val parameterSets = mutableMapOf<Int, ByteArray>()
        repeat(arrays) {
            val type = config.get().toInt() and 63
            val count = config.short.toInt() and 0xffff
            val sets = readParameterSets(config, count, type, hevc = true) ?: return null
            if (type in 32..34 && parameterSets.put(type, sets) != null) return null
        }
        if (config.hasRemaining() || !(32..34).all { parameterSets.containsKey(it) }) return null
        return parameterSets.getValue(32) + parameterSets.getValue(33) + parameterSets.getValue(34)
    }

    private fun readParameterSets(config: ByteBuffer, count: Int, type: Int, hevc: Boolean): ByteArray? {
        if (count == 0) return null
        val out = ByteArrayOutputStream()
        repeat(count) {
            val size = config.short.toInt() and 0xffff
            if (size !in (if (hevc) 2 else 1)..config.remaining() || nalType(config.get(config.position()), hevc) != type) return null
            out.write(MirrorCrypto.START_CODE)
            out.write(config.array(), config.arrayOffset() + config.position(), size)
            config.position(config.position() + size)
        }
        return out.toByteArray()
    }

    // ─── Decoder thread: consume the queue; the only thread that touches the decoder ──────────
    private fun runDecoder() {
        try {
            var expected = 0L
            while (running) {
                val frame = queue.poll(50, TimeUnit.MILLISECONDS)
                if (frame == null) {
                    decoder?.drain()
                    if (!stillFinished && startupPictures.isNotEmpty()) {
                        if (renderedSurface != null) startupPictures.clear()
                        else stillFinished = decoder?.finishStill(framePtsUs) == true
                    }
                    continue
                }
                if (frame.config !== configured) {
                    configured = frame.config
                    rebuildDecoder(awaitSurface())
                }
                val gap = expected != frame.sequence
                if (gap) awaitingKeyframe = true
                expected = frame.sequence + 1
                decodeFrame(frame.annexB, gap)
            }
        } catch (e: Exception) {
            if (running) {
                Log.e("FcboardProjection", "AirPlay mirror decoder failed (${configured?.mime})", e)
                onStreamFailure(this)
            }
        } finally {
            decoder?.release()
            decoder = null
        }
    }

    /**
     * (Re)creates the decoder for [surface] from the cached SPS/PPS. Safe to call on a surface
     * change (app background→foreground): releases the old decoder and resyncs at the next keyframe.
     * If the surface or config isn't available yet, leaves the decoder null and retries on a later
     * frame (frames are dropped until then).
     */
    private fun rebuildDecoder(surface: Surface?) {
        decoder?.release()
        decoder = null
        renderedSurface = null
        startupPictures.clear()
        stillFinished = false
        configuredSurface = surface
        val config = configured ?: return
        if (surface == null) return                            // backgrounded — wait for the surface to return
        decoder = VideoDecoder(surface, config.mime).also {
            it.onFrameRendered = {
                it.onFrameRendered = null
                if (running) {
                    renderedSurface = surface
                    hasRenderedFirstFrame = true
                    startup?.cancel()
                    Log.i("FcboardProjection", "AirPlay first decoded frame rendered (${config.mime})")
                    onFirstFrame(this)
                }
            }
            it.initialize(config.csd0, config.csd1, config.width, config.height)
        }
        awaitingKeyframe = true                                // a fresh decoder must start at an IDR
        StreamStats.videoRes = "${config.width}x${config.height}"
    }

    private fun decodeFrame(annexB: ByteArray, sequenceGap: Boolean) {
        // Re-attach to the live Surface if it changed (the app was backgrounded and returned, so the
        // SurfaceView made a new Surface). Without this, video stays black after foregrounding.
        val liveSurface = surfaceProvider()?.takeIf { it.isValid }
        if (liveSurface !== configuredSurface) {
            Logger.i("Mirror: surface ${if (liveSurface == null) "lost" else "changed"} — re-attaching decoder")
            rebuildDecoder(liveSurface)
        }
        if (stillFinished) {
            val previous = if (sequenceGap || isKeyframe(annexB)) emptyList() else startupPictures.toList()
            rebuildDecoder(liveSurface)
            if (previous.isNotEmpty() && decoder != null) {
                previous.forEachIndexed { index, picture ->
                    decoder?.decodeNalUnit(picture, framePtsUs - (previous.size - index) * FRAME_INTERVAL_US)
                }
                startupPictures.addAll(previous)
                awaitingKeyframe = false
            }
        }
        if (decoder?.isHealthy == false) {
            if (!isKeyframe(annexB)) return
            rebuildDecoder(liveSurface)
        }
        val d = decoder ?: return
        val first = awaitingKeyframe && renderedSurface == null
        if (awaitingKeyframe) {
            // After a dropped frame the stream is reference-broken; skip until the next IDR so we
            // don't feed the decoder predicted frames with missing references (which smear/blocky).
            if (!isKeyframe(annexB)) return
            awaitingKeyframe = false
            Logger.i("Mirror: resynced on keyframe after a dropped frame")
        }
        if (framePtsUs == 0L) Logger.i("Mirror: first video frame fed to decoder (${annexB.size}B)")
        if (sequenceGap || renderedSurface != null) startupPictures.clear()
        if (renderedSurface == null) {
            val keyframe = isKeyframe(annexB)
            if (keyframe) startupPictures.clear()
            if (keyframe || startupPictures.isNotEmpty()) {
                if (startupPictures.size < QUEUE_CAPACITY &&
                    annexB.size + startupPictures.sumOf { it.size } <= VideoDecoder.MAX_ACCESS_UNIT_BYTES) {
                    startupPictures.add(annexB)
                } else startupPictures.clear()
            }
        }
        d.decodeNalUnit(annexB, framePtsUs)
        if (first && !d.isHealthy && running) {
            rebuildDecoder(liveSurface)
            awaitingKeyframe = false
            decoder?.decodeNalUnit(annexB, framePtsUs)
            startupPictures.add(annexB)
        }
        framePtsUs += FRAME_INTERVAL_US
    }

    private fun isKeyframe(annexB: ByteArray, hevc: Boolean = configured?.mime == MediaFormat.MIMETYPE_VIDEO_HEVC): Boolean {
        var i = 0
        while (i + 3 < annexB.size) {
            if (annexB[i].toInt() == 0 && annexB[i + 1].toInt() == 0 && annexB[i + 2].toInt() == 1) {
                val type = nalType(annexB[i + 3], hevc)
                if (hevc && type in 0..31) return i + 4 < annexB.size && type in 16..21
                if (!hevc && type in 1..5) return type == 5
                i += 3
            } else {
                i++
            }
        }
        return false
    }

    private fun nalType(header: Byte, hevc: Boolean): Int =
        if (hevc) (header.toInt() ushr 1) and 63 else header.toInt() and 31

    /** The streaming Surface may temporarily be unavailable during a display change. */
    private fun awaitSurface(): Surface? {
        repeat(SURFACE_WAIT_TRIES) {
            if (!running) return null
            surfaceProvider()?.takeIf { it.isValid }?.let { return it }
            try { Thread.sleep(SURFACE_WAIT_MS) } catch (_: InterruptedException) { return null }
        }
        return surfaceProvider()?.takeIf { it.isValid }
    }

    private fun readFully(input: InputStream, buf: ByteArray, len: Int): Boolean {
        var read = 0
        while (read < len) {
            val n = input.read(buf, read, len - read)
            if (n == -1) return false
            read += n
        }
        return true
    }

    private fun leInt(b: ByteArray, off: Int): Int =
        (b[off].toInt() and 0xFF) or ((b[off + 1].toInt() and 0xFF) shl 8) or
            ((b[off + 2].toInt() and 0xFF) shl 16) or ((b[off + 3].toInt() and 0xFF) shl 24)

    private fun leShort(b: ByteArray, off: Int): Int =
        (b[off].toInt() and 0xFF) or ((b[off + 1].toInt() and 0xFF) shl 8)

    companion object {
        private const val AVC1 = 0x61766331
        private const val AVCC = 0x61766343
        private const val HVC1 = 0x68766331
        private const val HEV1 = 0x68657631
        private const val HVCC = 0x68766343
        private const val VISUAL_SAMPLE_ENTRY_BYTES = 86
        private const val STARTUP_TIMEOUT_MS = 15_000L
        private const val FRAME_INTERVAL_US = 1_000_000L / 60  // monotonic PTS hint (~60fps)
        private const val QUEUE_CAPACITY = 6                   // ~100ms at 60fps
        private const val SURFACE_WAIT_TRIES = 50
        private const val SURFACE_WAIT_MS = 100L
    }
}
