package com.airplay.airplay

import com.airplay.airplay.handshake.PlistCodec
import java.io.IOException
import java.net.Socket
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** AirPlay's PTTH socket sends events to the phone. FCUP replies arrive on a separate POST /action. */
internal class AirPlayVideoChannel(val socket: Socket, val session: String) {
    private data class Request(val url: String, val result: CompletableFuture<ByteArray>)
    private val nextId = AtomicInteger()
    private val pending = ConcurrentHashMap<Int, Request>()
    private val writer = Executors.newSingleThreadExecutor()
    @Volatile private var closed = false

    fun fetch(url: String): ByteArray {
        if (!url.startsWith("mlhls://localhost/") || closed) throw IOException("No AirPlay resource channel")
        val id = nextId.incrementAndGet()
        val request = Request(url, CompletableFuture())
        pending[id] = request
        try {
            event(mapOf("sessionID" to 1, "type" to "unhandledURLRequest", "request" to mapOf(
                "FCUP_Response_ClientInfo" to 1, "FCUP_Response_ClientRef" to 40030004,
                "FCUP_Response_RequestID" to id, "FCUP_Response_URL" to url, "sessionID" to 1,
                "FCUP_Response_Headers" to mapOf("X-Playback-Session-Id" to session, "User-Agent" to "AppleCoreMedia/1.0")
            )))
            return request.result.get(15, TimeUnit.SECONDS)
        } catch (error: InterruptedException) {
            Thread.currentThread().interrupt()
            throw java.io.InterruptedIOException("AirPlay resource cancelled")
        } catch (error: Exception) {
            throw IOException("AirPlay resource unavailable", error)
        } finally {
            pending.remove(id)
        }
    }

    fun complete(message: Map<String, Any?>): Boolean {
        if (message["type"] != "unhandledURLResponse") return false
        val params = message["params"] as? Map<*, *> ?: return false
        val id = (params["FCUP_Response_RequestID"] as? Number)?.toInt() ?: return false
        val request = pending[id] ?: return false
        if (params.containsKey("FCUP_Response_URL") && params["FCUP_Response_URL"] != request.url) return false
        val status = (params["FCUP_Response_StatusCode"] as? Number)?.toInt() ?: 200
        val data = params["FCUP_Response_Data"] as? ByteArray
        if (data != null && (status == 0 || status in 200..299)) request.result.complete(data)
        else request.result.completeExceptionally(IOException("Sender media response: $status"))
        return true
    }

    fun state(value: String) = event(mapOf("category" to "video", "sessionID" to 1, "state" to value))

    private fun event(message: Map<String, Any?>) {
        if (closed) return
        try {
            writer.execute {
                try {
                    val body = PlistCodec.encodeXml(message)
                    val header = "POST /event HTTP/1.1\r\nContent-Type: text/x-apple-plist+xml\r\n" +
                        "X-Apple-Session-ID: $session\r\nContent-Length: ${body.size}\r\n\r\n"
                    socket.getOutputStream().apply { write(header.toByteArray(Charsets.US_ASCII)); write(body); flush() }
                } catch (_: Exception) { close() }
            }
        } catch (_: RejectedExecutionException) { /* Socket closed while scheduling. */ }
    }

    fun close() {
        closed = true
        runCatching { socket.close() }
        pending.values.forEach { it.result.completeExceptionally(IOException("AirPlay event channel closed")) }
        writer.shutdownNow()
    }
}
