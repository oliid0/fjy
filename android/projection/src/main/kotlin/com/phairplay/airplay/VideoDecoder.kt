package com.airplay.airplay

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import android.media.MediaFormat
import android.view.Surface
import androidx.media3.container.NalUnitUtil
import com.airplay.util.Logger
import com.airplay.util.MirrorProbe

/**
 * VideoDecoder — Hardware H.264 video decoder using Android's MediaCodec API.
 *
 * WHY: AirPlay screen mirroring sends video as a stream of H.264-encoded frames.
 * To display these frames on screen, we need to decode the H.264 bitstream.
 * MediaCodec is Android's API to the hardware video decoder (GPU), which is
 * much faster and more power-efficient than any software decoder.
 *
 * HOW: Initialize with a [Surface] (from StreamingScreen) and the codec parameters
 * from the SDP (received in the RTSP ANNOUNCE). Then call [decodeNalUnit] for each
 * video chunk received from the RTP stream. MediaCodec outputs decoded frames directly
 * to the Surface — no intermediate buffer copies.
 *
 * AirPlay video data flow:
 *   RTP packet → RtspHandler strips RTP header → NAL unit bytes → VideoDecoder.decodeNalUnit()
 *   → MediaCodec input buffer → GPU hardware decode → Surface (displayed on TV)
 *
 * Example:
 *   val decoder = VideoDecoder(surface)
 *   decoder.initialize(spsBytes, ppsBytes, width, height)  // call once with SDP params
 *   decoder.decodeNalUnit(nalUnitBytes)                    // call for each video chunk
 *   decoder.release()                                       // call when done
 */
