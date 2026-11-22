package com.airplay.airplay.handshake

import android.content.Context
import com.airplay.util.NetworkUtils
import java.io.ByteArrayOutputStream

/**
 * InfoResponder — builds the binary-plist body for `GET /info`, the first request a macOS
 * AirPlay sender makes. It advertises the receiver's identity and capability bits so the
 * sender knows to continue with pairing → FairPlay → mirroring.
 *
 * Values are kept consistent with what [com.airplay.airplay.MdnsService] advertises so the
 * sender sees one coherent device.
 *
 */
object InfoResponder {

    private const val VIDEO_URL_V1 = 1L shl 0
    private const val LEGACY_PAIRING = 1L shl 27
    private const val SCREEN_MULTI_CODEC = 1L shl 42
    const val MODEL = "AppleTV3,2"
    const val SOURCE_VERSION = "220.68"

    fun features(pinRequired: Boolean, hevc: Boolean): Long = 0x527FFEE6L or VIDEO_URL_V1 or
        (if (pinRequired) LEGACY_PAIRING else 0L) or (if (hevc) SCREEN_MULTI_CODEC else 0L)

    fun airPlayAttributes(context: Context, pinRequired: Boolean, hevc: Boolean): Map<String, String> = mapOf(
        "deviceid" to NetworkUtils.getReceiverId(context),
        "features" to featureText(pinRequired, hevc),
        "flags" to "0x4",
        "model" to MODEL,
        "pk" to publicKeyText(context),
        "pi" to NetworkUtils.getPersistentUuid(context),
        "pw" to pinRequired.toString(),
        "srcvers" to SOURCE_VERSION,
        "vv" to "2"
    )

    fun raopAttributes(context: Context, pinRequired: Boolean, hevc: Boolean): Map<String, String> = mapOf(
        "ch" to "2", "cn" to "0,1,2,3", "da" to "true", "et" to "0,3,5",
        "ft" to featureText(pinRequired, hevc), "am" to MODEL, "md" to "0,1,2", "rhd" to "5.6.0.0",
        "pw" to pinRequired.toString(), "sf" to (if (pinRequired) "0x8c" else "0x4"),
        "sr" to "44100", "ss" to "16", "sv" to "false", "tp" to "UDP", "txtvers" to "1",
        "vs" to SOURCE_VERSION, "vn" to "65537", "vv" to "2", "pk" to publicKeyText(context)
    )

    fun qualified(context: Context, qualifiers: Collection<String>, pinRequired: Boolean, hevc: Boolean): Map<String, ByteArray> =
        buildMap {
            if ("txtAirPlay" in qualifiers) put("txtAirPlay", encodeTxt(airPlayAttributes(context, pinRequired, hevc)))
            if ("txtRAOP" in qualifiers) put("txtRAOP", encodeTxt(raopAttributes(context, pinRequired, hevc)))
        }

    private fun featureText(pinRequired: Boolean, hevc: Boolean): String {
        val bits = features(pinRequired, hevc)
        return "0x${(bits and 0xffffffffL).toString(16).uppercase()},0x${(bits ushr 32).toString(16).uppercase()}"
    }

    private fun publicKeyText(context: Context): String = PairingKeys.get(context).edPublic.joinToString("") { "%02x".format(it) }

    private fun encodeTxt(attributes: Map<String, String>): ByteArray = ByteArrayOutputStream().apply {
        for ((key, value) in attributes) {
            val entry = "$key=$value".toByteArray(Charsets.UTF_8)
            require(entry.size <= 255)
            write(entry.size)
            write(entry)
        }
    }.toByteArray()

    fun capabilities(context: Context, name: String, width: Int, height: Int, fps: Int, pinRequired: Boolean, hevc: Boolean, includeMedia: Boolean): Map<String, Any> {
        val mac = NetworkUtils.getReceiverId(context)
        val statusFlags = if (pinRequired) 0x4cL else 0x44L
        val info = mutableMapOf<String, Any>(
            "deviceID" to mac,
            "macAddress" to mac,
            "features" to features(pinRequired, hevc),
            "statusFlags" to statusFlags,
            "model" to MODEL,
            "name" to name,
            "sourceVersion" to SOURCE_VERSION,
            "pi" to NetworkUtils.getPersistentUuid(context),
            "pk" to PairingKeys.get(context).edPublic,
            "vv" to 2L,
            "protovers" to "1.1",
            "keepAliveLowPower" to true,
            "keepAliveSendStatsAsBody" to true
        )
        if (!includeMedia) return info
        info += mapOf(
            "initialVolume" to 0.0,
            // NOTE: macOS IGNORES this for system-audio AirPlay — it sends ALAC (ct=2) regardless of
            // what we advertise (verified: advertising AAC-only still got ALAC). So we keep the broad
            // set (mirroring negotiates AAC-ELD from it, which works). Audio-only would need a
            // software ALAC decoder since this TV has no hardware ALAC codec.
            "audioFormats" to listOf(
                mapOf("type" to 100L, "audioInputFormats" to 67108860L, "audioOutputFormats" to 67108860L),
                mapOf("type" to 101L, "audioInputFormats" to 67108860L, "audioOutputFormats" to 67108860L)
            ),
            "audioLatencies" to listOf(
                mapOf("type" to 100L, "audioType" to "default", "inputLatencyMicros" to 0L, "outputLatencyMicros" to 0L),
                mapOf("type" to 101L, "audioType" to "default", "inputLatencyMicros" to 0L, "outputLatencyMicros" to 0L)
            ),
            // Screen the sender can mirror to — without this, macOS aborts after key setup.
            "displays" to listOf(
                mapOf(
                    "uuid" to "e0ff8a27-6738-3d56-8a16-cc53aacee925",
                    "widthPhysical" to 0L,
                    "heightPhysical" to 0L,
                    "width" to width.toLong(),
                    "height" to height.toLong(),
                    "widthPixels" to width.toLong(),
                    "heightPixels" to height.toLong(),
                    "rotation" to false,
                    "refreshRate" to (1.0 / fps.coerceIn(1, 60)),
                    "maxFPS" to fps.coerceIn(1, 60).toLong(),
                    "overscanned" to false,   // false = macOS uses the full advertised resolution
                    "features" to 14L
                )
            )
        )
        return info
    }
}
