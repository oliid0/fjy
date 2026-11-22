package com.airplay.airplay

import android.util.Log
import com.airplay.airplay.handshake.FairPlay
import com.airplay.airplay.handshake.InfoResponder
import com.airplay.airplay.handshake.MirrorCrypto
import com.airplay.airplay.handshake.PairingKeys
import com.airplay.airplay.handshake.PairingSession
import com.airplay.airplay.handshake.PlistCodec
import com.airplay.util.Logger
import com.airplay.util.MediaUriPolicy
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket

/**
 * RtspHandler — Manages the RTSP session with the AirPlay sender (macOS).
 *
 * AirPlay uses RTSP to negotiate codecs, ports, and encryption before media flows.
 * The handler accepts one sender at a time, parses ANNOUNCE SDP, acknowledges SETUP
 * and RECORD, then hands binary interleaved RTP frames to [RtpInterleaved].
 */
open class RtspHandler(
    private val context: android.content.Context,
    private val onListening: (Int) -> Unit,
    private val onListenFailure: () -> Unit,
    private val receiverName: () -> String,
    private val displayWidth: Int = 1920,
    private val displayHeight: Int = 1080,
    private val displayFps: Int = 60,
    private val hevc: Boolean,
    private val audioEnabled: Boolean = false,
    private val videoSurfaceProvider: () -> android.view.Surface?,
    private val onStreamingStarted: (session: SessionDescription) -> Unit,
    private val onStreamingStopped: () -> Unit,
    private val onPhotoReceived: (bytes: ByteArray, imageType: PhotoImageType) -> Unit = { _, _ -> },
    private val onPhotoCleared: () -> Unit = {},
    /**
     * Mirror SETUP msg 1: supply the session AES key and IV plus the sender's timing endpoint.
     * Returns the bound local UDP timing port.
     */
    private val onMirrorSetupKeys: (
        aesKey: ByteArray, aesIv: ByteArray,
        remoteAddress: java.net.InetAddress, senderTimingPort: Int
    ) -> Int = { _, _, _, _ -> 0 },
    /** AirPlay 2 mirror SETUP: start the video data server (type 110); returns its data port. */
    private val onMirrorStreamStart: (streamConnectionId: Long, closeControl: () -> Unit) -> Int = { _, _ -> 0 },
    /** AirPlay 2 SETUP: start the audio server (type 96; ct 8 AAC-ELD mirror / 4 AAC-LC / 2 ALAC). spf = samples/frame. */
    private val onMirrorAudioStart: (sampleRate: Int, channels: Int, codecType: Int, framesPerPacket: Int) -> Pair<Int, Int> = { _, _, _, _ -> 0 to 0 },
    /** AirPlay 2 mirror TEARDOWN of just the audio stream (type 96) — stop audio, keep video. */
    private val onMirrorAudioStop: () -> Unit = {},
    /** AirPlay 2 mirror TEARDOWN of just the video stream (type 110) — stop video, keep audio. */
    private val onMirrorVideoStop: () -> Unit = {},
    /** Sender volume change (AirPlay dB: −30…0, or ≤ −144 = mute) via SET_PARAMETER. */
    private val onVolume: (Float) -> Unit = {},
    /** Now-playing track metadata (DMAP) from SET_PARAMETER — any field may be null. */
    private val onNowPlayingMetadata: (title: String?, artist: String?, album: String?) -> Unit = { _, _, _ -> },
    /** Album artwork (JPEG/PNG bytes) from SET_PARAMETER; empty bytes = artwork cleared. */
    private val onArtwork: (ByteArray) -> Unit = {},
    /** AirPlay video URL mode: POST /play with a media URL + start fraction (0..1). */
    private val onVideoPlay: (String, Double, Double?, ((String) -> ByteArray)?) -> Unit = { _, _, _, _ -> },
    /** AirPlay video transport: POST /rate (≤0 pause, >0 resume). */
    private val onVideoRate: (rate: Float) -> Unit = {},
    /** AirPlay video transport: POST /scrub — seek to position (seconds). */
    private val onVideoScrub: (positionSec: Double) -> Unit = {},
    /** AirPlay video transport: POST /stop — stop URL playback. */
    private val onVideoStop: () -> Unit = {},
    /** Current URL-video playback snapshot for GET /playback-info and GET /scrub. */
    private val onPlaybackInfo: () -> com.airplay.airplay.PlaybackInfo? = { null },
    /** Sender's DACP reverse-control identity from RTSP headers (DACP-ID + Active-Remote token). */
    private val onRemoteControlInfo: (dacpId: String?, activeRemote: String?) -> Unit = { _, _ -> },
    /** When true, require HomeKit-style SRP PIN pairing before streaming (gated by AppSettings). */
    private val pinAuthEnabled: Boolean = false,
    /** Persistent store of paired controllers' Ed25519 keys (for pair-verify). */
    private val pairingStore: com.airplay.airplay.handshake.PairingStore? = null,
    /** Shows ([pin]) or hides (null) the on-screen pairing PIN during SRP pair-setup. */
    private val onShowPin: (pin: String?) -> Unit = {},
    /**
     * Audio-only grace guard: returns true while RTP audio is still arriving on the UDP data port.
     * Wired by AirPlayReceiver to the running AudioStreamServer's last-packet timestamp. Default
     * false keeps the old behaviour for callers/tests that don't provide a media pipeline.
     */
    private val isAudioOnlyFlowing: () -> Boolean = { false },
    /** Grace-guard cadence and silence window. Defaults are the shipped values; tests shrink them. */
    private val audioOnlyGraceTickMs: Long = AUDIO_ONLY_GRACE_TICK_MS,
    private val audioOnlyGraceSilenceMs: Long = AUDIO_ONLY_GRACE_SILENCE_MS
) {

    // ─── Legacy AirPlay SRP PIN pairing (only used when pinAuthEnabled) ───────
    @Volatile private var legacyPin: com.airplay.airplay.handshake.LegacyPairSetupPin? = null
    // True once a controller has completed SRP PIN pairing. Until then, with PIN auth on, we reject
    // pair-verify — which is what makes macOS fall back to the /pair-pin-start + /pair-setup-pin PIN
    // flow (an accepted pair-verify means "already trusted, no PIN needed").
    @Volatile private var pinPaired = false

    /** Last volume the sender set (AirPlay dB); returned to GET_PARAMETER volume queries. */
    @Volatile private var currentVolume: Float = 0f

    @Volatile private var serverSocket: ServerSocket? = null

    @Volatile
    private var activeClient: Socket? = null
    @Volatile private var disconnectedClient: Socket? = null

    @Volatile private var reverse: AirPlayVideoChannel? = null
    @Volatile private var videoPeer: java.net.InetAddress? = null
    @Volatile private var videoSession: String? = null

    fun videoState(state: String) {
        reverse?.takeIf { it.socket.inetAddress == videoPeer && it.session == videoSession }?.state(state)
        if (state == "stopped") { videoPeer = null; videoSession = null }
    }

    fun disconnectSender() {
        val socket = activeClient
        if (socket != null) {
            disconnectedClient = socket
            runCatching { socket.close() }
        }
        if (onPlaybackInfo() != null) onVideoStop()
        stopAudioOnlyGrace(release = true)
    }

    /** True while the RTSP server is accepting. `internal` so unit tests can stand it up without a socket. */
    @Volatile
    internal var running = false

    private val clients = java.util.concurrent.ConcurrentHashMap.newKeySet<Socket>()

    @Volatile
    private var currentSession: SessionDescription? = null

    /** Per-connection AirPlay pairing state (pair-setup / pair-verify). */
    @Volatile
    private var pairingSession: PairingSession? = null

    /** Per-connection FairPlay state (fp-setup handshake + stream-key decrypt). */
    @Volatile
    private var fairPlay: FairPlay? = null

    /** Remote (sender) address of the active control connection — needed for AirPlay 2 NTP. */
    @Volatile
    private var currentRemoteAddress: java.net.InetAddress? = null

    /** True once an AirPlay 2 mirroring SETUP has run on this connection (no ANNOUNCE/SDP). */
    @Volatile
    private var isMirrorSession = false

    /**
     * True when the sender declared a screen-mirroring session (`isScreenMirroringSession` in the
     * first SETUP, or `usingScreen` in a type-96 stream). AirPlay 2 audio-only output omits both.
     * Sticky within a connection: the second SETUP (msg 2 / streams) does not repeat the flag.
     */
    @Volatile private var isScreenMirroringSession = false

    // ─── AirPlay 2 audio-only control-connection grace ────────────────────────
    // iOS closes the RTSP control socket ~2 s after an audio-only SETUP while it keeps sending RTP
    // to the UDP data port. The `finally` below used to treat that EOF as session end and stopped
    // the audio server, so playback died after a short burst. The guard keeps the pipeline alive
    // until the RTP stream really goes quiet (or a TEARDOWN / new mirror session takes over).
    @Volatile private var audioOnlyGraceActive = false
    private val audioOnlyGraceLock = Any()
    private var audioOnlyGraceThread: Thread? = null

    /** Mirror stream types currently active (96 = audio, 110 = video). Drives TEARDOWN routing.
     *  `protected` so tests can seed it without driving the full FairPlay SETUP handshake. */
    protected val activeStreamTypes = mutableSetOf<Int>()

    private var setupCount = 0

    private val requestReader = RtspRequestReader(
        maxMessageBytes = MAX_MESSAGE_BYTES,
        maxPhotoBytes = PhotoHandler.MAX_PHOTO_BYTES
    )

    /**
     * Callback for decoded H.264 NAL units from the RTP stream.
     * Set by [AirPlayReceiver] after RECORD — wires to [VideoDecoder.decodeNalUnit].
     * Null for audio-only streams.
     */
    @Volatile
    var onVideoNalUnit: ((nalUnit: ByteArray, ptsUs: Long) -> Unit)? = null

    /** Starts the RTSP server. */
    fun start(scope: CoroutineScope) {
        running = true
        scope.launch(Dispatchers.IO) {
            runServer(this)
        }
    }

    /** Stops the RTSP server. */
    fun stop() {
        running = false
        reverse?.close()
        reverse = null
        videoPeer = null
        stopAudioOnlyGrace(release = false)
        try {
            clients.forEach { runCatching { it.close() } }
            serverSocket?.close()
        } catch (e: Exception) {
            Logger.e("Error closing RTSP sockets (non-fatal)", e)
        }
        activeClient = null
        serverSocket = null
        Logger.i("RTSP handler stopped")
    }

    private fun bindRtspSocket(port: Int): ServerSocket {
        val socket = ServerSocket()
        try {
            socket.reuseAddress = true
            socket.bind(java.net.InetSocketAddress(port))
            return socket
        } catch (error: java.io.IOException) {
            socket.close()
            throw error
        }
    }

    private fun runServer(scope: CoroutineScope) {
        try {
            val listener = try {
                bindRtspSocket(RTSP_PORT)
            } catch (_: java.net.BindException) {
                bindRtspSocket(0)
            }
            serverSocket = listener
            if (!running || !scope.isActive) { listener.close(); return }
            onListening(listener.localPort)
            Logger.i("RTSP server listening on port ${listener.localPort}")

            while (running && scope.isActive) {
                val clientSocket = listener.accept()
                Logger.i("New client connected: ${clientSocket.inetAddress.hostAddress}")

                if (clients.size >= 6) { clientSocket.close(); continue }
                clients.add(clientSocket)
                if (!running || !scope.isActive) { clients.remove(clientSocket); clientSocket.close(); return }
                scope.launch { handleClient(clientSocket) }

            }
        } catch (e: Exception) {
            if (running) {
                onListenFailure()
                Logger.e("RTSP server error (unexpected)", e)
            } else {
                Logger.d("RTSP server socket closed (expected during shutdown)")
            }
        }
    }

    private fun handleClient(socket: Socket) {
        try {
            val inputStream = socket.getInputStream()
            val outputStream = socket.getOutputStream()
            val pairing by lazy { PairingSession(PairingKeys.get(context)) }
            val fairPlayHandshake by lazy { FairPlay() }
            socket.soTimeout = 5000

            while (running && !socket.isClosed) {
                val request = requestReader.read(inputStream) ?: break
                val sequence = request.headers["CSeq"]?.toIntOrNull()
                val path = request.uri.substringBefore("?")
                if (request.method == "GET" && (path == "/info" || path == "/server-info")) {
                    sendResponse(outputStream, routeGet(request), sequence)
                    if (request.headers["Connection"].equals("close", ignoreCase = true)) return
                    continue
                }
                val busy = activeClient?.inetAddress?.let { it != socket.inetAddress } == true ||
                    videoPeer?.let { it != socket.inetAddress && onPlaybackInfo() != null } == true
                if (busy) {
                    sendResponse(outputStream, RtspResponse(503, "Service Unavailable", protocol = request.responseProtocol()), sequence)
                    return
                }
                if (request.method == "POST" && path == "/reverse") {
                    val id = request.headers["X-Apple-Session-ID"].orEmpty()
                    if (!request.headers["Upgrade"].equals("PTTH/1.0", true) || id.length > 128 ||
                        id.any { it.code !in 33..126 } || (pinAuthEnabled && !pinPaired)) {
                        sendResponse(outputStream, RtspResponse(400, "Bad Request", protocol = request.responseProtocol()), sequence)
                        return
                    }
                    val channel = AirPlayVideoChannel(socket, id)
                    synchronized(this) {
                        reverse?.close()
                        sendResponse(outputStream, RtspResponse(101, "Switching Protocols",
                            headers = mapOf("Connection" to "Upgrade", "Upgrade" to "PTTH/1.0"), protocol = "HTTP/1.1"), null)
                        reverse = channel
                    }
                    try {
                        socket.soTimeout = 0
                        val buffer = ByteArray(2048)
                        while (running && inputStream.read(buffer) >= 0) { /* PTTH event acknowledgements */ }
                    } finally {
                        synchronized(this) { if (reverse === channel) reverse = null }
                        channel.close()
                    }
                    return
                }
                val mediaResponse = when ("${request.method} $path") {
                    "POST /pair-setup" -> handlePairSetup(request, pairing)
                    "POST /pair-verify" -> handlePairVerify(request, pairing)
                    "POST /fp-setup" -> handleFpSetup(request, fairPlayHandshake)
                    "POST /fp-setup2" -> RtspResponse(421, "Misdirected Request", protocol = request.responseProtocol())
                    "POST /play", "POST /action", "POST /rate", "POST /scrub", "POST /stop",
                    "GET /scrub", "GET /playback-info" -> synchronized(this) { videoControl(request, socket) }
                    else -> null
                }
                if (mediaResponse != null) {
                    sendResponse(outputStream, mediaResponse, sequence)
                    if (request.headers["Connection"].equals("close", true)) return
                    continue
                }
                if (activeClient !== socket) {
                    synchronized(this) {
                        if (!running || activeClient != null) {
                            sendResponse(outputStream, RtspResponse(503, "Service Unavailable",
                                protocol = request.responseProtocol()), sequence)
                            return
                        }
                        activeClient = socket
                    }
                    pairingSession = pairing
                    fairPlay = fairPlayHandshake
                    currentRemoteAddress = socket.inetAddress
                    socket.soTimeout = 60_000
                }
                val response = routeRequest(request)
                sendResponse(outputStream, response, sequence)
                if (response.headers["Connection"] == "close") return
                if (request.method == "SETUP" && response.statusCode == 200) socket.soTimeout = 0

                // After RECORD on a legacy SDP session: a session WITH video switches to interleaved
                // RTP (video arrives $-framed over this TCP socket). An audio-only session (e.g. Apple
                // Music) keeps the RTSP control loop — audio arrives on the UDP port, and macOS sends
                // now-playing metadata / volume / FLUSH / TEARDOWN as RTSP requests here that we must
                // keep handling (switching to interleaved mode would skip them → no metadata).
                if (request.method == "RECORD" && response.statusCode == 200 && !isMirrorSession &&
                    currentSession?.hasVideo == true) {
                    Logger.d("RTSP handshake complete — switching to interleaved RTP (video)")
                    break
                }
            }

            val session = currentSession
            if (activeClient === socket && session != null && session.hasVideo && running) {
                RtpInterleaved.readLoop(
                    inputStream = inputStream,
                    onVideoNalUnit = { nalUnit, ptsUs ->
                        onVideoNalUnit?.invoke(nalUnit, ptsUs)
                    },
                    onStreamEnded = {
                        Logger.i("RTP stream ended")
                    }
                )
            }
        } catch (e: Exception) {
            if (running) Logger.e("Error handling RTSP client", e)
        } finally {
            Logger.i("Client disconnected")
            runCatching { socket.close() }
            clients.remove(socket)
            synchronized(this) {
                if (activeClient === socket) {
                    try { handleControlConnectionClosed(allowAudioGrace = socket !== disconnectedClient) }
                    finally { disconnectedClient = null; activeClient = null }
                }
            }
        }
    }

    /**
     * Bookkeeping for a closed control connection: reset the per-connection state and decide
     * whether the media pipeline survives the EOF.
     *
     * WHY THIS IS ITS OWN METHOD: the decision (and the audio-only grace guard it can arm) is the
     * whole point of the fix for AirPlay 2 audio-only sessions, and it has to be unit-testable
     * without a real socket. `internal` so the test source set can drive it.
     */
    internal fun handleControlConnectionClosed(allowAudioGrace: Boolean = true) {
        // Decide BEFORE clearing the per-connection state. AirPlay 2 "audio only" (iPhone control
        // centre → pick speaker, without screen mirroring) negotiates just one type-96 ALAC stream
        // and has no screen flag. Its control socket is closed by the sender while RTP keeps
        // flowing; keep the media pipeline alive in that case.
        val audioOnlyKeepAlive = allowAudioGrace && audioEnabled && running &&
            !isScreenMirroringSession &&
            activeStreamTypes.isNotEmpty() && activeStreamTypes.all { it == 96 }
        currentSession = null
        pairingSession = null
        fairPlay = null
        isMirrorSession = false
        activeStreamTypes.clear()
        setupCount = 0
        when {
            allowAudioGrace && onPlaybackInfo() != null -> Unit // URL playback outlives an HTTP request.
            audioOnlyGraceActive -> {
                // A later /info probe connection also closed; the guard already owns teardown.
                Logger.d("Audio-only: grace guard already active (side connection closed)")
            }
            audioOnlyKeepAlive -> {
                Logger.i("Audio-only: sender declared audio-only (audioEnabled=$audioEnabled) — arming grace guard")
                startAudioOnlyGrace()
            }
            else -> onStreamingStopped()
        }
        isScreenMirroringSession = false
    }

    /** Normalises the boolean representations dd-plist / XML plist can produce. */
    private fun plistBool(value: Any?): Boolean = when (value) {
        is Boolean -> value
        is Number -> value.toInt() != 0
        is String -> value.equals("true", ignoreCase = true) || value == "1"
        else -> false
    }

    /**
     * AirPlay 2 audio-only: the sender closes the RTSP control connection shortly after SETUP but
     * keeps playing, with RTP still arriving on the UDP data port. Tearing the session down at that
     * EOF stops the audio server mid-song (and clears the stream keys) — the "sound for a second,
     * then silence while the phone still shows playing" symptom. Hand ownership to a grace guard:
     * it ends the session only once the RTP stream has actually gone quiet.
     *
     * Screen mirroring is untouched: it declares `isScreenMirroringSession` / `usingScreen`, so it
     * never reaches this path. A session TEARDOWN, a new mirror session, or stop() cancels the guard.
     */
    private fun startAudioOnlyGrace() {
        synchronized(audioOnlyGraceLock) {
            if (audioOnlyGraceActive) return
            audioOnlyGraceActive = true
            audioOnlyGraceThread = Thread({
                try {
                    var silentMs = 0L
                    var ticks = 0
                    var lastFlowing: Boolean? = null
                    while (running && audioOnlyGraceActive) {
                        Thread.sleep(audioOnlyGraceTickMs)
                        val flowing = isAudioOnlyFlowing()
                        silentMs = if (flowing) 0L else silentMs + audioOnlyGraceTickMs
                        ticks++
                        // Log state changes plus a sparse heartbeat (every 10th tick) so a support
                        // log shows whether the sender kept sending RTP, without spam.
                        if (flowing != lastFlowing || ticks % 10 == 0) {
                            Logger.d("Audio-only: grace tick flowing=$flowing silentMs=$silentMs ticks=$ticks")
                        }
                        lastFlowing = flowing
                        if (silentMs >= audioOnlyGraceSilenceMs) {
                            Logger.i("Audio-only: no RTP for ${silentMs}ms — ending session")
                            stopAudioOnlyGrace(release = true)
                        }
                    }
                } catch (_: InterruptedException) { /* normal shutdown */ }
            }, "airplay-audio-only-grace").apply { isDaemon = true; start() }
        }
        Logger.i("Audio-only: control connection closed — keeping UDP audio alive (grace ${audioOnlyGraceSilenceMs}ms)")
    }

    /** Cancels the grace guard; [release] = true performs the deferred full teardown. */
    private fun stopAudioOnlyGrace(release: Boolean) {
        val wasActive = synchronized(audioOnlyGraceLock) {
            val was = audioOnlyGraceActive
            audioOnlyGraceActive = false
            audioOnlyGraceThread?.interrupt()
            audioOnlyGraceThread = null
            was
        }
        if (wasActive) {
            Logger.d("Audio-only: grace guard cleared release=$release")
            if (release) onStreamingStopped()
        }
    }

    private fun routeRequest(request: RtspRequest): RtspResponse {
        Logger.d("RTSP ${request.method} ${request.uri}")
        // Senders attach their DACP reverse-control identity to most requests — capture it so the TV
        // remote can drive playback (DacpClient dedups, so this is cheap to call repeatedly).
        request.headers["Active-Remote"]?.let { onRemoteControlInfo(request.headers["DACP-ID"], it) }
        return when (request.method) {
            "OPTIONS"       -> handleOptionsInternal(request)
            "ANNOUNCE"      -> handleAnnounceInternal(request)
            // AirPlay 2 mirroring SETUP carries a binary plist; legacy audio SETUP carries SDP-ish text.
            "SETUP"         -> if (request.isPlistBody()) handleMirrorSetup(request) else handleSetupInternal(request)
            "RECORD"        -> handleRecordInternal(request)
            "TEARDOWN"      -> handleTeardownInternal(request)
            "GET_PARAMETER" -> handleGetParameter(request)
            "SET_PARAMETER" -> handleSetParameter(request)
            "FLUSH"         -> handleFlush(request)
            "PAUSE"         -> handlePauseInternal(request)
            "PUT"           -> handlePhotoPutInternal(request)
            "DELETE"        -> handlePhotoDeleteInternal(request)
            // AirPlay 2 handshake is HTTP-style (GET/POST with bodies) over the RTSP socket.
            "GET"           -> routeGet(request)
            "POST"          -> routePost(request)
            else            -> handleUnknownInternal(request)
        }
    }

    /** Routes AirPlay 2 GET requests by URI path. */
    private fun routeGet(request: RtspRequest): RtspResponse = when (request.uri.substringBefore("?")) {
        "/info"          -> handleInfo(request)
        "/server-info"   -> handleServerInfo(request)
        else             -> handleUnknownInternal(request)
    }

    /** Routes AirPlay 2 POST requests by URI path. */
    private fun routePost(request: RtspRequest): RtspResponse = when (request.uri.substringBefore("?")) {
        "/pair-setup-pin" -> handleLegacyPairSetupPin(request)   // legacy AirPlay PIN SRP (plist)
        "/pair-pin-start" -> handlePairPinStart(request)
        "/feedback"    -> handleFeedback(request)
        "/audioMode"   -> RtspResponse(200, "OK", protocol = request.responseProtocol())
        else           -> handleUnknownInternal(request)
    }

    // ─── AirPlay video URL mode (POST /play, /rate, /scrub, /stop; GET /playback-info, /scrub) ──

    private fun videoControl(request: RtspRequest, socket: Socket): RtspResponse {
        val peer = socket.inetAddress
        val id = request.headers["X-Apple-Session-ID"]
        val channel = reverse?.takeIf { it.socket.inetAddress == peer && (id == null || id == it.session) }
        val path = request.uri.substringBefore("?")
        fun response(code: Int, reason: String) = RtspResponse(code, reason, protocol = request.responseProtocol())
        if (pinAuthEnabled && !pinPaired) return response(470, "Connection Authorization Required")
        if (videoPeer != null && onPlaybackInfo() != null && videoPeer != peer) return response(503, "Service Unavailable")
        if (path != "/play" && videoSession != null && id != null && id != videoSession)
            return response(409, "Session Changed")
        if (path == "/action") {
            val message = runCatching { PlistCodec.decode(request.bodyBytes) }.getOrNull()
            return if (message != null && channel?.complete(message) == true) response(200, "OK")
                   else response(400, "Invalid Media Response")
        }
        if (path != "/play") return when (path) {
            "/rate" -> handleVideoRate(request)
            "/stop" -> handleVideoStop(request)
            "/scrub" -> if (request.method == "GET") handleScrubGet(request) else handleVideoScrubPost(request)
            else -> handlePlaybackInfo(request)
        }
        val fields: Map<String, Any?> = if (request.isPlistBody() || request.body.trimStart().startsWith("<")) {
            runCatching { PlistCodec.decode(request.bodyBytes) }.getOrNull() ?: return response(400, "Bad Plist")
        } else request.body.lineSequence().filter { ':' in it }.associate {
            it.substringBefore(':').trim() to it.substringAfter(':').trim()
        }
        fun field(key: String) = fields.entries.firstOrNull { it.key.equals(key, true) }?.value
        fun number(key: String) = field(key)?.toString()?.toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0 }
        val url = field("Content-Location") as? String ?: return response(400, "No Media URL")
        val relayed = url.startsWith("mlhls://localhost/")
        if (relayed && (channel == null || url.length > MediaUriPolicy.MAX_URI_LENGTH)) return response(400, "No Media Channel")
        if (!relayed && MediaUriPolicy.check(url) != null) return response(400, "Invalid Media URL")
        videoPeer = peer
        videoSession = id ?: channel?.session
        stopAudioOnlyGrace(release = false)
        videoState("loading")
        onVideoPlay(url, number("Start-Position")?.coerceIn(0.0, 1.0) ?: 0.0, number("Start-Position-Seconds"),
            if (relayed) requireNotNull(channel)::fetch else null)
        return response(200, "OK")
    }

    /** POST /rate?value=X — X=0 pause, X≥1 resume. */
    private fun handleVideoRate(request: RtspRequest): RtspResponse {
        val rate = queryParam(request.uri, "value")?.toFloatOrNull() ?: 1f
        Logger.d("POST /rate value=$rate")
        onVideoRate(rate)
        if (rate <= 0) videoState("paused") else if (onPlaybackInfo()?.readyToPlay == true) videoState("playing")
        return RtspResponse(200, "OK", protocol = request.responseProtocol())
    }

    /** POST /scrub?position=N — seek to N seconds. */
    private fun handleVideoScrubPost(request: RtspRequest): RtspResponse {
        queryParam(request.uri, "position")?.toDoubleOrNull()?.let {
            Logger.d("POST /scrub position=$it")
            onVideoScrub(it)
        }
        return RtspResponse(200, "OK", protocol = request.responseProtocol())
    }

    /** GET /scrub — current position + duration as text/parameters. */
    private fun handleScrubGet(request: RtspRequest): RtspResponse {
        val info = onPlaybackInfo()
        val body = "duration: %.6f\r\nposition: %.6f\r\n".format(info?.durationSec ?: 0.0, info?.positionSec ?: 0.0)
        return RtspResponse(200, "OK", body = body, contentType = "text/parameters", protocol = request.responseProtocol())
    }

    /** POST /stop — stop URL playback. */
    private fun handleVideoStop(request: RtspRequest): RtspResponse {
        Logger.i("POST /stop (video URL)")
        onVideoStop()
        return RtspResponse(200, "OK", protocol = request.responseProtocol())
    }

    /** GET /playback-info — XML plist describing current position/duration/rate/ready state. */
    private fun handlePlaybackInfo(request: RtspRequest): RtspResponse {
        val info = onPlaybackInfo()
        val plist: Map<String, Any?> = if (info == null || !info.readyToPlay) {
            mapOf("readyToPlay" to false)
        } else {
            val ranges = listOf(mapOf("start" to 0.0, "duration" to info.durationSec))
            mapOf(
                "duration" to info.durationSec,
                "position" to info.positionSec,
                "rate" to info.rate,
                "readyToPlay" to true,
                "playbackBufferEmpty" to false,
                "playbackBufferFull" to true,
                "playbackLikelyToKeepUp" to true,
                "loadedTimeRanges" to ranges,
                "seekableTimeRanges" to ranges,
            )
        }
        return RtspResponse(
            200, "OK",
            bodyBytes = PlistCodec.encodeXml(plist),
            contentType = "text/x-apple-plist+xml",
            protocol = request.responseProtocol()
        )
    }

    /** GET /server-info — legacy XML plist of receiver identity for AirPlay video senders. */
    private fun handleServerInfo(request: RtspRequest): RtspResponse {
        val info = mapOf(
            "deviceid" to com.airplay.util.NetworkUtils.getReceiverId(context),
            "features" to InfoResponder.features(pinAuthEnabled, hevc),
            "model" to InfoResponder.MODEL,
            "protovers" to "1.1",
            "srcvers" to InfoResponder.SOURCE_VERSION,
        )
        return RtspResponse(
            200, "OK",
            bodyBytes = PlistCodec.encodeXml(info),
            contentType = "text/x-apple-plist+xml",
            protocol = request.responseProtocol()
        )
    }

    /** Extracts a query-string parameter (`?k=v&...`) from a request URI. */
    private fun queryParam(uri: String, key: String): String? =
        uri.substringAfter('?', "").split('&')
            .firstOrNull { it.substringBefore('=') == key }
            ?.substringAfter('=', "")

    /** POST /feedback — macOS health-checks the session every ~2 s; acknowledge with 200 OK. */
    private fun handleFeedback(request: RtspRequest): RtspResponse {
        val n = request.bodyBytes.size
        if (n > 0) {
            runCatching {
                val p = PlistCodec.decode(request.bodyBytes)
                Logger.d("/feedback body ($n B): " + p.entries.joinToString { (k, v) ->
                    "$k=" + when (v) { is ByteArray -> "${v.size}B"; is List<*> -> "list[${v.size}]"; else -> v.toString() }
                })
            }.onFailure { Logger.d("/feedback body ($n B, non-plist)") }
        }
        return RtspResponse(
            200, "OK",
            protocol = request.responseProtocol()
        )
    }

    /** GET /info — an initial qualified TXT query, a capabilities query, or a headerless probe. */
    private fun handleInfo(request: RtspRequest): RtspResponse = try {
        val hasCSeq = request.headers.containsKey("CSeq")
        val contentType = request.headers["Content-Type"]
        val qualifiers = when {
            contentType?.substringBefore(';')?.trim()?.equals(PLIST_TYPE, ignoreCase = true) == true -> {
                (PlistCodec.decode(request.bodyBytes)["qualifier"] as? List<*>).orEmpty().filterIsInstance<String>()
            }
            !hasCSeq -> request.uri.substringAfter('?', "").split('?', '&')
            else -> emptyList()
        }
        val txt = InfoResponder.qualified(context, qualifiers, pinAuthEnabled, hevc)
        val info = if (contentType != null) txt else InfoResponder.capabilities(
            context, receiverName(), displayWidth, displayHeight, displayFps, pinAuthEnabled, hevc, includeMedia = hasCSeq
        ) + txt
        RtspResponse(200, "OK", bodyBytes = PlistCodec.encode(info), contentType = PLIST_TYPE, protocol = request.responseProtocol())
    } catch (error: Exception) {
        Log.w("FcboardProjection", "AirPlay GET /info failed", error)
        RtspResponse(400, "Bad Request", protocol = request.responseProtocol())
    }

    /**
     * POST /pair-setup. With PIN auth off (default) this is the anonymous Ed25519 exchange. With PIN
     * auth on, it runs the HomeKit-style SRP pair-setup (TLV8) — showing a PIN on the TV that the
     * user types on the Mac — so only someone with screen access can pair.
     */
    private fun handlePairSetup(request: RtspRequest, pairing: PairingSession): RtspResponse {
        // /pair-setup is the anonymous key exchange; PIN access control runs on /pair-setup-pin.
        return try {
            val body = pairing.pairSetup(request.bodyBytes)
            Logger.i("pair-setup OK (returned ${body.size}-byte public key)")
            RtspResponse(200, "OK", bodyBytes = body, contentType = OCTET_STREAM, protocol = request.responseProtocol())
        } catch (e: Exception) {
            Logger.e("pair-setup failed", e)
            RtspResponse(400, "Bad Request", protocol = request.responseProtocol())
        }
    }

    /**
     * POST /pair-verify — the anonymous ECDH handshake. AirPlay uses this same raw exchange even with
     * PIN access control on (the PIN is a SEPARATE /pair-pin-start + /pair-setup-pin layer), so this
     * is never the HomeKit TLV8 variant.
     */
    private fun handlePairVerify(request: RtspRequest, pairing: PairingSession): RtspResponse {
        // PIN access control: refuse pair-verify until the controller has PIN-paired this connection.
        // macOS responds to the rejection by starting the PIN flow (/pair-pin-start → /pair-setup-pin).
        if (pinAuthEnabled && !pinPaired) {
            Logger.i("pair-verify rejected — PIN pairing required first (triggers /pair-pin-start)")
            return RtspResponse(470, "Connection Authorization Required", protocol = request.responseProtocol())
        }
        return try {
            val body = pairing.pairVerify(request.bodyBytes)
            Logger.i("pair-verify ${if (request.bodyBytes.firstOrNull()?.toInt() == 1) "M1" else "M2"} OK (returned ${body.size} bytes)")
            RtspResponse(200, "OK", bodyBytes = body, contentType = OCTET_STREAM, protocol = request.responseProtocol())
        } catch (e: Exception) {
            Logger.e("pair-verify failed", e)
            RtspResponse(470, "Connection Authorization Required", protocol = request.responseProtocol())
        }
    }

    /**
     * POST /pair-pin-start — macOS asks the receiver to begin PIN pairing and display the code. We
     * generate + show the PIN and prime the SRP session, then reply 200; the SRP exchange follows on
     * /pair-setup-pin. (This precedes pair-setup in the AirPlay PIN flow — see the logs.)
     */
    private fun handlePairPinStart(request: RtspRequest): RtspResponse {
        if (!pinAuthEnabled) return handleUnknownInternal(request)
        if ((pairingStore?.failedAttempts() ?: 0) >= MAX_PAIR_ATTEMPTS) {
            Logger.w("pair-pin-start blocked — PIN auth locked ($MAX_PAIR_ATTEMPTS failed attempts)")
            return RtspResponse(470, "Connection Authorization Required", protocol = request.responseProtocol())
        }
        newSrpSession()
        Logger.i("pair-pin-start — PIN shown, SRP session primed")
        return RtspResponse(200, "OK", protocol = request.responseProtocol())
    }

    /** Generates a fresh 4-digit PIN, shows it on the TV, and primes the legacy SRP session. */
    private fun newSrpSession() {
        val pin = "%0${PIN_DIGITS}d".format(java.security.SecureRandom().nextInt(PIN_SPACE))
        onShowPin(pin)
        legacyPin = com.airplay.airplay.handshake.LegacyPairSetupPin(pin, PairingKeys.get(context).edPublic)
    }

    /**
     * POST /pair-setup-pin — the legacy AirPlay plist SRP exchange. Step 1 ({method,user}) returns
     * {pk,salt}; step 2 ({pk,proof}) verifies the PIN and returns {proof}. On success the controller
     * is allowed past pair-verify (→ streaming). Bounded by the failed-attempt lockout.
     */
    private fun handleLegacyPairSetupPin(request: RtspRequest): RtspResponse {
        if (!pinAuthEnabled) return handleUnknownInternal(request)
        if ((pairingStore?.failedAttempts() ?: 0) >= MAX_PAIR_ATTEMPTS) {
            Logger.w("pair-setup-pin blocked — PIN auth locked ($MAX_PAIR_ATTEMPTS failed attempts)")
            onShowPin(null)
            return RtspResponse(470, "Connection Authorization Required", protocol = request.responseProtocol())
        }
        return try {
            val plist = PlistCodec.decode(request.bodyBytes)
            if (legacyPin == null) newSrpSession()   // step 1 may arrive without a prior /pair-pin-start
            val result = legacyPin!!.handle(plist)
            if (result.failed) {
                val n = pairingStore?.recordFailedAttempt() ?: 0
                Logger.w("pair-setup-pin attempt failed ($n/$MAX_PAIR_ATTEMPTS)")
                onShowPin(null); legacyPin = null
                return RtspResponse(470, "Connection Authorization Required", protocol = request.responseProtocol())
            }
            if (result.complete) {
                pairingStore?.resetFailedAttempts()   // legitimate pairing clears the lockout counter
                pinPaired = true                       // now allow pair-verify → streaming proceeds
                onShowPin(null); legacyPin = null
                Logger.i("PIN pairing complete — pair-verify now permitted")
            }
            RtspResponse(
                200, "OK",
                bodyBytes = PlistCodec.encode(result.reply!!),
                contentType = "application/x-apple-binary-plist",
                protocol = request.responseProtocol()
            )
        } catch (e: Exception) {
            Logger.e("pair-setup-pin failed", e)
            onShowPin(null); legacyPin = null
            RtspResponse(400, "Bad Request", protocol = request.responseProtocol())
        }
    }

    /** POST /fp-setup — FairPlay: 16-byte phase 1 → 142-byte reply; 164-byte phase 2 → 32-byte reply. */
    private fun handleFpSetup(request: RtspRequest, fp: FairPlay): RtspResponse = try {
        val b = request.bodyBytes
        // Diagnostics: byte 4 is the FairPlay version (0x03 mirroring/Safari, 0x02 Apple Music audio);
        // for phase 1, byte 14 is the mode (0..3). Confirms which path a given sender uses.
        val verMode = if (b.size >= 16) " v=0x%02x mode=%d".format(b[4].toInt() and 0xFF, b[14].toInt() and 0xFF)
                      else if (b.size >= 5) " v=0x%02x".format(b[4].toInt() and 0xFF) else ""
        val body = when (b.size) {
            16 -> fp.setup(b)
            164 -> fp.handshake(b)
            else -> throw IllegalArgumentException("unexpected fp-setup size ${b.size}")
        }
        Logger.i("fp-setup phase (${b.size}B in → ${body.size}B out)$verMode OK")
        RtspResponse(200, "OK", bodyBytes = body, contentType = OCTET_STREAM, protocol = request.responseProtocol())
    } catch (e: Exception) {
        Logger.e("fp-setup failed", e)
        RtspResponse(400, "Bad Request", protocol = request.responseProtocol())
    }

    /**
     * AirPlay 2 mirroring SETUP (binary plist). Two messages arrive on one connection:
     *  - msg 1 carries `ekey`+`eiv`+`timingPort` → FairPlay-decrypt the AES key, hand it
     *    (with the pairing secret) to the receiver, reply with event/timing ports.
     *  - msg 2 carries `streams`[type 110] → start the mirror data server, reply with its port.
     */
    internal fun handleMirrorSetup(request: RtspRequest): RtspResponse = try {
        val req = PlistCodec.decode(request.bodyBytes)
        Logger.i("mirror SETUP plist: " + req.entries.joinToString { (k, v) ->
            "$k=" + when (v) {
                is ByteArray -> "${v.size}B"
                is List<*> -> "list[${v.size}]"
                else -> v.toString()
            }
        })
        val response = mutableMapOf<String, Any?>()

        val setupStreams = req["streams"] as? List<*>
        val ekey = req["ekey"] as? ByteArray
        require(ekey != null || !setupStreams.isNullOrEmpty()) { "SETUP has neither FairPlay keys nor streams" }
        val usingScreen = setupStreams.orEmpty().any { s ->
            (s as? Map<*, *>)?.let { it["type"] == 110L || plistBool(it["usingScreen"]) } == true
        }
        if (ekey != null) {
            val pairing = checkNotNull(pairingSession)
            val ecdhSecret = pairing.sharedSecret
            if ((pinAuthEnabled && (!pinPaired || ecdhSecret == null)) ||
                (pairing.verificationStarted && ecdhSecret == null)
            ) throw SecurityException("AirPlay pair-verify did not complete")
            val aesIv = req["eiv"] as? ByteArray
            require(aesIv?.size == 16) { "Invalid FairPlay IV" }
            val timingProtocol = req["timingProtocol"] as? String
            if (plistBool(req["isRemoteControlOnly"]) || (timingProtocol != null && timingProtocol != "NTP")) {
                throw UnsupportedOperationException("Unsupported AirPlay timing: $timingProtocol")
            }
            val senderTimingPort = req["timingPort"] as? Long ?: 0L
            require(senderTimingPort in 1..65535) { "Missing or invalid AirPlay sender timing port" }
            val remoteAddr = currentRemoteAddress ?: error("mirror SETUP without remote address")
            val aesKey = checkNotNull(fairPlay).decrypt(ekey)
            val mediaKey = MirrorCrypto.mediaKey(aesKey, ecdhSecret)
            val timingPort = onMirrorSetupKeys(mediaKey, checkNotNull(aesIv), remoteAddr, senderTimingPort.toInt())
            check(timingPort in 1..65535) { "AirPlay timing socket unavailable" }
            isMirrorSession = true
            response["eventPort"] = 0L
            response["timingPort"] = timingPort.toLong()
            val version = (req["sourceVersion"] as? String)?.takeIf { it.length <= 20 && it.all { c -> c.isDigit() || c == '.' } }
            Log.i("FcboardProjection", "AirPlay SETUP keys OK (sender=${version ?: "unknown"}, paired=${ecdhSecret != null}, timingPort=$timingPort)")
        }

        check(isMirrorSession) { "AirPlay SETUP streams before SETUP keys" }
        if (plistBool(req["isScreenMirroringSession"]) || usingScreen) {
            stopAudioOnlyGrace(release = false)
            isScreenMirroringSession = true
        }

        if (setupStreams != null) {
            val resStreams = setupStreams.mapNotNull { s ->
                val stream = s as? Map<*, *> ?: return@mapNotNull null
                when ((stream["type"] as? Long)?.toInt()) {
                    110 -> {
                        val scid = stream["streamConnectionID"] as? Long ?: error("Missing streamConnectionID")
                        val control = activeClient
                        val dataPort = onMirrorStreamStart(scid) { runCatching { control?.close() } }
                        check(dataPort in 1..65535) { "AirPlay mirror data socket unavailable" }
                        activeStreamTypes.add(110)
                        Log.i("FcboardProjection", "AirPlay mirror SETUP OK (dataPort=$dataPort)")
                        mapOf("type" to 110L, "dataPort" to dataPort.toLong())
                    }
                    96 -> {
                        // Realtime-audio stream fields (codec type ct, samples-per-frame spf, latencies, …).
                        Logger.d("mirror stream type=96 dict: " + stream.entries.joinToString { (k, v) ->
                            "$k=" + when (v) { is ByteArray -> "${v.size}B"; is List<*> -> "list[${v.size}]"; else -> v.toString() }
                        })
                        if (!audioEnabled) {
                            Logger.i("mirror stream type=96 ignored (audio disabled in settings)")
                            return@mapNotNull null
                        }
                        val sr = (stream["sr"] as? Long)?.toInt() ?: 44100
                        val ch = (stream["channels"] as? Long)?.toInt() ?: 2
                        val ct = (stream["ct"] as? Long)?.toInt() ?: 8   // 8 = AAC-ELD (mirror), 4 = AAC-LC, 2 = ALAC
                        val spf = (stream["spf"] as? Long)?.toInt() ?: 352   // ALAC frameLength (samples/frame)
                        val (dataPort, controlPort) = onMirrorAudioStart(sr, ch, ct, spf)
                        check(dataPort in 1..65535 && controlPort in 1..65535) { "AirPlay audio sockets unavailable" }
                        activeStreamTypes.add(96)
                        Logger.i("audio stream type=96 (ct=$ct ${sr}Hz x$ch spf=$spf) dataPort=$dataPort controlPort=$controlPort")
                        mapOf("type" to 96L, "dataPort" to dataPort.toLong(), "controlPort" to controlPort.toLong())
                    }
                    else -> {
                        Logger.i("mirror SETUP stream dict: " + stream.entries.joinToString { (k, v) ->
                            "$k=" + when (v) { is ByteArray -> "${v.size}B"; else -> v.toString() }
                        })
                        null
                    }
                }
            }
            if (setupStreams.isNotEmpty() && resStreams.isEmpty()) throw UnsupportedOperationException("Unsupported media stream")
            response["streams"] = resStreams
        }

        RtspResponse(
            200, "OK",
            bodyBytes = PlistCodec.encode(response),
            contentType = PLIST_TYPE,
            protocol = request.responseProtocol()
        )
    } catch (error: SecurityException) {
        Log.w("FcboardProjection", "AirPlay SETUP authorization failed", error)
        RtspResponse(470, "Connection Authorization Required", protocol = request.responseProtocol())
    } catch (error: UnsupportedOperationException) {
        Log.w("FcboardProjection", "AirPlay SETUP rejected: ${error.message}")
        RtspResponse(415, "Unsupported Media Type", protocol = request.responseProtocol())
    } catch (e: Exception) {
        Log.w("FcboardProjection", "AirPlay SETUP failed", e)
        RtspResponse(400, "Bad Request", protocol = request.responseProtocol())
    } catch (error: LinkageError) {
        Log.e("FcboardProjection", "AirPlay FairPlay native decoder unavailable", error)
        RtspResponse(500, "Internal Server Error", protocol = request.responseProtocol())
    }

    /** Handles OPTIONS — macOS asks what RTSP methods are supported. */
    open fun handleOptionsInternal(request: RtspRequest): RtspResponse {
        return RtspResponse(
            statusCode = 200,
            statusMessage = "OK",
            headers = mapOf(
                "Public" to "ANNOUNCE, SETUP, RECORD, PAUSE, FLUSH, TEARDOWN, OPTIONS, GET_PARAMETER, SET_PARAMETER"
            )
        )
    }

    /** Handles ANNOUNCE — macOS/iOS sends SDP describing codecs, ports, and encryption. */
    open fun handleAnnounceInternal(request: RtspRequest): RtspResponse {
        Logger.d("ANNOUNCE body (${request.body.length} bytes)")
        val parsed = SdpParser.parse(request.body)

        if (parsed == null) {
            Logger.e("ANNOUNCE: SDP parsing returned no usable session — rejecting")
            return RtspResponse(statusCode = 400, statusMessage = "Bad Request")
        }

        currentSession = parsed.copy(senderName = extractSenderName(request.headers["User-Agent"]))
        val s = currentSession!!
        Logger.i("Session: hasVideo=${s.hasVideo} hasAudio=${s.hasAudio} " +
                 "codec=${s.audioCodec} encrypted=${s.isAudioEncrypted} sender='${s.senderName}'")

        setupCount = 0
        return RtspResponse(statusCode = 200, statusMessage = "OK")
    }

    private fun extractSenderName(userAgent: String?): String {
        if (userAgent.isNullOrBlank()) return DEFAULT_SENDER_NAME
        val name = userAgent.substringBefore("/").trim()
        return name.ifEmpty { DEFAULT_SENDER_NAME }
    }

    /** Handles SETUP — allocates a media channel. */
    open fun handleSetupInternal(request: RtspRequest): RtspResponse {
        setupCount++
        val session = currentSession

        val isVideoSetup = setupCount == 1 && session?.hasVideo == true

        val transport = if (isVideoSetup) {
            "RTP/AVP/TCP;unicast;interleaved=0-1"
        } else {
            "RTP/AVP/UDP;unicast;" +
            "client_port=$AUDIO_RTP_PORT-${AUDIO_RTP_PORT + 1};" +
            "server_port=$AUDIO_RTP_PORT-${AUDIO_RTP_PORT + 1};" +
            "timing-port=${TimingHandler.TIMING_PORT}"
        }

        Logger.d("SETUP #$setupCount — transport: $transport")
        return RtspResponse(
            statusCode = 200,
            statusMessage = "OK",
            headers = mapOf("Session" to SESSION_ID, "Transport" to transport)
        )
    }

    /** Handles RECORD — macOS/iOS says start sending media now. */
    open fun handleRecordInternal(request: RtspRequest): RtspResponse {
        // AirPlay 2 mirroring has no ANNOUNCE/SDP — RECORD just acknowledges the session.
        if (isMirrorSession) {
            Logger.i("RECORD (mirror session) — OK")
            return RtspResponse(
                statusCode = 200, statusMessage = "OK",
                headers = mapOf("Audio-Latency" to "0", "Audio-Jack-Status" to "connected; type=analog"),
                protocol = request.responseProtocol()
            )
        }
        var session = currentSession
        if (session == null) {
            Logger.e("RECORD received but no session from ANNOUNCE — rejecting")
            return RtspResponse(statusCode = 455, statusMessage = "Method Not Valid in This State")
        }
        // RAOP audio (Apple Music) wraps the AES key with FairPlay (SDP `fpaeskey`). Unwrap it via the
        // fp-setup session into the real 16-byte key so the AudioPlayer can AES-CBC-decrypt the stream.
        val fpKey = session.fpAesKey
        if (fpKey != null && session.aesKey == null) {
            val realKey = runCatching { fairPlay?.decrypt(fpKey) }
                .onFailure { Logger.w("RAOP FairPlay audio-key decrypt failed (${fpKey.size}B): ${it.message}") }
                .getOrNull()
            if (realKey != null) {
                Logger.i("RAOP FairPlay (v0x%02x) audio key decrypted → ${realKey.size}B AES key, iv=${session.aesIv?.size ?: 0}B"
                    .format(fairPlay?.negotiatedVersion ?: 0))
                session = session.copy(aesKey = realKey)
                currentSession = session
            }
        }
        Logger.i("RECORD — streaming starting (audioOnly=${session.isAudioOnly}, encrypted=${session.isAudioEncrypted})")
        onStreamingStarted(session)
        return RtspResponse(statusCode = 200, statusMessage = "OK")
    }

    /**
     * Handles TEARDOWN. A TEARDOWN may target SPECIFIC streams (AirPlay 2 dynamic stream removal —
     * e.g. macOS drops the audio stream when playback stops) or the whole session. If the body lists
     * streams and they're audio-only, we stop just the audio and KEEP the mirror running; otherwise
     * we tear the whole session down. (Previously any TEARDOWN killed the mirror, so stopping audio
     * on the Mac ended screen mirroring entirely.)
     */
    open fun handleTeardownInternal(request: RtspRequest): RtspResponse {
        val streamTypes = parseTeardownStreamTypes(request.bodyBytes)
        if (streamTypes != null && streamTypes.isNotEmpty()) {
            // Stream-level teardown: stop ONLY the listed streams. Keep the session (keys, NTP)
            // alive so the remaining stream keeps running and a stopped one can be
            // re-added later — e.g. audio keeps playing with video gone, or video keeps mirroring
            // with audio stopped. But if this removes the LAST active stream (e.g. macOS names both
            // 96 and 110 to end the session), fall through to a full teardown so cleanup isn't left
            // to the eventual socket close.
            if (streamTypes.contains(96)) { onMirrorAudioStop(); activeStreamTypes.remove(96) }
            if (streamTypes.contains(110)) { onMirrorVideoStop(); activeStreamTypes.remove(110) }
            if (activeStreamTypes.isNotEmpty()) {
                Logger.i("TEARDOWN streams=$streamTypes — stopped those, session continues (active=$activeStreamTypes)")
                return RtspResponse(statusCode = 200, statusMessage = "OK", protocol = request.responseProtocol())
            }
            Logger.i("TEARDOWN streams=$streamTypes — last stream removed, ending session")
        } else {
            Logger.i("TEARDOWN (session, body=${request.bodyBytes.size}B) — streaming stopping")
        }
        activeStreamTypes.clear()
        isMirrorSession = false
        isScreenMirroringSession = false
        // A genuine sender-initiated TEARDOWN ends the audio-only grace without a second teardown.
        stopAudioOnlyGrace(release = false)
        return RtspResponse(statusCode = 200, statusMessage = "OK",
            headers = mapOf("Connection" to "close"), protocol = request.responseProtocol())
    }

    /** Parses the `streams` list from a TEARDOWN body, returning the stream `type`s, or null. */
    private fun parseTeardownStreamTypes(body: ByteArray): List<Int>? = runCatching {
        if (body.isEmpty()) return@runCatching null
        val streams = PlistCodec.decode(body)["streams"] as? List<*> ?: return@runCatching null
        streams.mapNotNull { ((it as? Map<*, *>)?.get("type") as? Long)?.toInt() }
    }.getOrNull()

    private fun handleGetParameter(request: RtspRequest): RtspResponse {
        val query = request.body.trim()
        Logger.i("GET_PARAMETER body='$query'")
        // macOS queries "volume" during setup and aborts if it gets no value back. Report the
        // last value the sender set so its volume slider reflects the receiver.
        return if (query.startsWith("volume")) {
            RtspResponse(
                statusCode = 200, statusMessage = "OK",
                body = "volume: %.6f\r\n".format(currentVolume),
                contentType = "text/parameters",
                protocol = request.responseProtocol()
            )
        } else {
            RtspResponse(statusCode = 200, statusMessage = "OK", protocol = request.responseProtocol())
        }
    }

    private fun handleSetParameter(request: RtspRequest): RtspResponse {
        val body = request.body
        val contentType = request.headers["Content-Type"]?.lowercase() ?: ""
        // Text bodies carry "volume: <dB>"; binary bodies carry DMAP now-playing metadata or artwork.
        when {
            body.startsWith("volume") -> {
                body.substringAfter(":").trim().toFloatOrNull()?.let { v ->
                    currentVolume = v
                    onVolume(v)
                    Logger.d("SET_PARAMETER volume=$v")
                }
            }
            contentType.startsWith("image/") -> {
                // Album artwork (image/jpeg, image/png). A zero-length body clears it.
                onArtwork(request.bodyBytes)
                Logger.i("SET_PARAMETER artwork (${request.bodyBytes.size}B, $contentType)")
            }
            contentType.contains("dmap") || looksLikeDmap(request.bodyBytes) -> {
                val meta = DmapParser.parseNowPlaying(request.bodyBytes)
                onNowPlayingMetadata(meta.title, meta.artist, meta.album)
                Logger.i("SET_PARAMETER now-playing: title='${meta.title}' artist='${meta.artist}' album='${meta.album}'")
            }
            else -> Logger.d("SET_PARAMETER (${request.bodyBytes.size}B, $contentType, unhandled)")
        }
        return RtspResponse(statusCode = 200, statusMessage = "OK")
    }

    /** Heuristic: a DMAP body starts with the `mlit` listing-item container tag. */
    private fun looksLikeDmap(body: ByteArray): Boolean =
        body.size >= 8 && String(body, 0, 4, Charsets.US_ASCII) == "mlit"

    /** Handles any unrecognized RTSP method. */
    open fun handleUnknownInternal(request: RtspRequest): RtspResponse {
        Logger.w("Unknown/unhandled RTSP: ${request.method} ${request.uri} (${request.bodyBytes.size}B body)")
        return RtspResponse(statusCode = 501, statusMessage = "Not Implemented", protocol = request.responseProtocol())
    }

    /** Handles FLUSH — macOS requests we discard buffered media data (seek/pause). */
    private fun handleFlush(@Suppress("UNUSED_PARAMETER") request: RtspRequest): RtspResponse {
        return RtspResponse(statusCode = 200, statusMessage = "OK")
    }

    /** Handles PAUSE — suspends media delivery. Responds 200 OK; resume arrives as RECORD. */
    open fun handlePauseInternal(request: RtspRequest): RtspResponse {
        Logger.d("PAUSE received")
        return RtspResponse(statusCode = 200, statusMessage = "OK")
    }

    /** Handles AirPlay photo sharing: HTTP `PUT /photo` with a JPEG/PNG body. */
    open fun handlePhotoPutInternal(request: RtspRequest): RtspResponse {
        if (!request.isPhotoRequest()) {
            return handleUnknownInternal(request)
        }

        return when (val validation = PhotoHandler.validatePhoto(
            request.bodyBytes,
            request.headers["Content-Type"]
        )) {
            is PhotoValidation.Valid -> {
                onPhotoReceived(request.bodyBytes, validation.imageType)
                Logger.i("Photo received (${validation.imageType.mimeType}, ${request.bodyBytes.size} bytes)")
                RtspResponse(
                    statusCode = 200,
                    statusMessage = "OK",
                    protocol = request.responseProtocol()
                )
            }
            is PhotoValidation.Invalid -> {
                Logger.w("Photo rejected: ${validation.reason}")
                RtspResponse(
                    statusCode = 400,
                    statusMessage = "Bad Request",
                    protocol = request.responseProtocol()
                )
            }
        }
    }

    /** Handles AirPlay photo clearing: HTTP `DELETE /photo`. */
    open fun handlePhotoDeleteInternal(request: RtspRequest): RtspResponse {
        if (!request.isPhotoRequest()) {
            return handleUnknownInternal(request)
        }

        onPhotoCleared()
        Logger.i("Photo cleared")
        return RtspResponse(
            statusCode = 200,
            statusMessage = "OK",
            protocol = request.responseProtocol()
        )
    }

    private fun sendResponse(outputStream: OutputStream, response: RtspResponse, currentCSeq: Int?) {
        // Binary-safe: build the header block as ASCII, then write the raw body bytes.
        // Content-Length must be the BYTE length (not String.length) so binary plists,
        // FairPlay payloads, and encrypted bodies are framed correctly.
        val wire = response.wireBody()
        val head = StringBuilder()
        head.append("${response.protocol} ${response.statusCode} ${response.statusMessage}\r\n")
        if (response.protocol.startsWith("RTSP")) currentCSeq?.let { head.append("CSeq: $it\r\n") }
        head.append("Server: AirTunes/${InfoResponder.SOURCE_VERSION}\r\n")
        if (response.protocol.startsWith("RTSP") && currentCSeq != null && !response.headers.containsKey("Audio-Jack-Status")) {
            head.append("Audio-Jack-Status: connected; type=digital\r\n")
        }
        response.contentType?.let { head.append("Content-Type: $it\r\n") }
        response.headers.forEach { (key, value) ->
            head.append("$key: $value\r\n")
        }
        if (!response.headers.containsKey("Content-Length")) {
            head.append("Content-Length: ${wire.size}\r\n")
        }
        head.append("\r\n")
        outputStream.write(head.toString().toByteArray(Charsets.US_ASCII))
        if (wire.isNotEmpty()) {
            outputStream.write(wire)
        }
        outputStream.flush()
    }

    companion object {
        private const val PLIST_TYPE = "application/x-apple-binary-plist"
        private const val RTSP_PORT = 7000

        /** Audio-only grace guard: check RTP activity every second. */
        private const val AUDIO_ONLY_GRACE_TICK_MS = 1_000L

        /** End an audio-only session only after this long with no RTP packets at all. */
        private const val AUDIO_ONLY_GRACE_SILENCE_MS = 20_000L

        // SRP PIN access control. macOS's AirPlay code-entry field is exactly 4 digits, so the PIN
        // must be 4 digits to be enterable. A 4-digit space is low-entropy, so the load-bearing
        // defense is the MAX_PAIR_ATTEMPTS lockout below (uniform random + hard attempt cap, NOT
        // length). The PIN is still uniformly random — no biased truncation.
        private const val PIN_DIGITS = 4
        private const val PIN_SPACE = 10_000        // 10^PIN_DIGITS
        private const val MAX_PAIR_ATTEMPTS = 10
        private const val MAX_MESSAGE_BYTES = 65536
        private const val OCTET_STREAM = "application/octet-stream"
        private const val TIMING_PORT = 6002   // matches TimingHandler's UDP NTP port
        private const val SESSION_ID = "AirplaySession"
        private const val AUDIO_RTP_PORT = 6001
        private const val DEFAULT_SENDER_NAME = "AirPlay Sender"
    }
}

private fun RtspRequest.isPhotoRequest(): Boolean =
    uri.substringBefore("?") == PhotoHandler.PHOTO_PATH

private fun RtspRequest.responseProtocol(): String =
    if (protocol.startsWith("HTTP/")) protocol else "RTSP/1.0"

/** True if the body is an Apple binary plist (AirPlay 2 mirroring SETUP), vs legacy SDP. */
private fun RtspRequest.isPlistBody(): Boolean =
    bodyBytes.size >= 8 && String(bodyBytes, 0, 8, Charsets.US_ASCII) == "bplist00"
