package com.airplay.cast

import android.content.Context
import android.graphics.Bitmap
import android.opengl.EGL14
import android.opengl.GLES20
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.image.ImageOutput
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import com.airplay.util.ProjectionMediaHttp

@UnstableApi
internal class CastPlayback(context: Context, name: String, private val state: (String) -> Unit,
                             private val media: (Int, Int, Boolean, String) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private val session = CastSession(
        { request -> main.post { if (!closed) load(request) } },
        { id, action, value -> main.post { if (!closed) command(id, action, value) } }
    )
    private val server = GoogleCastReceiver(context, name, session) { ready ->
        main.post { if (!closed && player == null) state(if (ready) "waiting" else "off") }
    }
    private val http = ProjectionMediaHttp.create()
    private val sources = DefaultMediaSourceFactory(context).setDataSourceFactory(OkHttpDataSource.Factory(http))
    private val renderers = DefaultRenderersFactory(context).setEnableDecoderFallback(true)
    private val app = context.applicationContext
    private var player: ExoPlayer? = null
    private var activeId = 0
    private var output: Surface? = null
    private var image: Bitmap? = null
    private var renderedFrame = false
    private var displayed = false
    private var closed = false

    private val redrawImage = Runnable { player?.let { p -> image?.let { present(p, it) } } }

    fun redraw() {
        main.removeCallbacks(redrawImage)
        main.postDelayed(redrawImage, 32)
    }

    private val clock = object : Runnable {
        override fun run() {
            player?.let { publish(it) }
            if (player != null) main.postDelayed(this, 500)
        }
    }

    fun start() = server.start()

    fun attach(surface: Surface?) {
        if (surface !== output) renderedFrame = false
        output = surface
        player?.let { p ->
            val still = image
            if (still != null) present(p, still)
            else if (!p.currentTracks.containsType(C.TRACK_TYPE_IMAGE)) p.setVideoSurface(surface)
        }
    }

    private fun load(request: CastLoad) {
        releasePlayer()
        activeId = request.id
        if (!displayed) state("connecting")
        try {
            val p = ExoPlayer.Builder(app, renderers).setMediaSourceFactory(sources).build()
            player = p
            p.volume = request.volume
            if (!imageItem(request.items[request.index])) p.setVideoSurface(output)
            p.setImageOutput(object : ImageOutput {
                override fun onImageAvailable(presentationTimeUs: Long, bitmap: Bitmap) {
                    main.post { if (player === p && p.currentTracks.containsType(C.TRACK_TYPE_IMAGE)) present(p, bitmap) }
                }
                override fun onDisabled() = Unit
            })
            p.addListener(object : Player.Listener {
                override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                    if (player !== p) return
                    image = null
                    renderedFrame = false
                }

                override fun onRenderedFirstFrame() {
                    if (player === p) {
                        image = null
                        renderedFrame = output?.isValid == true
                        if (renderedFrame) showVideo(p)
                    }
                }

                override fun onVideoSizeChanged(videoSize: VideoSize) {
                    if (player === p && renderedFrame && videoSize.width > 0 && image == null) showVideo(p)
                }

                override fun onTracksChanged(tracks: Tracks) {
                    if (player !== p) return
                    if (tracks.containsType(C.TRACK_TYPE_IMAGE)) p.clearVideoSurface()
                    if (tracks.containsType(C.TRACK_TYPE_VIDEO)) p.setVideoSurface(output)
                    if (tracks.isTypeSelected(C.TRACK_TYPE_AUDIO) && !tracks.containsType(C.TRACK_TYPE_VIDEO) &&
                        !tracks.containsType(C.TRACK_TYPE_IMAGE)) {
                        image = null
                        displayed = false
                        media(0, 0, true, title(p))
                        state("connected")
                    }
                }

                override fun onPlayerError(error: PlaybackException) {
                    if (player === p) failed(p, error)
                }

                override fun onEvents(player: Player, events: Player.Events) {
                    if (this@CastPlayback.player === p) publish(p)
                }
            })
            p.setMediaItems(request.items.map(::item), request.index, request.position)
            p.playWhenReady = request.autoplay
            p.prepare()
            clock.run()
        } catch (error: Exception) {
            player?.let { failed(it, error) } ?: run {
                session.update(activeId, CastSnapshot("IDLE", reason = "ERROR"))
                displayed = false
                media(0, 0, false, "")
                state("waiting")
            }
        }
    }

    private fun item(media: CastItem): MediaItem {
        val location = path(media)
        val kind = ProjectionMediaHttp.manifestMimeType(media.url, media.mime) ?: when {
            media.mime.startsWith("image/") -> media.mime
            location.endsWith(".png") -> MimeTypes.IMAGE_PNG
            location.endsWith(".jpg") || location.endsWith(".jpeg") -> MimeTypes.IMAGE_JPEG
            location.endsWith(".webp") -> MimeTypes.IMAGE_WEBP
            else -> null
        }
        return MediaItem.Builder().setUri(media.url).setMimeType(kind)
            .setMediaMetadata(MediaMetadata.Builder().setTitle(media.title).build()).apply {
                if (kind?.startsWith("image/") == true) setImageDurationMs(6000)
            }.build()
    }

    private fun path(media: CastItem) = media.url.substringBefore('?').substringBefore('#').lowercase()

    private fun imageItem(media: CastItem): Boolean = media.mime.startsWith("image/") ||
        path(media).substringAfterLast('.', "") in setOf("png", "jpg", "jpeg", "webp")

    private fun title(p: ExoPlayer) = p.mediaMetadata.title?.toString().orEmpty()

    private fun showVideo(p: ExoPlayer) {
        val size = p.videoSize
        if (size.width <= 0 || size.height <= 0) return
        displayed = true
        media((size.width * size.pixelWidthHeightRatio).toInt(), size.height, false, title(p))
        state("connected")
    }

    private fun present(p: ExoPlayer, bitmap: Bitmap) {
        image = bitmap
        val surface = output?.takeIf { it.isValid } ?: return
        try {
            p.clearVideoSurface()
            CastImage.draw(surface, bitmap)
            displayed = true
            media(bitmap.width, bitmap.height, false, title(p))
            state("connected")
        } catch (error: Exception) { failed(p, error) }
    }

    private fun publish(p: ExoPlayer) {
        val value = when (p.playbackState) {
            Player.STATE_IDLE, Player.STATE_ENDED -> "IDLE"
            Player.STATE_BUFFERING -> "BUFFERING"
            else -> if (p.playWhenReady) "PLAYING" else "PAUSED"
        }
        val index = p.currentMediaItemIndex
        session.update(activeId, CastSnapshot(value, p.currentPosition.coerceAtLeast(0), p.duration.coerceAtLeast(0),
            index, if (p.playbackState == Player.STATE_ENDED) "FINISHED" else null))
    }

    private fun command(id: Int, command: String, value: Double) {
        if (id != activeId) return
        val p = player ?: return
        when (command) {
            "PLAY" -> { if (p.playbackState == Player.STATE_ENDED) p.seekToDefaultPosition(); p.play() }
            "PAUSE" -> p.pause()
            "SEEK" -> p.seekTo(value.toLong())
            "JUMP" -> p.seekToDefaultPosition(value.toInt())
            "VOLUME" -> p.volume = value.toFloat()
            "STOP" -> {
                releasePlayer()
                displayed = false
                media(0, 0, false, "")
                state("waiting")
            }
        }
    }

    private fun failed(p: ExoPlayer, error: Exception) {
        Log.w("FcboardProjection", "Cast media playback failed: ${error.javaClass.simpleName}")
        session.update(activeId, CastSnapshot("IDLE", index = p.currentMediaItemIndex, reason = "ERROR"))
        releasePlayer()
        displayed = false
        media(0, 0, false, "")
        state("waiting")
    }

    private fun releasePlayer() {
        renderedFrame = false
        val previous = player
        player = null
        main.removeCallbacks(clock)
        main.removeCallbacks(redrawImage)
        previous?.release()
        image = null
    }

    fun stop() {
        closed = true
        server.stop()
        releasePlayer()
        output = null
        http.dispatcher.cancelAll()
        http.connectionPool.evictAll()
    }
}

