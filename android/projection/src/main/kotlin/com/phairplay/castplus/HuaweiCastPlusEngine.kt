package com.airplay.castplus

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import com.airplay.miracast.wfdCustomVideoMode
import com.huawei.castpluskit.AuthInfo
import com.huawei.castpluskit.ConnectRequestChoice
import com.huawei.castpluskit.Constant
import com.huawei.castpluskit.DeviceInfo
import com.huawei.castpluskit.DisplayInfo
import com.huawei.castpluskit.Event
import com.huawei.castpluskit.HiSightCapability
import com.huawei.castpluskit.IEventListener
import com.huawei.castpluskit.PlayerClient
import com.huawei.castpluskit.ProjectionDevice
import com.huawei.castpluskit.TrackControl
import java.util.UUID
import java.util.concurrent.Executors

internal class HuaweiCastPlusEngine(private val context: Context, name: String,
                          private val events: CastPlusEngine.Events) : CastPlusEngine {
    private data class Request(val token: String, val peer: ProjectionDevice, val pin: String, val approved: Boolean)
    private val main = Handler(Looper.getMainLooper())
    private val loader = Executors.newSingleThreadExecutor()
    private val receiver = DeviceInfo(name, DeviceInfo.TYPE_TV)
    private var client: PlayerClient? = null
    private var callback: IEventListener? = null
    private var request: Request? = null
    private var peer: ProjectionDevice? = null
    private var target: Surface? = null
    private var offered: Surface? = null
    private var paused = false
    private var playing = false
    private var registered = false
    private var stopped = false
    private var disconnecting = false

    override fun start() {
        events.state("starting")
        main.postDelayed({ if (!stopped && !registered) fail("Cast+ registration timed out") }, 20_000L)
        loader.execute {
            try {
                listOf("securec", "HwKeystoreSDK", "HwDeviceAuthSDK", "ConnectAuthNative",
                    "nstackx_util", "nstackx_dmsg", "nstackx_ctrl", "nf_onehop", "near_field_onehop_jni",
                    "jniFtSocketSink", "native_codec_jni").forEach(System::loadLibrary)
                main.post { if (!stopped) bind() }
            } catch (error: Exception) {
                main.post { if (!stopped) fail("Cast+ initialization failed", error) }
            } catch (error: LinkageError) {
                main.post { if (!stopped) fail("Cast+ native dependency failed", error) }
            }
        }
        loader.shutdown()
    }

    private fun bind() = sdk {
        val listener = object : IEventListener.Stub() {
            override fun onEvent(event: Event?): Boolean = event?.let { enqueue(it.eventId, null) } ?: false
            override fun onDisplayEvent(id: Int, info: DisplayInfo?): Boolean = enqueue(id, info)
        }
        callback = listener
        val engine = PlayerClient.getInstance()
        client = engine
        check(engine.registerCallback(listener) && engine.init(context))
    }

    private fun enqueue(id: Int, info: DisplayInfo?): Boolean {
        main.post { if (!stopped) sdk { receive(id, info) } }
        return true
    }

    private fun receive(id: Int, info: DisplayInfo?) {
        val engine = client ?: return
        val remote = info?.projectionDevice
        when (id) {
            Constant.EVENT_ID_SERVICE_BIND_SUCCESS -> {
                val mode = wfdCustomVideoMode(context, true)
                val width = mode?.width ?: 1280
                val height = mode?.height ?: 720
                val capability = HiSightCapability(width, height, width, height).apply {
                    videoFps = 30
                    videoBitrate = if (width.toLong() * height > 1_000_000) 8_000_000 else 4_000_000
                    setIsSupportRemoteCtrl(false)
                }
                check(engine.setCapability(capability) && engine.setDiscoverable(true, receiver) &&
                    engine.setAuthMode(AuthInfo(AuthInfo.AUTH_MODE_GENERIC)))
                registered = true
                events.state("waiting")
            }
            Constant.EVENT_ID_SERVICE_BIND_FAILED, Constant.EVENT_ID_BINDER_DIED -> fail("Cast+ service unavailable")
            Constant.EVENT_ID_CONFIRMATION_SHOW, Constant.EVENT_ID_PIN_CODE_SHOW -> {
                if (remote == null) return
                val old = request
                if (peer != null || disconnecting || (old != null && old.peer.deviceId != remote.deviceId)) {
                    engine.setConnectRequestChooseResult(ConnectRequestChoice(Constant.CONNECT_REQ_CHOICE_REJECT, remote))
                    return
                }
                val next = Request(old?.token ?: UUID.randomUUID().toString(), remote,
                    info?.pinCode.orEmpty().take(16).ifBlank { old?.pin.orEmpty() }, old?.approved ?: false)
                request = next
                events.state("connecting")
                publishRequest(next)
                if (old == null) main.postDelayed({ expireRequest(next.token) }, 60_000L)
            }
            Constant.EVENT_ID_PIN_CODE_SHOW_FINISH -> request?.let { pending ->
                request = pending.copy(pin = "")
                publishRequest(request)
            }
            Constant.EVENT_ID_CONNECT_REQ -> {
                if (remote == null || (peer != null && peer?.deviceId == remote.deviceId)) return
                val pending = request
                if (disconnecting || peer != null || (pending != null && pending.peer.deviceId != remote.deviceId)) {
                    engine.disconnectDevice(remote)
                    return
                }
                peer = remote
                events.state("connecting")
                updateSize(info)
                if (pending?.approved == true) {
                    acceptConnection(remote)
                } else if (pending == null) {
                    // The SDK can resume a paired sender directly at CONNECT_REQ.
                    // Keep the board's one-time consent before handing over its Surface.
                    val next = Request(UUID.randomUUID().toString(), remote, "", false)
                    request = next
                    publishRequest(next)
                    main.postDelayed({ expireRequest(next.token) }, 60_000L)
                }
            }
            Constant.EVENT_ID_PAUSED -> {
                if (peer == null || disconnecting) return
                paused = true
                playing = false
                offered = null
                playWhenReady()
            }
            Constant.EVENT_ID_CASTING -> if (!disconnecting && peer != null && offered != null) {
                playing = true
                events.state("connected")
            }
            Constant.EVENT_ID_RESOLUTION_UPDATE -> if (peer != null) updateSize(info)
            Constant.EVENT_ID_DEVICE_DISCONNECTED -> {
                if (remote != null && remote.deviceId != (peer ?: request?.peer)?.deviceId && !disconnecting) return
                disconnecting = false
                peer = null
                request = null
                paused = false
                playing = false
                offered = null
                publishRequest(null)
                if (registered) events.state("waiting")
            }
        }
    }

    private fun updateSize(info: DisplayInfo?) {
        val width = info?.videoWidth ?: 0
        val height = info?.videoHeight ?: 0
        if (width in 1..8192 && height in 1..8192) events.size(width, height)
    }

    private fun acceptConnection(remote: ProjectionDevice) {
        request = null
        publishRequest(null)
        playWhenReady()
        main.postDelayed({
            if (!stopped && peer === remote && !playing && !disconnecting) sdk { disconnect(remote) }
        }, 20_000L)
    }

    private fun expireRequest(token: String) {
        answer(token, false)
    }

    private fun publishRequest(value: Request?) = events.request(value?.token.orEmpty(),
        value?.peer?.deviceName.orEmpty().take(80), value?.pin.orEmpty(), value?.approved == true)

    override fun answer(token: String, allow: Boolean) = sdk {
        val pending = request?.takeIf { it.token == token } ?: return@sdk
        val connected = peer
        if (connected != null && connected.deviceId == pending.peer.deviceId) {
            if (allow) acceptConnection(connected) else disconnect(connected)
            return@sdk
        }
        if (pending.approved) {
            if (!allow) disconnect(pending.peer)
            return@sdk
        }
        val choice = if (allow) Constant.CONNECT_REQ_CHOICE_ONCE else Constant.CONNECT_REQ_CHOICE_REJECT
        check(client?.setConnectRequestChooseResult(ConnectRequestChoice(choice, pending.peer)) == true)
        if (allow) {
            request = pending.copy(approved = true)
            publishRequest(request)
        } else disconnect(pending.peer)
    }

    private fun disconnect(remote: ProjectionDevice) {
        disconnecting = true
        val token = request?.token
        request = null
        publishRequest(null)
        client?.disconnectDevice(remote)
        main.postDelayed({
            if (!stopped && disconnecting && (peer === remote || peer == null && request?.token == null && token != null)) {
                fail("Cast+ disconnect timed out")
            }
        }, 5000L)
    }

    override fun attach(surface: Surface?) = sdk {
        val previous = target
        target = surface?.takeIf { it.isValid }
        val remote = peer
        if (previous !== target && offered != null && remote != null && !disconnecting) {
            offered = null
            playing = false
            check(client?.pause(remote) == true)
        } else playWhenReady()
    }

    private fun playWhenReady() {
        val surface = target?.takeIf { it.isValid } ?: return
        val remote = peer ?: return
        val engine = client ?: return
        if (!paused || offered != null || disconnecting || request != null) return
        check(engine.setHiSightSurface(surface) && engine.play(TrackControl(remote.deviceId, TrackControl.TRACK_ALL)))
        offered = surface
        paused = false
        playing = true
        events.state("connected")
    }

    override fun stop() {
        if (stopped) return
        stopped = true
        main.removeCallbacksAndMessages(null)
        val engine = client
        val remote = peer ?: request?.peer
        runCatching { engine?.setDiscoverable(false, receiver) }
        runCatching { remote?.let { engine?.disconnectDevice(it) } }
        runCatching { callback?.let { engine?.unregisterCallback(it) } }
        runCatching { engine?.deinit() }
        client = null
        callback = null
        peer = null
        request = null
        target = null
        offered = null
        publishRequest(null)
    }

    private fun sdk(action: () -> Unit) {
        if (stopped) return
        try {
            action()
        } catch (error: Exception) {
            fail("Cast+ SDK call failed", error)
        } catch (error: LinkageError) {
            fail("Cast+ native dependency failed", error)
        }
    }

    private fun fail(message: String, error: Throwable? = null) {
        Log.w("FcboardProjection", message, error)
        stop()
        events.state("error")
    }
}
