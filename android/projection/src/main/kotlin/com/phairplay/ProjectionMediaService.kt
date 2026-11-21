package com.airplay

import android.app.Service
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import android.view.Surface
import com.airplay.airplay.AirPlayReceiver
import com.airplay.airplay.VideoDecoder
import com.airplay.cast.CastPlayback
import com.airplay.castplus.CastPlusEngine
import com.airplay.castplus.CastPlusSupport
import com.airplay.dlna.BoardMediaRenderer
import com.airplay.miracast.BoardWifiDisplay
import com.airplay.miracast.wfdCustomVideoMode
import com.airplay.service.ProtocolState

/** Codec, network parsers and vendor libraries run outside the process owning the board. */
class ProjectionMediaService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private val sessions = mutableMapOf<String, Session>()

    private inner class Session(val protocol: String, val events: IProjectionEvents, @Volatile var target: Surface?) {
        var air: AirPlayReceiver? = null
        var wfd: BoardWifiDisplay? = null
        var dlna: BoardMediaRenderer? = null
        var cast: CastPlayback? = null
        var castPlus: CastPlusEngine? = null
        var state = "starting"
        var name = "Fcboard · " + android.os.Build.MODEL
        var audio = false
        var title = ""
        var width = 0
        var height = 0
        var last: List<Any>? = null
        val death = IBinder.DeathRecipient { main.post { drop(this) } }

        fun change(next: String) {
            if (next != state && next != "connected" && next != "connecting") {
                width = 0
                height = 0
                audio = false
                title = ""
            }
            if (protocol == "airplay" && state in listOf("connecting", "connected") && next == "waiting") {
                sessions["dlna"]?.dlna?.announceAvailability()
            }
            state = next
            publish()
        }

        fun publish() {
            if (sessions[protocol] !== this) return
            val size = if (air != null || wfd != null) target?.let { VideoDecoder.sizeFor(it) } else null
            val w = size?.width ?: width
            val h = size?.height ?: height
            val mirrorFrame = air?.hasMirrorFrame(target) == true
            val next = listOf(state, name, w, h, audio, title, mirrorFrame)
            if (next != last) {
                last = next
                try { events.changed(state, name, w, h, audio, title, mirrorFrame) }
                catch (_: android.os.RemoteException) { main.post { drop(this) } }
            }
        }

        fun begin() {
            when (protocol) {
                "airplay" -> {
                    val mode = wfdCustomVideoMode(this@ProjectionMediaService, true)
                    air = AirPlayReceiver(this@ProjectionMediaService, displayName = name,
                        mirrorWidth = mode?.width ?: 1280, mirrorHeight = mode?.height ?: 720, mirrorFps = mode?.fps ?: 30,
                        audioEnabled = true, videoSurfaceProvider = { target },
                        onActualNameRegistered = { main.post { name = it; publish() } },
                        onNowPlayingChanged = { info -> main.post { audio = info != null; title = info?.title.orEmpty(); publish() } },
                        onStateChanged = { change(when (it) {
                            ProtocolState.ADVERTISING -> "waiting"
                            ProtocolState.CONNECTING -> "connecting"
                            ProtocolState.CONNECTED -> "connected"
                            ProtocolState.ERROR -> "error"
                            ProtocolState.DISABLED -> "off"
                        }) }).also { it.start() }
                }
                "miracast" -> wfd = BoardWifiDisplay(this@ProjectionMediaService, { target }, ::change,
                    { name = it; publish() }).also { it.start() }
                "dlna" -> dlna = BoardMediaRenderer(this@ProjectionMediaService, name, ::change,
                    { w, h, sound, item -> width = w; height = h; audio = sound; title = item; publish() }
                ).also { it.attach(target); it.start() }
                "cast" -> cast = CastPlayback(this@ProjectionMediaService, name, ::change,
                    { w, h, sound, item -> width = w; height = h; audio = sound; title = item; publish() }
                ).also { it.attach(target); it.start() }
                "castplus" -> {
                    if (!CastPlusSupport.isAvailable()) { change("unavailable"); return }
                    castPlus = CastPlusSupport.create(this@ProjectionMediaService, name, object : CastPlusEngine.Events {
                        override fun state(value: String) = change(value)
                        override fun size(width: Int, height: Int) {
                            this@Session.width = width
                            this@Session.height = height
                            publish()
                        }
                        override fun request(token: String, sender: String, pin: String, accepted: Boolean) {
                            if (sessions[protocol] === this@Session) runCatching { events.authorization(token, sender, pin, accepted) }
                        }
                    }).also { it.attach(target); it.start() }
                }
            }
        }
    }

    private fun drop(s: Session) {
        if (sessions[s.protocol] !== s) return
        if (s.protocol == "airplay" && s.state in listOf("connecting", "connected")) {
            sessions["dlna"]?.dlna?.announceAvailability()
        }
        sessions.remove(s.protocol)
        runCatching { s.events.asBinder().unlinkToDeath(s.death, 0) }
        runCatching { s.air?.stop() }
        runCatching { s.wfd?.stop() }
        runCatching { s.dlna?.stop() }
        runCatching { s.cast?.stop() }
        runCatching { s.castPlus?.stop() }
        s.target?.release()
        s.target = null
    }

    private val binder = object : IProjectionEngine.Stub() {
        override fun start(protocol: String, target: Surface?, events: IProjectionEvents) {
            main.post {
                sessions[protocol]?.let(::drop)
                val s = Session(protocol, events, target)
                sessions[protocol] = s
                try {
                    events.asBinder().linkToDeath(s.death, 0)
                    s.begin()
                    s.publish()
                } catch (error: Exception) {
                    Log.e("FcboardProjection", "$protocol receiver initialization failed", error)
                    s.change("error")
                    drop(s)
                } catch (error: LinkageError) {
                    Log.e("FcboardProjection", "$protocol native library initialization failed", error)
                    s.change("error")
                    drop(s)
                }
            }
        }

        override fun attach(protocol: String, target: Surface?, events: IProjectionEvents) {
            main.post {
                val s = sessions[protocol]
                if (s == null || s.events.asBinder() != events.asBinder()) { target?.release(); return@post }
                val previous = s.target
                s.target = target
                try { s.dlna?.attach(target); s.cast?.attach(target); s.castPlus?.attach(target); s.air?.refreshVideoSurface() }
                finally { previous?.release() }
            }
        }

        override fun stop(protocol: String, events: IProjectionEvents) {
            main.post { sessions[protocol]?.takeIf { it.events.asBinder() == events.asBinder() }?.let(::drop) }
        }

        override fun redraw(protocol: String, events: IProjectionEvents) {
            main.post { sessions[protocol]?.takeIf { it.events.asBinder() == events.asBinder() }?.cast?.redraw() }
        }

        override fun authorize(protocol: String, token: String, allow: Boolean, events: IProjectionEvents) {
            main.post {
                sessions[protocol]?.takeIf { it.events.asBinder() == events.asBinder() }?.castPlus?.answer(token, allow)
            }
        }
    }

    private val sizes = object : Runnable {
        override fun run() {
            sessions.values.forEach { if (it.state == "connected") it.publish() }
            main.postDelayed(this, 350)
        }
    }
    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.DEBUG && timber.log.Timber.treeCount == 0) timber.log.Timber.plant(timber.log.Timber.DebugTree())
        main.post(sizes)
    }
    override fun onBind(intent: Intent): IBinder = binder
    override fun onDestroy() {
        main.removeCallbacks(sizes)
        sessions.values.toList().forEach(::drop)
        super.onDestroy()
    }
}