class VideoDecoder(
    private val outputSurface: Surface,
    private val mime: String = MediaFormat.MIMETYPE_VIDEO_AVC,
) {

    // The underlying hardware decoder — null until initialize() is called
    private var mediaCodec: MediaCodec? = null

    // MediaCodec is not thread-safe: the stream thread decodes while the session thread
    // may release on teardown. Releasing from under a decode call throws
    // IllegalStateException and flags the decoder unhealthy right as the stream ends.
    private val codecLock = Any()

    // Track whether the decoder has been initialized (to prevent double-init)
    @Volatile
    private var isInitialized = false

    // The size parsed from the stream's SPS — the authoritative size of the content.
    // The decoder's own numbers may describe a picture the hardware scaled to the panel,
    // so they are only trusted when they agree with this one.
    private var referenceWidth = 0
    private var referenceHeight = 0
    private var firstFrameQueued = false

    /**
     * False once MediaCodec has thrown (entered an unrecoverable error state). The caller should
     * drop this decoder and create a fresh one — error state cannot be cleared by reconfigure.
     */
    @Volatile
    var isHealthy = true
        private set

    /**
     * Optional hook fired once per frame handed to the Surface.
     *
     * Miracast uses it to detect a frozen picture (`now - lastRender`): after a lost GOP the
     * stream keeps delivering units and the codec keeps accepting them, so nothing else in
     * the pipeline can tell "decoding fine" from "nobody is looking at a moving picture".
     * AirPlay uses it to report the first decoded frame.
     */
    @Volatile
    var onFrameRendered: (() -> Unit)? = null

    /**
     * Initializes the MediaCodec decoder with the video stream parameters from the SDP.
     *
     * This must be called ONCE before any calls to [decodeNalUnit].
     * The parameters (SPS, PPS, width, height) come from the SDP body of the
     * RTSP ANNOUNCE message.
     *
     * What is SPS/PPS?
     *   H.264 requires two special "configuration" NAL units before the first frame:
     *   - SPS (Sequence Parameter Set): describes the video resolution, profile, level
     *   - PPS (Picture Parameter Set): describes encoding parameters for each frame
     *   MediaCodec needs these to configure the hardware decoder correctly.
     *
     * RULE 5: If initialization fails, the exception propagates to the caller
     * (RtspHandler) which will handle it gracefully (log + return to WAITING state).
     *
     * @param csd0     Annex-B SPS for AVC, or concatenated Annex-B VPS/SPS/PPS for HEVC
     * @param csd1     Annex-B PPS for AVC; not used for HEVC
     * @param width     Video width in pixels (from SDP)
     * @param height    Video height in pixels (from SDP)
     */
    fun initialize(csd0: ByteArray, csd1: ByteArray?, width: Int, height: Int): Unit = synchronized(codecLock) {
        if (isInitialized) {
            Logger.w("VideoDecoder.initialize() called twice — ignoring second call")
            return@synchronized
        }

        // SDP and mirrored AVC may disagree with the display size. MediaCodec
        // supplies the final visible crop after decoding the first frame.
        val parsed = if (mime == MediaFormat.MIMETYPE_VIDEO_AVC) parseSpsResolution(csd0) else null
        val (actualWidth, actualHeight) = parsed?.takeIf { isPlausibleSize(it.first, it.second) } ?: (width to height)

        Logger.i("Initializing $mime decoder: ${actualWidth}x${actualHeight} " +
                 "(hint was ${width}x${height})")

        // Provisional size for StreamingScreen aspect-fit; replaced by the decoder's reported size.
        sizes[outputSurface] = PictureSize(actualWidth, actualHeight)
        StreamStats.videoWidth = actualWidth
        StreamStats.videoHeight = actualHeight
        referenceWidth = actualWidth
        referenceHeight = actualHeight

        val format = MediaFormat.createVideoFormat(mime, actualWidth, actualHeight).apply {
            inputSizes[outputSurface]?.let { setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, it) }
            setByteBuffer("csd-0", java.nio.ByteBuffer.wrap(codecParameterSet(csd0)))
            csd1?.let { setByteBuffer("csd-1", java.nio.ByteBuffer.wrap(codecParameterSet(it))) }
            // NOTE: do NOT set KEY_MAX_WIDTH/HEIGHT here — this SoC's MStar decoder rejects
            // adaptive playback (BadParameter / buffer-count failures) and produces banding.
            // Resolution changes are handled by recreating the decoder in MirrorStreamServer.
        }

        mediaCodec = startDecoder(format)
        firstFrameQueued = false
        isInitialized = true
        Logger.i("$mime decoder initialized: ${mediaCodec?.name}")
    }

    private fun startDecoder(format: MediaFormat): MediaCodec {
        val candidates = regularDecoders(mime).sortedByDescending { info ->
            runCatching { info.getCapabilitiesForType(mime).isFormatSupported(format) }
                .getOrDefault(false)
        }
        var failure: Exception? = null
        for (info in candidates) {
            val lowLatency = Build.VERSION.SDK_INT >= 30 && runCatching {
                info.getCapabilitiesForType(mime)
                    .isFeatureSupported(MediaCodecInfo.CodecCapabilities.FEATURE_LowLatency)
            }.getOrDefault(false)
            for (enable in if (lowLatency) listOf(true, false) else listOf(false)) {
                var candidate: MediaCodec? = null
                try {
                    if (Build.VERSION.SDK_INT >= 30) {
                        if (enable) format.setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
                        else format.removeKey(MediaFormat.KEY_LOW_LATENCY)
                    }
                    candidate = MediaCodec.createByCodecName(info.name)
                    candidate.configure(format, outputSurface, null, 0)
                    candidate.start()
                    return candidate
                } catch (error: Exception) {
                    runCatching { candidate?.release() }
                    failure = error
                    Logger.w("$mime decoder ${info.name} could not start: ${error.message}")
                }
            }
        }
        throw IllegalStateException("No $mime decoder accepted the stream", failure)
    }

    /**
     * Decodes a single H.264 NAL unit and sends it to the display.
     *
     * A NAL unit (Network Abstraction Layer Unit) is the basic building block of H.264.
     * Each RTP packet from AirPlay contains one or more NAL units.
     * Some NAL units are full frames (IDR frames), others are partial updates.
     *
     * PERFORMANCE: This method runs on the IO coroutine dispatcher (network thread).
     * MediaCodec handles the actual decoding on its own internal thread.
     * The decoded frame appears on the Surface without any UI thread involvement.
     *
     * SECURITY: The caller (RtspHandler) is responsible for validating the byte array
     * length before passing it here.
     *
     * @param nalUnit The raw NAL unit bytes (without the RTP header).
     * @param presentationTimeUs Presentation timestamp in microseconds (for A/V sync).
     */
    fun decodeNalUnit(nalUnit: ByteArray, presentationTimeUs: Long) {
        // Debug-only timing: how long the codec lock is held for one access unit tells us
        // whether the pipeline is back-pressured (see MirrorProbe for the full rationale).
        val probeStartNanos = System.nanoTime()
        synchronized(codecLock) {
            val codec = mediaCodec ?: run {
                Logger.w("decodeNalUnit() called but decoder not initialized")
                return
            }

            try {
                // Drain finished frames FIRST — renders them and frees the pipeline so an input
                // buffer becomes available. Dropping NAL units corrupts H.264 (loses reference
                // frames) and causes a black screen until the next keyframe, so we avoid it.
                releaseOutputBuffers(codec)

                // Match the reference receiver's 1s first-input / 200ms steady
                // budget, draining output while retaining this exact picture.
                val inputWaitStart = System.nanoTime()
                val budget = if (firstFrameQueued) INPUT_BUFFER_TIMEOUT_US else FIRST_INPUT_TIMEOUT_US
                val deadline = inputWaitStart + budget * 1000
                var inputBufferIndex: Int
                do {
                    inputBufferIndex = codec.dequeueInputBuffer(INPUT_POLL_US)
                    if (inputBufferIndex >= 0) break
                    // Some codecs cannot return input until pending output is
                    // released. A single long input wait starves that output.
                    releaseOutputBuffers(codec)
                } while (System.nanoTime() < deadline)
                MirrorProbe.onInputWait(System.nanoTime() - inputWaitStart, inputBufferIndex >= 0)

                if (inputBufferIndex >= 0) {
                    // We got an input buffer — fill it with the NAL unit bytes
                    val inputBuffer = codec.getInputBuffer(inputBufferIndex)
                    inputBuffer?.clear()
                    if (inputBuffer == null || nalUnit.size > inputBuffer.remaining()) {
                        codec.queueInputBuffer(inputBufferIndex, 0, 0, presentationTimeUs, 0)
                        if (nalUnit.size in 1..MAX_ACCESS_UNIT_BYTES &&
                            nalUnit.size > (inputSizes[outputSurface] ?: 0)) {
                            inputSizes[outputSurface] = nalUnit.size
                        }
                        isHealthy = false
                        return@synchronized
                    }
                    inputBuffer.put(nalUnit)

                    // Tell MediaCodec: "input buffer [index] is filled with [size] bytes
                    // of data with timestamp [presentationTimeUs] — please decode it"
                    codec.queueInputBuffer(
                        inputBufferIndex,
                        0,                 // offset: start from beginning of buffer
                        nalUnit.size,      // size: how many bytes to decode
                        presentationTimeUs,
                        0
                    )
                    firstFrameQueued = true
                    // Start the residence clock for this frame; it stops when the frame comes
                    // back out of the codec and is handed to the Surface.
                    MirrorProbe.onFrameQueued(presentationTimeUs)
                } else {
                    // This picture was not accepted. Never continue a prediction
                    // chain that now has a missing reference; callers must resync.
                    isHealthy = false
                    Logger.w("VideoDecoder: input stalled after draining output; resync required")
                }

                // Release any output buffers that MediaCodec has finished decoding.
                // render=true means the frame goes to the Surface immediately.
                releaseOutputBuffers(codec)

            } catch (e: IllegalStateException) {
                // MediaCodec is now in the error state and cannot recover — flag for recreation.
                Logger.e("VideoDecoder entered error state — will recreate", e)
                isHealthy = false
                MirrorProbe.onDecoderError()
            } catch (e: Exception) {
                Logger.e("Error decoding NAL unit", e)
                isHealthy = false
            }
            MirrorProbe.onDecodeCall(System.nanoTime() - probeStartNanos)
        }
    }

    /** Complete a stationary single-picture sequence only after input has gone idle. */
    internal fun finishStill(pts: Long): Boolean = synchronized(codecLock) {
        val codec = mediaCodec ?: return@synchronized false
        try {
            val index = codec.dequeueInputBuffer(0)
            if (index < 0) return@synchronized false
            codec.queueInputBuffer(index, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            true
        } catch (error: IllegalStateException) {
            isHealthy = false
            false
        }
    }

    /**
     * Releases any decoded output buffers back to MediaCodec and renders them to the Surface.
     *
     * MediaCodec works asynchronously: we put encoded data in input buffers,
     * and decoded frames appear in output buffers. We must release each output
     * buffer back to MediaCodec after rendering, or we'll run out of buffers.
     *
     * render=true: the frame is rendered to the Surface (displayed on TV).
     * render=false: the frame is discarded (used to flush without displaying).
     *
     * Mirror senders can stop sending when their screen is static, even while output is pending.
     */
    internal fun drain(): Unit = synchronized(codecLock) {
        if (!isHealthy) return@synchronized
        mediaCodec?.let { codec ->
            try {
                releaseOutputBuffers(codec)
            } catch (error: IllegalStateException) {
                Logger.e("VideoDecoder could not drain pending output", error)
                isHealthy = false
                MirrorProbe.onDecoderError()
            }
        }
    }

    private fun releaseOutputBuffers(codec: MediaCodec) {
        val bufferInfo = MediaCodec.BufferInfo()
        var outputBufferIndex = codec.dequeueOutputBuffer(bufferInfo, 0)

        while (outputBufferIndex >= 0 || outputBufferIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED ||
            outputBufferIndex == MediaCodec.INFO_OUTPUT_BUFFERS_CHANGED
        ) {
            if (outputBufferIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                // The decoder parsed the real size from the SPS — authoritative for aspect-fit.
                publishOutputSize(codec.outputFormat)
            } else if (outputBufferIndex >= 0) {
                // Render immediately. We deliberately do NOT schedule a future render time for A/V sync:
                // this Surface's BufferQueue holds only ~3 frames, so any hold quickly back-pressures the
                // decoder → the upstream frame queue saturates → big latency + dropped (corrupt) frames.
                // A/V alignment is handled by keeping the AUDIO path low-latency instead (AudioStreamServer).
                //
                // Debug probe: this call blocks while the BufferQueue is full, so its duration is the
                // direct measure of "the picture stopped accepting frames" (a visual stutter).
                val renderStartNanos = System.nanoTime()
                val eos = bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                // Some Surface decoders expose an opaque picture with zero CPU-readable bytes.
                val picture = (!eos || bufferInfo.size > 0) && bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0
                codec.releaseOutputBuffer(outputBufferIndex, picture)
                if (picture) {
                    MirrorProbe.onRenderBlock(System.nanoTime() - renderStartNanos)
                    MirrorProbe.onFrameRendered(bufferInfo.presentationTimeUs)
                    onFrameRendered?.invoke()
                }
                if (eos) return
            }
            outputBufferIndex = codec.dequeueOutputBuffer(bufferInfo, 0)
        }
    }

    /**
     * Publishes the size the on-screen aspect-fit should use.
     *
     * WHY the resolver: the decoder's crop rectangle is not always a crop. A decoder that
     * scales the picture to the panel reports the scaled size as a crop, and using it
     * stretches the picture. [OutputSizeResolver] compares the crop with the size parsed
     * from the SPS and keeps the true aspect when they disagree.
     */
    private fun publishOutputSize(format: MediaFormat) {
        val result = OutputSizeResolver.resolve(
            coded = PictureSize(
                format.getIntegerOrZero(MediaFormat.KEY_WIDTH),
                format.getIntegerOrZero(MediaFormat.KEY_HEIGHT),
            ),
            crop = readCrop(format),
            reference = if (referenceWidth > 0 && referenceHeight > 0) {
                PictureSize(referenceWidth, referenceHeight)
            } else {
                null
            },
        )

        if (isPlausibleSize(result.width, result.height)) {
            sizes[outputSurface] = PictureSize(result.width, result.height)
            StreamStats.videoWidth = result.width
            StreamStats.videoHeight = result.height
            Logger.i("Video output size ${result.width}x${result.height} (${result.reason})")
        }
    }

    /**
     * Reads the decoder's crop rectangle.
     *
     * @return The cropped size, or null when the decoder reports no usable crop.
     */
    private fun readCrop(format: MediaFormat): PictureSize? {
        if (!format.containsKey("crop-left") || !format.containsKey("crop-right")) return null
        val left = format.getIntegerOrZero("crop-left")
        val right = format.getIntegerOrZero("crop-right")
        val top = format.getIntegerOrZero("crop-top")
        val bottom = format.getIntegerOrZero("crop-bottom")
        val width = right - left + 1
        val height = bottom - top + 1
        if (width <= 0 || height <= 0) return null
        return PictureSize(width, height)
    }

    /** Reads an integer key; a missing or non-integer value counts as 0. */
    private fun MediaFormat.getIntegerOrZero(key: String): Int =
        runCatching { getInteger(key) }.getOrDefault(0)

    /**
     * Releases all MediaCodec resources.
     *
     * MUST be called when streaming ends (from AirPlayReceiver.onStreamingStopped()
     * or from onDestroy()). Failing to release MediaCodec causes:
     * - Memory leaks (codec buffers are GPU memory, a scarce resource)
     * - The hardware decoder being unavailable to other apps
     *
     * After release(), call initialize() again before using the decoder.
     */
    fun release() {
        Logger.d("Releasing VideoDecoder")
        synchronized(codecLock) {
            try {
                mediaCodec?.stop()
            } catch (e: Exception) {
                Logger.e("Error releasing MediaCodec (non-fatal)", e)
            } finally {
                runCatching { mediaCodec?.release() }
                mediaCodec = null
                isInitialized = false
            }
        }
    }

    /** True if (w, h) look like a real video resolution — rejects parser garbage (e.g. 32x87392). */
    private fun isPlausibleSize(w: Int, h: Int): Boolean = w in 64..8192 && h in 64..8192

    companion object {
        internal const val MAX_ACCESS_UNIT_BYTES = 8 * 1024 * 1024
        private val inputSizes = java.util.Collections.synchronizedMap(java.util.WeakHashMap<Surface, Int>())

        // SDP and Miracast supply raw NALs. The mirror transport already
        // supplies Annex B, including concatenated parameter sets for HEVC.
        private fun codecParameterSet(nal: ByteArray): ByteArray {
            val prefix = com.airplay.airplay.handshake.MirrorCrypto.START_CODE
            if (nal.size >= 4 && prefix.indices.all { nal[it] == prefix[it] }) return nal
            if (nal.size >= 3 && nal[0] == 0.toByte() && nal[1] == 0.toByte() && nal[2] == 1.toByte())
                return byteArrayOf(0) + nal
            return prefix + nal
        }

        internal fun regularDecoders(mime: String): List<MediaCodecInfo> =
            MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { info ->
                !info.isEncoder && !info.name.endsWith(".secure", true) &&
                    (Build.VERSION.SDK_INT < 29 || !info.isAlias) &&
                    info.supportedTypes.any { it.equals(mime, true) }
            }

        internal fun supportsHevc(width: Int, height: Int, fps: Int): Boolean = runCatching {
            val mime = MediaFormat.MIMETYPE_VIDEO_HEVC
            val format = MediaFormat.createVideoFormat(mime, width, height).apply {
                setInteger(MediaFormat.KEY_FRAME_RATE, fps)
                setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.HEVCProfileMain)
            }
            regularDecoders(mime).any { runCatching { it.getCapabilitiesForType(mime).isFormatSupported(format) }.getOrDefault(false) }
        }.getOrDefault(false)

        private val sizes = java.util.Collections.synchronizedMap(java.util.WeakHashMap<Surface, PictureSize>())
        internal fun setSize(surface: Surface, width: Int, height: Int) { sizes[surface] = PictureSize(width, height) }
        internal fun sizeFor(surface: Surface): PictureSize? = sizes[surface]

        // Bound a wedged codec, draining output between short input polls.
        private const val INPUT_BUFFER_TIMEOUT_US = 200_000L
        private const val FIRST_INPUT_TIMEOUT_US = 1_000_000L
        private const val INPUT_POLL_US = 10_000L

        @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
        private fun parseSpsResolution(sps: ByteArray): Pair<Int, Int>? {
            if (sps.size < 4) return null
            val header = when {
                sps[0] != 0.toByte() -> 0
                sps[1] != 0.toByte() -> return null
                sps[2] == 1.toByte() -> 3
                sps[2] == 0.toByte() && sps[3] == 1.toByte() -> 4
                else -> return null
            }
            if (header >= sps.size || sps[header].toInt() and 31 != NalUnitUtil.H264_NAL_UNIT_TYPE_SPS) return null
            return runCatching {
                val parsed = NalUnitUtil.parseSpsNalUnit(sps, header, sps.size)
                parsed.width to parsed.height
            }.getOrNull()
        }
    }
}
