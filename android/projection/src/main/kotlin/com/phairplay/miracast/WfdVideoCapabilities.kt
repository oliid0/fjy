// Ported from weekdayjast/MiracastReceiver (MIT). See THIRD_PARTY_NOTICES.md.
package com.airplay.miracast

import android.content.Context
import android.hardware.display.DisplayManager
import android.media.MediaCodecInfo.CodecProfileLevel
import android.os.Build
import com.airplay.airplay.VideoDecoder
import android.view.Display
import java.util.Locale

data class WfdCustomVideoMode(val width: Int, val height: Int, val fps: Int, val levelBit: Int, val ceaMask: Int) {
    fun customFormat(): String = "%04X %04X %04X".format(Locale.ROOT, width, height, fps)

    /** MS-WFDPE 2.7.1.1: 16-bit native/profile/level, 40-bit CEA/VESA masks. */
    fun extendedFormats(): String =
        "0040 00 0002 %04X %010X 0000000000 00000000 00 0000 0000 00 none none"
            .format(Locale.ROOT, levelBit, ceaMask)
}

/** Pick the smallest H.264 level sufficient for the exact coded macroblock size and rate. */
internal fun wfdAvcLevel(width: Int, height: Int, fps: Int): Pair<Int, Int>? {
    if (width !in 2..65535 || height !in 2..65535 || fps !in 1..60) return null
    val blocks = ((width + 15L) / 16) * ((height + 15L) / 16)
    val levels = listOf(
        Triple(3600L, 108000L, 0x01 to CodecProfileLevel.AVCLevel31),
        Triple(5120L, 216000L, 0x02 to CodecProfileLevel.AVCLevel32),
        Triple(8192L, 245760L, 0x04 to CodecProfileLevel.AVCLevel4),
        Triple(8704L, 522240L, 0x10 to CodecProfileLevel.AVCLevel42),
        Triple(22080L, 589824L, 0x20 to CodecProfileLevel.AVCLevel5),
        Triple(36864L, 983040L, 0x40 to CodecProfileLevel.AVCLevel51),
        Triple(36864L, 2073600L, 0x80 to CodecProfileLevel.AVCLevel52)
    )
    return levels.firstOrNull { blocks <= it.first && blocks * fps <= it.second }?.third
}

// Progressive modes indexed by the Wi-Fi Display CEA resolution table.
private val ceaModes = listOf(
    0 to Triple(640, 480, 60), 1 to Triple(720, 480, 60), 3 to Triple(720, 576, 50),
    5 to Triple(1280, 720, 30), 6 to Triple(1280, 720, 60),
    7 to Triple(1920, 1080, 30), 8 to Triple(1920, 1080, 60),
    10 to Triple(1280, 720, 25), 11 to Triple(1280, 720, 50),
    12 to Triple(1920, 1080, 25), 13 to Triple(1920, 1080, 50),
    15 to Triple(1280, 720, 24), 16 to Triple(1920, 1080, 24)
)

internal fun chooseWfdCustomVideoMode(
    width: Int,
    height: Int,
    portrait: Boolean,
    extended: Boolean,
    supports: (Int, Int, Int, Int) -> Boolean
): WfdCustomVideoMode? {
    if (width < 2 || height < 2) return null
    val longEdge = maxOf(width, height)
    val shortEdge = minOf(width, height)
    val ceaMask = ceaModes.fold(0) { mask, (index, mode) ->
        val (w, h, rate) = mode
        val level = wfdAvcLevel(w, h, rate)
        if (w <= longEdge && h <= shortEdge && level != null && supports(w, h, rate, level.second))
            mask or (1 shl index) else mask
    }
    val edges = (listOf(longEdge) + listOf(3840, 2560, 2160, 1920, 1600, 1280, 1080, 960, 720)
        .filter { it < longEdge }).distinct()
    for (edge in edges) {
        val short = maxOf(2, (shortEdge.toLong() * edge / longEdge).toInt() and -2)
        val w = if (portrait) short else edge and -2
        val h = if (portrait) edge and -2 else short
        for (fps in listOf(60, 30)) {
            val (bit, codecLevel) = wfdAvcLevel(w, h, fps) ?: continue
            if ((!extended && bit > 0x10) || !supports(w, h, fps, codecLevel)) continue
            return WfdCustomVideoMode(w, h, fps, bit, ceaMask)
        }
    }
    return null
}

