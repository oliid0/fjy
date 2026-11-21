package com.airplay.dlna

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import android.view.Surface
import androidx.media3.common.C
import androidx.media3.common.MimeTypes
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Tracks
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import com.airplay.dlna.renderer.DlnaPlayerBridge
import com.airplay.dlna.renderer.DlnaPlayerControl
import com.airplay.dlna.transport.DlnaEndpoint
import com.airplay.dlna.transport.ManualDlnaHttp
import com.airplay.util.MediaUriPolicy
import com.airplay.util.NetworkUtils
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@UnstableApi
class BoardMediaRenderer(private val context: Context, private val name: String,
                        private val state: (String) -> Unit, private val media: (Int, Int, Boolean, String) -> Unit)
    : DlnaPlayerControl {
    private val main = Handler(Looper.getMainLooper())
    private val network = Executors.newSingleThreadScheduledExecutor()
    private val multicast = context.getSystemService(WifiManager::class.java)?.createMulticastLock("Fcboard-DLNA")
    private var endpoint: DlnaEndpoint? = null
    private var address: String? = null
    @Volatile private var closed = false
    @Volatile private var paused = false
    @Volatile private var uri: String? = null
    @Volatile private var position = 0L
    @Volatile private var duration = 0L
    private var surface: Surface? = null
    private var player: ExoPlayer? = null
    private var volume = 1f
    private fun refresh() {
        if (closed) return
        try {
            val ip = NetworkUtils.lanLinks(context).firstOrNull()?.address?.hostAddress
            if (address == ip && endpoint != null) return
            if (endpoint != null) {
                endpoint?.close()
                endpoint = null
                address = null
                ManualDlnaHttp.reset()
                dispatch { if (uri != null) stopItem() }
            }
            if (ip != null) {
                endpoint = DlnaEndpoint(ip)
                address = ip
            }
            dispatch { if (uri == null) state(if (ip == null) "error" else "waiting") }
        } catch (error: Exception) {
            android.util.Log.w("FcboardProjection", "DLNA could not bind LAN discovery", error)
            dispatch { state("error") }
        }
    }

    fun start() {
        ManualDlnaHttp.setIdentity(NetworkUtils.getPersistentUuid(context), name)
        ManualDlnaHttp.reset()
        DlnaPlayerBridge.setControl(this)
        multicast?.acquire()
        network.scheduleWithFixedDelay(::refresh, 0, 5, TimeUnit.SECONDS)
    }

    fun announceAvailability() {
        if (!closed) network.execute { endpoint?.announceAvailability() }
    }

    fun attach(target: Surface?) {
        surface = target
        player?.setVideoSurface(target)
    }

    private fun dispatch(block: () -> Unit) {
        main.post { if (!closed) block() }
    }

    private val clock = object : Runnable {
        override fun run() {
            val p = player ?: return
            position = p.currentPosition.coerceAtLeast(0) / 1000
            duration = p.duration.coerceAtLeast(0) / 1000
            main.postDelayed(this, 500)
        }
    }

    private fun report(p: ExoPlayer) {
        val size = p.videoSize
        val audio = p.currentTracks.isTypeSelected(C.TRACK_TYPE_AUDIO) && !p.currentTracks.containsType(C.TRACK_TYPE_VIDEO)
        media((size.width * size.pixelWidthHeightRatio).toInt(), size.height, audio,
            p.mediaMetadata.title?.toString() ?: ManualDlnaHttp.getDisplayTitle())
    }

    private fun playItem(url: String) {
        val current = player
        if (url == uri && current != null) {
            paused = false
            current.play()
            if (current.playbackState == Player.STATE_READY) ManualDlnaHttp.markPlaying()
            return
        }
        if (MediaUriPolicy.check(url) != null) return
        stopItem()
        uri = url
        state("connecting")
        try {
            val factory = DefaultRenderersFactory(context).setEnableDecoderFallback(true)
            val http = DefaultHttpDataSource.Factory().setConnectTimeoutMs(8000).setReadTimeoutMs(12000)
            val p = ExoPlayer.Builder(context, factory)
                .setMediaSourceFactory(DefaultMediaSourceFactory(context).setDataSourceFactory(http)).build()
            player = p
            p.volume = volume
            p.setVideoSurface(surface)
            p.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(value: Int) {
                    if (player !== p) return
                    when (value) {
                        Player.STATE_READY -> {
                            report(p)
                            state("connected")
                            if (p.playWhenReady) ManualDlnaHttp.markPlaying()
                        }
                        Player.STATE_ENDED -> { stopItem(); ManualDlnaHttp.notifyPlaybackEnded(); state("waiting") }
                    }
                }
                override fun onTracksChanged(tracks: Tracks) { if (player === p) report(p) }
                override fun onMediaMetadataChanged(metadata: MediaMetadata) { if (player === p) report(p) }
                override fun onVideoSizeChanged(size: VideoSize) { if (player === p) report(p) }
                override fun onPlayerError(error: PlaybackException) {
                    if (player === p) playbackFailed()
                }
            })
            val locator = url.lowercase()
            val path = locator.substringBefore('?')
            val query = locator.substringAfter('?', "")
            val item = MediaItem.Builder().setUri(url)
            when {
                path.endsWith(".m3u8") || ".m3u8" in query || "do=m3u8" in query -> item.setMimeType(MimeTypes.APPLICATION_M3U8)
                path.endsWith(".mpd") || ".mpd" in query -> item.setMimeType(MimeTypes.APPLICATION_MPD)
            }
            p.setMediaItem(item.build())
            p.prepare()
            p.play()
            clock.run()
        } catch (_: RuntimeException) { playbackFailed() }
    }

    private fun playbackFailed() {
        stopItem()
        ManualDlnaHttp.notifyPlaybackError()
        state("error")
    }

    private fun stopItem() {
        val old = player
        player = null
        main.removeCallbacks(clock)
        old?.release()
        uri = null
        paused = false
        position = 0
        duration = 0
        media(0, 0, false, "")
    }

    override fun startPlayback(uri: String) = dispatch { playItem(uri) }
    override fun startPlaybackAuto(uri: String) = dispatch { if (!isUserPaused(uri)) playItem(uri) }
    override fun isUserPaused(uri: String) = paused && this.uri == uri
    override fun pausePlayback() = dispatch { paused = true; player?.pause() }
    override fun resumePlayback() = dispatch { paused = false; player?.play() }
    override fun stopPlayback() = dispatch { stopItem(); state("waiting") }
    override fun seekTo(positionSeconds: Long) = dispatch { player?.seekTo(positionSeconds.coerceIn(0, Long.MAX_VALUE / 1000) * 1000) }
    override fun getDurationSeconds() = duration
    override fun getPositionSeconds() = position
    override fun setVolumePercent(percent: Int) = dispatch { volume = percent.coerceIn(0, 100) / 100f; player?.volume = volume }

    fun stop() {
        closed = true
        if (multicast?.isHeld == true) multicast.release()
        DlnaPlayerBridge.setControl(null)
        ManualDlnaHttp.reset()
        stopItem()
        network.execute { endpoint?.close(); endpoint = null }
        network.shutdown()
    }
}
