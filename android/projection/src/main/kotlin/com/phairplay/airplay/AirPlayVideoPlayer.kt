package com.airplay.airplay

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.Surface
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.ByteArrayDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import com.airplay.util.Logger
import com.airplay.util.ProjectionMediaHttp
import java.io.IOException

data class PlaybackInfo(val durationSec: Double, val positionSec: Double, val rate: Double, val readyToPlay: Boolean)

@UnstableApi
private class AirPlayDataSource(private val http: DataSource, private val fetch: ((String) -> ByteArray)?) : DataSource {
    private var source: DataSource = http
    private val listeners = mutableListOf<TransferListener>()
    override fun addTransferListener(listener: TransferListener) {
        listeners.add(listener)
        http.addTransferListener(listener)
    }
    override fun open(dataSpec: DataSpec): Long {
        source = when (dataSpec.uri.scheme?.lowercase()) {
            "http", "https" -> http
            "mlhls" -> {
                val bytes = fetch?.invoke(dataSpec.uri.toString()) ?: throw IOException("No AirPlay resource channel")
                ByteArrayDataSource(bytes).also { memory -> listeners.forEach(memory::addTransferListener) }
            }
            else -> throw IOException("Unsupported AirPlay media address")
        }
        return source.open(dataSpec)
    }
    override fun read(buffer: ByteArray, offset: Int, length: Int) = source.read(buffer, offset, length)
    override fun getUri() = source.uri
    override fun getResponseHeaders() = source.responseHeaders
    override fun close() = source.close()
}

/** Media3 resolves relative playlists against their original mlhls URI. HTTPS segments use the same transport as Cast. */
@UnstableApi
internal class AirPlayVideoPlayer(
    private val context: Context,
    private val surfaceProvider: () -> Surface?,
    private val onFirstFrame: (AirPlayVideoPlayer) -> Unit,
    private val onEnded: (AirPlayVideoPlayer, Boolean) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val http = ProjectionMediaHttp.create()
    private var player: ExoPlayer? = null
    private var output: Surface? = null
    @Volatile var renderedSurface: Surface? = null
        private set
    @Volatile private var released = false
    @Volatile private var snapshot = PlaybackInfo(0.0, 0.0, 0.0, false)
    private val clock = object : Runnable {
        override fun run() {
            val p = player ?: return
            if (released) return
            snapshot = PlaybackInfo(p.duration.coerceAtLeast(0) / 1000.0, p.currentPosition / 1000.0,
                if (p.isPlaying) 1.0 else 0.0, p.playbackState == Player.STATE_READY)
            main.postDelayed(this, 350)
        }
    }

    fun play(url: String, fraction: Double, seconds: Double?, fetch: ((String) -> ByteArray)?) {
        main.post {
            if (released) return@post
            try {
                val transport = OkHttpDataSource.Factory(http)
                val sources = DefaultMediaSourceFactory(context).setDataSourceFactory(DataSource.Factory {
                    AirPlayDataSource(transport.createDataSource(), fetch)
                })
                val p = ExoPlayer.Builder(context, DefaultRenderersFactory(context).setEnableDecoderFallback(true))
                    .setMediaSourceFactory(sources).build()
                player = p
                attach(p)
                var fractionPending = seconds == null && fraction > 0.0
                p.addListener(object : Player.Listener {
                    override fun onPlaybackStateChanged(state: Int) {
                        if (released) return
                        if (state == Player.STATE_READY && fractionPending && p.duration > 0) {
                            fractionPending = false
                            p.seekTo((fraction * p.duration).toLong())
                        }
                        if (state == Player.STATE_ENDED) onEnded(this@AirPlayVideoPlayer, false)
                    }
                    override fun onPlayerError(error: PlaybackException) {
                        if (!released) onEnded(this@AirPlayVideoPlayer, true)
                    }
                    override fun onVideoSizeChanged(videoSize: VideoSize) {
                        if (!released) output?.let { surface ->
                            if (videoSize.width > 0 && videoSize.height > 0)
                                VideoDecoder.setSize(surface, (videoSize.width * videoSize.pixelWidthHeightRatio).toInt(), videoSize.height)
                        }
                    }
                    override fun onRenderedFirstFrame() {
                        if (!released && output?.isValid == true) {
                            renderedSurface = output
                            onFirstFrame(this@AirPlayVideoPlayer)
                        }
                    }
                })
                val item = MediaItem.Builder().setUri(url)
                if (url.startsWith("mlhls:")) item.setMimeType(MimeTypes.APPLICATION_M3U8)
                p.setMediaItem(item.build(), seconds?.let { (it * 1000).toLong() } ?: C.TIME_UNSET)
                p.playWhenReady = true
                p.prepare()
                clock.run()
            } catch (error: Exception) {
                Logger.e("AirPlay media setup failed", error)
                if (!released) onEnded(this, true)
            }
        }
    }
    private fun attach(p: ExoPlayer) {
        val next = surfaceProvider()?.takeIf { it.isValid }
        if (next !== output) {
            renderedSurface = null
            output = next
            p.setVideoSurface(next)
        }
    }
    fun attachSurface() { main.post { if (!released) player?.let(::attach) } }
    fun setRate(rate: Float) { main.post { if (!released) player?.playWhenReady = rate > 0 } }
    fun scrub(seconds: Double) { main.post { if (!released && seconds.isFinite()) player?.seekTo((seconds.coerceAtLeast(0.0) * 1000).toLong()) } }
    fun info(): PlaybackInfo? = if (released) null else snapshot
    fun release() {
        released = true
        renderedSurface = null
        main.post {
            main.removeCallbacks(clock)
            player?.release()
            player = null
            output = null
            http.dispatcher.cancelAll()
            http.connectionPool.evictAll()
        }
    }
}
