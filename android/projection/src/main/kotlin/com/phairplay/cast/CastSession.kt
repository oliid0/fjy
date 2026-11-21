package com.airplay.cast

import com.airplay.util.MediaUriPolicy
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.UUID

internal data class CastItem(val url: String, val mime: String, val title: String)
internal data class CastLoad(val id: Int, val items: List<CastItem>, val index: Int, val position: Long,
                             val autoplay: Boolean, val volume: Float)
internal data class CastSnapshot(val state: String, val position: Long = 0, val duration: Long = 0,
                                 val index: Int = 0, val reason: String? = null)

internal class CastSession(private val load: (CastLoad) -> Unit,
                           private val control: (Int, String, Double) -> Unit) {
    private var transport: String? = null
    private var mediaId = 0
    private var media = emptyList<CastItem>()
    private var snapshot = CastSnapshot("IDLE")
    private var volume = 1.0
    private var muted = false
    private val bindings = mutableMapOf<String, Pair<String, String>>()

    @Synchronized
    fun handle(peer: String, message: CastMessage): CastMessage? {
        val body = JSONObject(message.payload.decodeToString(throwOnInvalidSequence = true))
        val type = body.optString("type")
        fun reply(payload: JSONObject): CastMessage {
            if (body.has("requestId")) payload.put("requestId", body.optInt("requestId"))
            return message.reply(payload.toString())
        }
        fun reject(reason: String, kind: String = "INVALID_REQUEST") = reply(json("type" to kind, "reason" to reason))
        when (message.namespace) {
            CAST_HEARTBEAT -> return if (type == "PING") reply(json("type" to "PONG")) else null
            CAST_CONNECTION -> {
                if (message.destination == transport && type == "CONNECT") {
                    bindings[peer] = message.source to message.destination
                } else if (type == "CLOSE" && bindings[peer] == (message.source to message.destination)) {
                    disconnect(peer)
                }
                return null
            }
            CAST_RECEIVER -> {
                if (message.destination != "receiver-0") return reject("INVALID_DESTINATION")
                when (type) {
                    "GET_STATUS" -> Unit
                    "GET_APP_AVAILABILITY" -> {
                        val ids = body.optJSONArray("appId") ?: body.optJSONArray("appIds")
                            ?: JSONArray().put(body.optString("appId"))
                        val availability = JSONObject()
                        repeat(minOf(ids.length(), 32)) {
                            val app = ids.optString(it).take(64)
                            availability.put(app, if (app == APP) "APP_AVAILABLE" else "APP_UNAVAILABLE")
                        }
                        return reply(json("responseType" to "GET_APP_AVAILABILITY", "availability" to availability))
                    }
                    "LAUNCH" -> {
                        if (body.optString("appId") != APP) return reject("NOT_FOUND", "LAUNCH_ERROR")
                        if (transport == null) transport = UUID.randomUUID().toString()
                    }
                    "STOP" -> {
                        if (transport != body.optString("sessionId")) return reject("INVALID_SESSION")
                        reset()
                    }
                    "SET_VOLUME" -> if (!setVolume(body)) return reject("INVALID_VOLUME")
                    else -> return reject("UNSUPPORTED_COMMAND")
                }
                val apps = JSONArray()
                transport?.let {
                    apps.put(json("appId" to APP, "sessionId" to it, "transportId" to it,
                        "displayName" to "Default Media Receiver", "isIdleScreen" to false,
                        "namespaces" to JSONArray().put(json("name" to CAST_MEDIA))))
                }
                return reply(json("type" to "RECEIVER_STATUS", "status" to json("applications" to apps,
                    "volume" to volumeStatus(), "isActiveInput" to true, "isStandBy" to false)))
            }
            CAST_MEDIA -> {
                val active = transport ?: return reject("INVALID_SESSION")
                if (message.destination != active || bindings[peer] != (message.source to active))
                    return reject("INVALID_SESSION")
                if (type !in setOf("LOAD", "QUEUE_LOAD", "GET_STATUS") &&
                    (media.isEmpty() || body.optInt("mediaSessionId", -1) != mediaId)) return reject("INVALID_MEDIA_SESSION_ID")
                when (type) {
                    "LOAD", "QUEUE_LOAD" -> {
                        val queue = body.optJSONArray("items") ?: body.optJSONObject("queueData")?.optJSONArray("items")
                        val items = if (queue == null) {
                            listOf(parseItem(body.optJSONObject("media")) ?: return reject("INVALID_MEDIA", "LOAD_FAILED"))
                        } else {
                            if (queue.length() !in 1..32) return reject("INVALID_QUEUE", "LOAD_FAILED")
                            (0 until queue.length()).map {
                                parseItem(queue.optJSONObject(it)?.optJSONObject("media"))
                                    ?: return reject("INVALID_MEDIA", "LOAD_FAILED")
                            }
                        }
                        val index = body.optInt("startIndex", body.optJSONObject("queueData")?.optInt("startIndex", 0) ?: 0)
                        if (index !in items.indices) return reject("INVALID_INDEX", "LOAD_FAILED")
                        val start = seconds(body, 0.0) ?: return reject("INVALID_TIME", "LOAD_FAILED")
                        val autoplay = body.opt("autoplay") as? Boolean ?: true
                        media = items
                        mediaId = if (mediaId == Int.MAX_VALUE) 1 else mediaId + 1
                        snapshot = CastSnapshot("BUFFERING", start, index = index)
                        load(CastLoad(mediaId, items, index, start, autoplay, effectiveVolume()))
                    }
                    "GET_STATUS" -> Unit
                    "PLAY", "PAUSE" -> control(mediaId, type, 0.0)
                    "SEEK" -> {
                        val position = seconds(body, -1.0) ?: return reject("INVALID_TIME")
                        control(mediaId, type, position.toDouble())
                        when (body.optString("resumeState")) {
                            "PLAYBACK_START" -> control(mediaId, "PLAY", 0.0)
                            "PLAYBACK_PAUSE" -> control(mediaId, "PAUSE", 0.0)
                        }
                    }
                    "QUEUE_UPDATE" -> {
                        val item = if (body.has("currentItemId")) body.optInt("currentItemId") - 1
                            else snapshot.index + body.optInt("jump")
                        if (item !in media.indices) return reject("INVALID_INDEX")
                        control(mediaId, "JUMP", item.toDouble())
                    }
                    "STOP" -> {
                        snapshot = snapshot.copy(state = "IDLE", reason = "CANCELLED")
                        control(mediaId, "STOP", 0.0)
                    }
                    "SET_VOLUME" -> if (!setVolume(body)) return reject("INVALID_VOLUME")
                    else -> return reject("UNSUPPORTED_COMMAND")
                }
                return reply(status())
            }
        }
        return reject("UNSUPPORTED_NAMESPACE")
    }

    @Synchronized
    fun update(id: Int, value: CastSnapshot) {
        if (id == mediaId && media.isNotEmpty() && snapshot.reason != "CANCELLED") snapshot = value
    }

    @Synchronized
    fun tick(peer: String): CastMessage? {
        val (source, destination) = bindings[peer] ?: return null
        if (media.isEmpty()) return null
        return CastMessage(destination, source, CAST_MEDIA, status().toString().toByteArray())
    }

    @Synchronized
    fun disconnect(peer: String) {
        if (bindings.remove(peer) != null && bindings.isEmpty()) reset()
    }

    @Synchronized
    fun reset() {
        if (media.isNotEmpty()) control(mediaId, "STOP", 0.0)
        transport = null
        media = emptyList()
        bindings.clear()
    }

    private fun status(): JSONObject {
        val list = JSONArray()
        media.getOrNull(snapshot.index)?.let { item ->
            val info = json("contentId" to item.url, "contentType" to item.mime, "streamType" to "BUFFERED",
                "metadata" to json("title" to item.title))
            if (snapshot.duration > 0) info.put("duration", snapshot.duration / 1000.0)
            val value = json("mediaSessionId" to mediaId, "playerState" to snapshot.state,
                "currentTime" to snapshot.position / 1000.0, "playbackRate" to 1, "supportedMediaCommands" to 15,
                "volume" to volumeStatus(), "media" to info, "currentItemId" to snapshot.index + 1)
            snapshot.reason?.let { value.put("idleReason", it) }
            list.put(value)
        }
        return json("type" to "MEDIA_STATUS", "status" to list)
    }

    private fun parseItem(media: JSONObject?): CastItem? {
        if (media == null) return null
        val url = MediaUriPolicy.accept(
            (media.opt("contentUrl") as? String).orEmpty().ifBlank { (media.opt("contentId") as? String).orEmpty() }
        ) ?: return null
        if (runCatching { URI(url).host }.getOrNull().isNullOrBlank()) return null
        val mime = media.optString("contentType").substringBefore(';').trim().lowercase()
        if (mime.isNotEmpty() && mime != "application/octet-stream" && mime != "application/dash+xml" &&
            mime !in setOf("application/x-mpegurl", "application/vnd.apple.mpegurl") &&
            !mime.startsWith("audio/") && !mime.startsWith("video/") && !mime.startsWith("image/")) return null
        return CastItem(url, mime, media.optJSONObject("metadata")?.optString("title").orEmpty().take(256))
    }

    private fun seconds(body: JSONObject, fallback: Double): Long? = body.optDouble("currentTime", fallback)
        .takeIf { it.isFinite() && it in 0.0..(Long.MAX_VALUE / 1000.0) }?.let { (it * 1000).toLong() }

    private fun effectiveVolume() = if (muted) 0f else volume.toFloat()
    private fun volumeStatus() = json("level" to volume, "muted" to muted, "controlType" to "attenuation")
    private fun setVolume(body: JSONObject): Boolean {
        val requested = body.optJSONObject("volume") ?: return false
        if (requested.has("level")) {
            val level = requested.optDouble("level")
            if (!level.isFinite()) return false
            volume = level.coerceIn(0.0, 1.0)
        }
        (requested.opt("muted") as? Boolean)?.let { muted = it }
        if (media.isNotEmpty()) control(mediaId, "VOLUME", effectiveVolume().toDouble())
        return true
    }

    private companion object {
        const val APP = "CC1AD845"
    }
}

internal fun json(vararg fields: Pair<String, Any>) = JSONObject().apply {
    for ((key, value) in fields) put(key, value)
}