@UnstableApi
private object CastImage {
    private val vertices = floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)
    private val imageCoords = floatArrayOf(0f, 1f, 1f, 1f, 0f, 0f, 1f, 0f)

    fun draw(target: Surface, bitmap: Bitmap) {
        val display = GlUtil.getDefaultEglDisplay()
        var context = EGL14.EGL_NO_CONTEXT
        var surface = EGL14.EGL_NO_SURFACE
        try {
            context = GlUtil.createEglContext(display)
            surface = GlUtil.createEglSurface(display, target, C.COLOR_TRANSFER_SDR, false)
            val size = IntArray(2)
            check(EGL14.eglQuerySurface(display, surface, EGL14.EGL_WIDTH, size, 0))
            check(EGL14.eglQuerySurface(display, surface, EGL14.EGL_HEIGHT, size, 1))
            GlUtil.focusEglSurface(display, context, surface, size[0], size[1])
            val program = GlProgram(
                "attribute vec2 point; attribute vec2 coord; varying vec2 uv; void main() { uv = coord; gl_Position = vec4(point, 0., 1.); }",
                "precision mediump float; varying vec2 uv; uniform sampler2D image; void main() { gl_FragColor = texture2D(image, uv); }"
            )
            program.use()
            val texture = GlUtil.createTexture(bitmap)
            program.setBufferAttribute("point", vertices, 2)
            program.setBufferAttribute("coord", imageCoords, 2)
            program.setSamplerTexIdUniform("image", texture, 0)
            program.bindAttributesAndUniforms()
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            GlUtil.checkGlError()
            check(EGL14.eglSwapBuffers(display, surface))
        } finally {
            runCatching { GlUtil.destroyEglContext(display, context) }
            runCatching { GlUtil.destroyEglSurface(display, surface) }
        }
    }
}
