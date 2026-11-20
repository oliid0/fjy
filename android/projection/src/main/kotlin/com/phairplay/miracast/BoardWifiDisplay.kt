package com.airplay.miracast

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.wifi.p2p.*
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.Executors

/** Only connect to the source in the Wi-Fi Direct group that Android has negotiated. */
@SuppressLint("MissingPermission", "NewApi")
class BoardWifiDisplay(private val context: Context, private val surface: () -> Surface?,
                       private val state: (String) -> Unit, private val name: (String) -> Unit) {
    private val manager = requireNotNull(context.getSystemService(WifiP2pManager::class.java))
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private var channel: WifiP2pManager.Channel? = null
    private var registered = false
    private var advertised = false
    @Volatile private var stopped = false
    @Volatile private var connection: Socket? = null
    private var generation = 0
    private var addressRetries = 0
    private var ownsGroup = false

    private val listener = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (advertised) { addressRetries = 0; checkGroup() }
        }
    }

    private fun action(next: () -> Unit) = object : WifiP2pManager.ActionListener {
        override fun onSuccess() { if (!stopped) next() }
        override fun onFailure(reason: Int) {
            if (!stopped) {
                Log.w("FcboardProjection", "Wi-Fi Display action failed: $reason")
                state("error")
            }
        }
    }

    fun start() {
        val ch = manager.initialize(context, main.looper) { if (!stopped) state("error") }
        checkNotNull(ch)
        channel = ch
        context.registerReceiver(listener, IntentFilter(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION),
            Context.RECEIVER_EXPORTED)
        registered = true
        val info = WifiP2pWfdInfo().apply {
            isEnabled = true
            setDeviceType(WifiP2pWfdInfo.DEVICE_TYPE_PRIMARY_SINK)
            isSessionAvailable = true
            controlPort = 7236
            maxThroughput = 50
        }
        manager.setWfdInfo(ch, info, action {
            advertised = true
            manager.requestDeviceInfo(ch) { device -> device?.deviceName?.let(name) }
            listen(ch)
        })
    }

    private fun listen(ch: WifiP2pManager.Channel) {
        manager.startListening(ch, action { state("waiting"); checkGroup() })
    }

    private fun checkGroup() {
        val ch = channel ?: return
        val revision = ++generation
        manager.requestConnectionInfo(ch) { info ->
            if (stopped || generation != revision) return@requestConnectionInfo
            if (info?.groupFormed != true) {
                connection?.let { runCatching { it.close() } }
                return@requestConnectionInfo
            }
            if (connection != null) return@requestConnectionInfo
            manager.requestGroupInfo(ch) { group ->
                if (stopped || generation != revision || group == null || connection != null) return@requestGroupInfo
                val device = if (info.isGroupOwner) group.clientList.firstOrNull() else group.owner
                if (device == null) return@requestGroupInfo
                val peer = when {
                    !info.isGroupOwner -> info.groupOwnerAddress
                    Build.VERSION.SDK_INT >= 35 -> device.ipAddress
                    else -> null
                }
                if (peer == null) {
                    if (Build.VERSION.SDK_INT >= 35 && addressRetries++ < 8) {
                        main.postDelayed({ if (!stopped && generation == revision) checkGroup() }, 500)
                    } else state("error")
                    return@requestGroupInfo
                }
                addressRetries = 0
                val wfd = device.wfdInfo
                if (wfd?.deviceType == WifiP2pWfdInfo.DEVICE_TYPE_PRIMARY_SINK) return@requestGroupInfo
                ownsGroup = true
                dial(peer, wfd?.controlPort?.takeIf { it in 1..65535 } ?: 7236)
            }
        }
    }

    private fun dial(peer: InetAddress, port: Int) {
        val socket = Socket()
        connection = socket
        state("connecting")
        worker.execute {
            var media: RtpReceiver? = null
            try {
                socket.connect(InetSocketAddress(peer, port), 4500)
                DatagramSocket(InetSocketAddress(socket.localAddress, 0)).use { udp ->
                    val session = WfdSessionHandler(context, socket, udp.localPort)
                    media = RtpReceiver(udp, peer, surface).also {
                        it.onIdrRequest = session::requestIdr
                        it.start()
                    }
                    session.onStreamStart = {
                        main.post { if (!stopped && connection === socket) state("connected") }
                    }
                    session.handleSession()
                }
            } catch (error: Exception) {
                if (!stopped) Log.w("FcboardProjection", "Wi-Fi Display session ended", error)
            } finally {
                runCatching { socket.close() }
                media?.stop()
                main.post {
                    if (!stopped && connection === socket) {
                        connection = null
                        state("starting")
                        channel?.let { ch ->
                            ownsGroup = false
                            manager.removeGroup(ch, object : WifiP2pManager.ActionListener {
                                override fun onSuccess() { if (!stopped) listen(ch) }
                                override fun onFailure(reason: Int) { if (!stopped) listen(ch) }
                            })
                        }
                    }
                }
            }
        }
    }

    fun stop() {
        stopped = true
        runCatching { connection?.close() }
        worker.shutdownNow()
        if (registered) context.unregisterReceiver(listener)
        channel?.let { ch ->
            if (ownsGroup) runCatching { manager.removeGroup(ch, null) }
            runCatching { manager.stopListening(ch, null) }
            runCatching { manager.setWfdInfo(ch, WifiP2pWfdInfo().apply { isEnabled = false }, null) }
            ch.close()
        }
        channel = null
    }
}
