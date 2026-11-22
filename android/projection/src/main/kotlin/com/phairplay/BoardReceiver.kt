package com.airplay

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.RemoteException
import android.view.Surface
import android.view.TextureView
import android.view.ViewGroup
import android.webkit.WebView
import kotlin.math.roundToInt

/** Only the display surface lives beside the WebView. Media never passes through the JS bridge. */
class BoardReceiver(private val web: WebView, val protocol: String,
                    private val authorization: Authorization?, private val onStatusChanged: Runnable) : TextureView.SurfaceTextureListener, ServiceConnection {
    fun interface Authorization {
        fun update(token: String, sender: String, pin: String, accepted: Boolean)
    }
    private val context = web.context.applicationContext
    private val parent = web.parent as ViewGroup
    private val main = Handler(Looper.getMainLooper())
    private val texture = TextureView(web.context)
    private var surface: Surface? = null
    private var service: IProjectionEngine? = null
    private var started = false
    private var closed = false
    private var bound = false
    var state = "starting"
        private set
    var displayName = ""
        private set
    private companion object { val revisions = java.util.concurrent.atomic.AtomicInteger() }
    var revision = revisions.incrementAndGet()
        private set
    var hasFrames = false
        private set
    var audioOnly = false
        private set
    var title = ""
        private set
    var width = 0
        private set
    var height = 0
        private set

    private val events = object : IProjectionEvents.Stub() {
        override fun authorization(token: String, sender: String, pin: String, accepted: Boolean) {
            main.post { if (!closed && service != null) authorization?.update(token, sender, pin, accepted) }
        }

        override fun changed(next: String, name: String, w: Int, h: Int, audio: Boolean, item: String, mirrorFrame: Boolean) {
            main.post {
                if (closed || service == null) return@post
                if (next != state && (state == "connected" || next == "connected")) {
                    revision = revisions.incrementAndGet()
                    if (next != "connected") {
                        hasFrames = false
                        park()
                    }
                }
                if (mirrorFrame && next == "connected" && surface?.isValid == true) hasFrames = true
                state = next
                displayName = name
                width = w
                height = h
                audioOnly = audio
                title = item
                onStatusChanged.run()
            }
        }
    }

    fun start() {
        texture.surfaceTextureListener = this
        texture.isFocusable = false
        texture.importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO
        web.setBackgroundColor(Color.TRANSPARENT)
        parent.addView(texture, parent.indexOfChild(web), ViewGroup.LayoutParams(2, 2))
        bind()
        check(bound) { "Cannot bind media receiver" }
    }

    private fun bind() {
        bound = context.bindService(Intent(context, ProjectionMediaService::class.java), this, Context.BIND_AUTO_CREATE)
    }

    private fun unbind() {
        if (bound) {
            bound = false
            context.unbindService(this)
        }
    }

    override fun onServiceConnected(name: ComponentName, binder: IBinder) {
        if (closed) return
        service = IProjectionEngine.Stub.asInterface(binder)
        startWhenReady()
    }
    override fun onServiceDisconnected(name: ComponentName) = lost()
    override fun onBindingDied(name: ComponentName) {
        if (closed) return
        lost()
        unbind()
        bind()
    }
    override fun onNullBinding(name: ComponentName) {
        lost()
        unbind()
    }

    private fun lost() {
        if (closed) return
        service = null
        started = false
        park()
        state = "error"
        hasFrames = false
        revision = revisions.incrementAndGet()
        authorization?.update("", "", "", false)
        onStatusChanged.run()
    }

    fun authorize(token: String, allow: Boolean) {
        try { service?.authorize(protocol, token, allow, events) } catch (_: RemoteException) { lost() }
    }

    override fun onSurfaceTextureAvailable(value: SurfaceTexture, w: Int, h: Int) {
        val target = Surface(value)
        surface = target
        if (started) {
            try { service?.attach(protocol, target, events) } catch (_: RemoteException) { lost() }
        } else startWhenReady()
    }

    private fun startWhenReady() {
        val engine = service ?: return
        val target = surface ?: return
        if (closed || started) return
        try { engine.start(protocol, target, events); started = true }
        catch (_: RemoteException) { lost() }
    }
    override fun onSurfaceTextureSizeChanged(value: SurfaceTexture, w: Int, h: Int) {
        if (started && protocol == "cast") {
            try { service?.redraw(protocol, events) } catch (_: RemoteException) { lost() }
        }
    }
    override fun onSurfaceTextureUpdated(value: SurfaceTexture) {
        if (!closed && !audioOnly && !hasFrames) {
            hasFrames = true
            onStatusChanged.run()
        }
    }
    override fun onSurfaceTextureDestroyed(value: SurfaceTexture): Boolean {
        if (started) {
            try { service?.attach(protocol, null, events) } catch (_: RemoteException) { lost() }
        }
        surface?.release()
        surface = null
        hasFrames = false
        if (!closed) onStatusChanged.run()
        return true
    }

    private fun park() {
        if (texture.parent != null && web.width > 0)
            position(0.5, 0.5, 1.0, 1.0, 0.0, web.width.toDouble())
    }

    /** Position the texture at the fitted video rectangle in WebView viewport coordinates. */
    fun position(cx: Double, cy: Double, w: Double, h: Double, angle: Double, viewport: Double) {
        if (closed || viewport <= 0 || !listOf(cx, cy, w, h, angle, viewport).all { it.isFinite() }) return
        val density = web.width / viewport
        val outW = w * density
        val outH = h * density
        val scale = maxOf(1.0, outW / maxOf(1, web.width), outH / maxOf(1, web.height))
        val actualW = (outW / scale).roundToInt().coerceAtLeast(1)
        val actualH = (outH / scale).roundToInt().coerceAtLeast(1)
        val params = texture.layoutParams
        if (params.width != actualW || params.height != actualH) {
            params.width = actualW
            params.height = actualH
            texture.layoutParams = params
        }
        texture.pivotX = actualW / 2f
        texture.pivotY = actualH / 2f
        texture.scaleX = (outW / actualW).toFloat()
        texture.scaleY = (outH / actualH).toFloat()
        texture.rotation = angle.toFloat()
        texture.x = web.x + (cx * density - actualW / 2.0).toFloat()
        texture.y = web.y + (cy * density - actualH / 2.0).toFloat()
    }

    fun disconnectSender() {
        try { service?.disconnect(protocol, events) } catch (_: RemoteException) { lost() }
    }

    fun stop() {
        if (closed) return
        closed = true
        authorization?.update("", "", "", false)
        try { service?.stop(protocol, events) } catch (_: RemoteException) { }
        service = null
        unbind()
        parent.removeView(texture)
        onStatusChanged.run()
    }
}
