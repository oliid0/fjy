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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.Inet4Address
import java.net.NetworkInterface
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
    private var configuredHere = false
    private var advertised = false
    private var listening = false
    @Volatile private var stopped = false
    @Volatile private var connection: Socket? = null
    private var generation = 0
    private var addressRetries = 0
    private var groupFormed = false
    private var ownsGroup = false
    private var creatingGroup = false
    private var readyForGroups = false
    private val lookupScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var lookup: Job? = null
    private var lookupPeer: String? = null

    private val listener = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == WifiP2pManager.WIFI_P2P_DISCOVERY_CHANGED_ACTION) {
                listening = intent.getIntExtra(WifiP2pManager.EXTRA_DISCOVERY_STATE, 0) == WifiP2pManager.WIFI_P2P_DISCOVERY_STARTED
                return
            }
            if (intent.action == WifiP2pManager.WIFI_P2P_THIS_DEVICE_CHANGED_ACTION && !configuredHere && Build.VERSION.SDK_INT >= 30) {
                manager.requestDeviceInfo(channel ?: return) { device -> useSystemAdvertisement(device) }
            } else {
                addressRetries = 0
                checkGroup()
            }
        }
    }

    // A source can join the P2P group before its RTSP listener is ready.
    private val retryGroup = object : Runnable {
        override fun run() {
            if (stopped) return
            if (connection == null && lookup?.isActive != true) {
                if (!listening) channel?.let(::listen)
                checkGroup()
            }
            main.postDelayed(this, 3000)
        }
    }

    fun start() {
        val ch = manager.initialize(context, main.looper) { if (!stopped) state("error") }
        checkNotNull(ch)
        channel = ch
        val filter = IntentFilter(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION).apply {
            addAction(WifiP2pManager.WIFI_P2P_THIS_DEVICE_CHANGED_ACTION)
            addAction(WifiP2pManager.WIFI_P2P_DISCOVERY_CHANGED_ACTION)
        }
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(listener, filter, Context.RECEIVER_EXPORTED)
        else context.registerReceiver(listener, filter)
        registered = true
        if (Build.VERSION.SDK_INT < 34 || context.checkSelfPermission(android.Manifest.permission.CONFIGURE_WIFI_DISPLAY)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            if (Build.VERSION.SDK_INT >= 30) manager.requestDeviceInfo(ch) { useSystemAdvertisement(it) }
            else useSystemAdvertisement(null)
            startGroups()
            return
        }
        val info = WifiP2pWfdInfo().apply {
            isEnabled = true
            setDeviceType(WifiP2pWfdInfo.DEVICE_TYPE_PRIMARY_SINK)
            isSessionAvailable = true
            controlPort = 7236
            maxThroughput = 50
        }
        manager.setWfdInfo(ch, info, object : WifiP2pManager.ActionListener {
            override fun onSuccess() {
                if (stopped) return
                configuredHere = true
                advertised = true
                manager.requestDeviceInfo(ch) { device -> device?.deviceName?.let(name) }
                listen(ch)
                startGroups()
            }
            override fun onFailure(reason: Int) {
                if (stopped) return
                Log.w("FcboardProjection", "System WFD configuration failed: $reason")
                manager.requestDeviceInfo(ch) { useSystemAdvertisement(it) }
                startGroups()
            }
        })
    }

    private fun startGroups() {
        readyForGroups = true
        main.post(retryGroup)
    }

    private fun systemDisplayEnabled() =
        android.provider.Settings.Global.getInt(context.contentResolver, "wifi_display_on", 0) != 0

    private fun useSystemAdvertisement(device: WifiP2pDevice?) {
        if (stopped || configuredHere || connection != null) return
        val info = if (Build.VERSION.SDK_INT >= 30) device?.wfdInfo else null
        val available = info?.isEnabled == true && info.deviceType in listOf(
            WifiP2pWfdInfo.DEVICE_TYPE_PRIMARY_SINK, WifiP2pWfdInfo.DEVICE_TYPE_SOURCE_OR_PRIMARY_SINK)
        advertised = available
        device?.deviceName?.let(name)
        if (!listening) channel?.let(::listen)
        else if (lookup?.isActive != true) state(listeningState())
    }

    private fun listeningState() = when {
        advertised -> "waiting"
        systemDisplayEnabled() -> "systemManaged"
        groupFormed -> "p2pGroup"
        else -> "starting"
    }

    private fun listen(ch: WifiP2pManager.Channel) {
        listening = true
        val listener = object : WifiP2pManager.ActionListener {
            override fun onSuccess() {
                if (stopped) return
                if (connection == null && lookup?.isActive != true) state(listeningState())
                checkGroup()
            }
            override fun onFailure(reason: Int) {
                listening = false
                if (!stopped && connection == null) {
                    Log.w("FcboardProjection", "Wi-Fi Direct listen failed: $reason")
                    state("error")
                    checkGroup()
                }
            }
        }
        manager.discoverPeers(ch, listener)
    }

    private fun checkGroup() {
        if (!readyForGroups || stopped || creatingGroup) return
        val ch = channel ?: return
        val revision = ++generation
        manager.requestConnectionInfo(ch) { info ->
            if (stopped || generation != revision) return@requestConnectionInfo
            groupFormed = info?.groupFormed == true
            if (info?.groupFormed != true) {
                cancelLookup()
                connection?.let { runCatching { it.close() } }
                ownsGroup = false
                creatingGroup = true
                manager.createGroup(ch, object : WifiP2pManager.ActionListener {
                    override fun onSuccess() {
                        creatingGroup = false
                        if (!stopped) {
                            ownsGroup = true
                            checkGroup()
                        }
                    }
                    override fun onFailure(reason: Int) {
                        creatingGroup = false
                        if (!stopped && reason != WifiP2pManager.BUSY) {
                            state(if (reason == WifiP2pManager.P2P_UNSUPPORTED) "unavailable" else "error")
                            Log.w("FcboardProjection", "Wi-Fi Direct group creation failed: $reason")
                        }
                    }
                })
                return@requestConnectionInfo
            }
            if (connection != null) return@requestConnectionInfo
            manager.requestGroupInfo(ch) { group ->
                if (stopped || generation != revision || group == null || connection != null) return@requestGroupInfo
                val device = if (info.isGroupOwner) {
                    group.clientList.singleOrNull() ?: group.clientList.firstOrNull {
                        Build.VERSION.SDK_INT >= 30 && it.wfdInfo?.isEnabled == true &&
                            it.wfdInfo?.deviceType != WifiP2pWfdInfo.DEVICE_TYPE_PRIMARY_SINK
                    }
                } else group.owner
                if (device == null) {
                    cancelLookup()
                    state(listeningState())
                    return@requestGroupInfo
                }
                val wfd = if (Build.VERSION.SDK_INT >= 30) device.wfdInfo else null
                if (wfd?.deviceType == WifiP2pWfdInfo.DEVICE_TYPE_PRIMARY_SINK) return@requestGroupInfo
                val port = wfd?.controlPort?.takeIf { it in 1..65535 } ?: 7236
                val peer = when {
                    !info.isGroupOwner -> info.groupOwnerAddress
                    Build.VERSION.SDK_INT >= 35 -> device.ipAddress
                    else -> null
                }
                if (peer == null) {
                    if (Build.VERSION.SDK_INT >= 35 && addressRetries++ < 8) {
                        main.postDelayed({ if (!stopped && generation == revision) checkGroup() }, 500)
                    } else if (group.clientList.size == 1 && info.groupOwnerAddress is Inet4Address) {
                        locateGroupClient(group, info.groupOwnerAddress as Inet4Address, device, port)
                    } else state("error")
                    return@requestGroupInfo
                }
                cancelLookup()
                addressRetries = 0
                dial(peer, port)
            }
        }
    }

    private fun cancelLookup() {
        lookup?.cancel()
        lookup = null
        lookupPeer = null
    }

    // Older Android releases omit the client IP. Search only the negotiated
    // single-client P2P interface and keep the first RTSP connection for M1.
    private fun locateGroupClient(group: WifiP2pGroup, owner: Inet4Address, device: WifiP2pDevice, port: Int) {
        val iface = group.getInterface() ?: return
        val key = "$iface/${owner.hostAddress}/${device.deviceAddress}/$port"
        if (lookupPeer == key && lookup?.isActive == true) return
        cancelLookup()
        lookupPeer = key
        state("connecting")
        lookup = lookupScope.launch {
            val opened = java.util.concurrent.ConcurrentHashMap.newKeySet<Socket>()
            try {
                val connected = withContext(Dispatchers.IO) {
                    val link = NetworkInterface.getByName(iface)?.interfaceAddresses?.firstOrNull { it.address == owner }
                    if (!iface.startsWith("p2p") || link?.networkPrefixLength != 24.toShort()) return@withContext null
                    val candidates = (1..254).filter { it != (owner.address.last().toInt() and 255) }
                    for (batch in candidates.chunked(16)) {
                        val found = coroutineScope {
                            batch.map { host -> async {
                                val ip = owner.address.apply { this[3] = host.toByte() }
                                val socket = Socket()
                                opened.add(socket)
                                try {
                                    socket.bind(InetSocketAddress(owner, 0))
                                    socket.connect(InetSocketAddress(InetAddress.getByAddress(ip), port), 400)
                                    socket
                                } catch (_: java.io.IOException) {
                                    runCatching { socket.close() }
                                    opened.remove(socket)
                                    null
                                }
                            } }.awaitAll().firstOrNull { it != null }
                        }
                        if (found != null) return@withContext found
                    }
                    null
                }
                if (isActive && !stopped && connection == null) {
                    if (connected != null) {
                        opened.remove(connected)
                        dial(connected.inetAddress, port, connected)
                    } else state("error")
                }
            } catch (error: java.io.IOException) {
                if (isActive) state("error")
            } finally {
                opened.forEach { runCatching { it.close() } }
            }
        }
    }

    private fun dial(peer: InetAddress, port: Int, socket: Socket = Socket()) {
        connection = socket
        state("connecting")
        worker.execute {
            var media: RtpReceiver? = null
            try {
                if (!socket.isConnected) socket.connect(InetSocketAddress(peer, port), 4500)
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
                        state(listeningState())
                        // Keep the negotiated group: RTSP may start after P2P association.
                        // retryGroup re-reads the current group before dialing again.
                    }
                }
            }
        }
    }

    fun stop() {
        stopped = true
        main.removeCallbacksAndMessages(null)
        lookupScope.cancel()
        runCatching { connection?.close() }
        worker.shutdownNow()
        if (registered) context.unregisterReceiver(listener)
        channel?.let { ch ->
            if (ownsGroup) runCatching { manager.removeGroup(ch, null) }
            if (listening) runCatching {
                manager.stopPeerDiscovery(ch, null)
            }
            if (configuredHere) runCatching { manager.setWfdInfo(ch, WifiP2pWfdInfo().apply { isEnabled = false }, null) }
            if (Build.VERSION.SDK_INT >= 27) ch.close()
        }
        channel = null
    }
}
