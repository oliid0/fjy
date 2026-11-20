package com.airplay.cast

import android.content.Context
import android.net.wifi.WifiManager
import android.util.Log
import com.airplay.util.NetworkUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.DatagramPacket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface
import java.net.SocketTimeoutException
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.SSLServerSocket
import javax.net.ssl.SSLSocket

internal class GoogleCastReceiver(private val context: Context, private val name: String,
                                  private val session: CastSession, private val ready: (Boolean) -> Unit) {
    private data class Lan(val ip: Inet4Address, val prefixLength: Int) {
        fun contains(address: InetAddress): Boolean {
            if (address !is Inet4Address) return false
            val own = ip.address
            val remote = address.address
            for (index in own.indices) {
                val bits = (prefixLength - index * 8).coerceIn(0, 8)
                if (((own[index].toInt() xor remote[index].toInt()) and 255) ushr (8 - bits) != 0) return false
            }
            return true
        }
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val device = NetworkUtils.getPersistentUuid(context).replace("-", "")
    private val group = InetSocketAddress("224.0.0.251", 5353)
    private val guard = Any()
    @Volatile private var closed = false
    private var binding: Binding? = null
    private var identity: LocalCastIdentity? = null
    private var issuedAt = 0L

    fun start() {
        scope.launch {
            while (isActive) {
                val lan = runCatching { activeLan() }.getOrNull()
                val current = synchronized(guard) { binding }
                if (lan == null || current == null || current.lan != lan || current.server.isClosed ||
                    current.mdns.isClosed || (System.currentTimeMillis() - issuedAt > 86_400_000L && current.empty())) {
                    synchronized(guard) {
                        current?.close()
                        binding = null
                        if (current != null) session.reset()
                    }
                    if (lan == null || closed) ready(false)
                    else try {
                        if (identity == null || System.currentTimeMillis() - issuedAt > 86_400_000L) {
                            identity = LocalCastIdentity()
                            issuedAt = System.currentTimeMillis()
                        }
                        val next = Binding(lan, requireNotNull(identity))
                        synchronized(guard) {
                            if (closed) next.close()
                            else {
                                binding = next
                                next.start()
                                ready(true)
                            }
                        }
                    } catch (error: Exception) {
                        if (!closed) {
                            Log.w("FcboardProjection", "Cast media receiver could not bind", error)
                            ready(false)
                        }
                    }
                }
                delay(5_000)
            }
        }
    }

    private fun activeLan(): Lan? {
        val link = NetworkUtils.lanLinks(context).firstOrNull() ?: return null
        return Lan(link.address, link.prefixLength)
    }

    fun stop() {
        synchronized(guard) {
            closed = true
            binding?.close()
            binding = null
            session.reset()
        }
        scope.cancel()
    }

    private inner class Binding(val lan: Lan, private val identity: LocalCastIdentity) {
        val server = identity.tls.serverSocketFactory.createServerSocket() as SSLServerSocket
        val mdns = MulticastSocket(null)
        private val discovery = CastDiscovery(device, name, lan.ip, 8009)
        private val peers = mutableSetOf<SSLSocket>()
        private val closing = AtomicBoolean()
        private val announcements = Any()
        private val multicast = context.getSystemService(WifiManager::class.java)?.createMulticastLock("Fcboard-Cast")

        init {
            try {
                server.reuseAddress = true
                server.enabledProtocols = server.supportedProtocols.filter { it == "TLSv1.2" || it == "TLSv1.3" }.toTypedArray()
                server.bind(InetSocketAddress(lan.ip, 8009))
                val adapter = requireNotNull(NetworkInterface.getByInetAddress(lan.ip))
                mdns.reuseAddress = true
                mdns.bind(InetSocketAddress(5353))
                mdns.networkInterface = adapter
                mdns.timeToLive = 255
                mdns.soTimeout = 1000
                mdns.joinGroup(group, adapter)
                multicast?.acquire()
                broadcast(120)
            } catch (error: Exception) {
                close()
                throw error
            }
        }

        fun empty(): Boolean = synchronized(peers) { peers.isEmpty() }

        private fun broadcast(ttl: Int) = synchronized(announcements) {
            if (ttl == 0 || !closing.get()) {
                val bytes = discovery.packet(ttl)
                mdns.send(DatagramPacket(bytes, bytes.size, group))
            }
        }

        fun start() {
            scope.launch {
                try {
                    while (isActive) {
                        val socket = server.accept() as SSLSocket
                        val accepted = synchronized(peers) {
                            !server.isClosed && lan.contains(socket.inetAddress) && peers.size < 8 && peers.add(socket)
                        }
                        if (accepted) {
                            scope.launch { serve(socket) }.invokeOnCompletion {
                                synchronized(peers) { peers.remove(socket) }
                                runCatching { socket.close() }
                            }
                        } else socket.close()
                    }
                } catch (_: Exception) {
                    runCatching { server.close() }
                }
            }
            scope.launch {
                val buffer = ByteArray(1500)
                var lastAnnouncement = 0L
                try {
                    while (isActive && !closing.get() && !mdns.isClosed) {
                        val now = android.os.SystemClock.elapsedRealtime()
                        if (now - lastAnnouncement >= 30_000L) {
                            broadcast(120)
                            lastAnnouncement = now
                        }
                        val input = DatagramPacket(buffer, buffer.size)
                        try { mdns.receive(input) } catch (_: SocketTimeoutException) { continue }
                        if (!lan.contains(input.address)) continue
                        val response = discovery.answer(buffer.copyOf(input.length), input.port) ?: continue
                        val target = if (response.unicast) input.socketAddress else group
                        synchronized(announcements) {
                            if (!closing.get()) mdns.send(DatagramPacket(response.bytes, response.bytes.size, target))
                        }
                    }
                } catch (_: Exception) {
                    mdns.close()
                }
            }
        }

        private suspend fun serve(socket: SSLSocket) = coroutineScope {
            val peer = UUID.randomUUID().toString()
            try {
                socket.soTimeout = 15_000
                socket.startHandshake()
                socket.soTimeout = 30_000
                val input = DataInputStream(socket.inputStream)
                val output = DataOutputStream(socket.outputStream)
                val ticker = launch {
                    try {
                        while (isActive) {
                            delay(1000)
                            synchronized(output) {
                                session.tick(peer)?.let { CastWire.write(output, it) }
                            }
                        }
                    } catch (_: Exception) {
                        runCatching { socket.close() }
                    }
                }
                try {
                    while (isActive && !socket.isClosed) {
                        val message = CastWire.read(input)
                        synchronized(output) {
                            val answer = if (message.namespace == CAST_AUTH && message.binary && message.destination == "receiver-0") {
                                CastMessage("receiver-0", message.source, CAST_AUTH, identity.answer(message.payload), true)
                            } else {
                                require(!message.binary)
                                synchronized(guard) {
                                    if (binding !== this@Binding) null else session.handle(peer, message)
                                }
                            }
                            answer?.let { CastWire.write(output, it) }
                        }
                    }
                } finally {
                    ticker.cancel()
                }
            } catch (_: Exception) {
                runCatching { socket.close() }
            } finally {
                session.disconnect(peer)
            }
        }

        fun close() {
            if (!closing.compareAndSet(false, true)) return
            runCatching { server.close() }
            synchronized(peers) { peers.forEach { runCatching { it.close() } }; peers.clear() }
            if (!mdns.isClosed) {
                CoroutineScope(Dispatchers.IO).launch {
                    runCatching { broadcast(0) }
                    mdns.close()
                    runCatching { if (multicast?.isHeld == true) multicast.release() }
                }
            } else runCatching { if (multicast?.isHeld == true) multicast.release() }
        }
    }
}