internal fun wfdCustomVideoMode(context: Context, extended: Boolean): WfdCustomVideoMode? {
    val decoders = runCatching {
        VideoDecoder.regularAvcDecoders().mapNotNull { codec ->
            val hardware = if (Build.VERSION.SDK_INT >= 29) codec.isHardwareAccelerated
                else !codec.name.startsWith("OMX.google.") && !codec.name.startsWith("c2.android.")
            if (hardware) runCatching { codec.getCapabilitiesForType("video/avc") }.getOrNull() else null
        }
    }.getOrDefault(emptyList())
    val (width, height) = displayResolution(context)
    return chooseWfdCustomVideoMode(width, height, height > width, extended) { w, h, fps, level ->
        decoders.any { caps ->
            runCatching {
                caps.profileLevels.any { it.profile == CodecProfileLevel.AVCProfileHigh && it.level >= level } &&
                    (caps.videoCapabilities?.areSizeAndRateSupported(w, h, fps.toDouble()) == true)
            }.getOrDefault(false)
        }
    }
}

/**
 * Physical panel size, clamped to something a phone can encode.
 *
 * The panel may report 4K while the box can only decode 1080p60 smoothly, and Miracast
 * senders refuse absurd sizes, so both axes are clamped before deriving modes.
 */
private fun displayResolution(context: Context): Pair<Int, Int> {
    var width = context.resources.displayMetrics.widthPixels
    var height = context.resources.displayMetrics.heightPixels
    runCatching {
        val display = (context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)
            ?.getDisplay(Display.DEFAULT_DISPLAY)
        val mode = display?.mode
        if (mode != null) {
            width = mode.physicalWidth
            height = mode.physicalHeight
        }
    }
    val longSide = maxOf(width, height).coerceIn(2, 65534)
    val shortSide = minOf(width, height).coerceIn(2, 65534)
    return if (width >= height) longSide to shortSide else shortSide to longSide
}

/** Only negotiate extensions the peer explicitly requested; keep the legacy CEA fallback. */
internal fun wfdVideoCapabilityLines(requested: Set<String>, mode: WfdCustomVideoMode?): List<String> {
    val mask = "%08X".format(Locale.ROOT, mode?.ceaMask ?: 1)
    val level = "%02X".format(Locale.ROOT, (mode?.levelBit ?: 1).coerceAtMost(0x10))
    val lines = mutableListOf("wfd_video_formats: 00 00 02 $level $mask 00000000 00000000 00 0000 0000 00 none none")
    if ("wfdx_video_formats" in requested && mode != null) lines += "wfdx_video_formats: ${mode.extendedFormats()}"
    if ("microsoft_custom_video_formats" in requested) {
        val usable = mode?.takeIf { "wfdx_video_formats" in requested || it.levelBit <= 0x10 }
        lines += "microsoft_custom_video_formats: ${usable?.customFormat() ?: "none"}"
    }
    return lines
}

internal fun matchesWfdCustomMode(value: String, mode: WfdCustomVideoMode): Boolean {
    val fields = value.trim().split(Regex("\\s+"))
    if (fields.size < 3 || fields.take(3).any { !it.matches(Regex("[0-9a-fA-F]{4}")) }) return false
    // MS-WFDPE permits trailing fields, but a source selects exactly one resolution.
    return fields[0].toInt(16) == mode.width && fields[1].toInt(16) == mode.height &&
        fields[2].toInt(16) == mode.fps
}
