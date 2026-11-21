package com.airplay.castplus

import android.content.Context
import android.os.Build
import android.util.Log
import android.view.Surface

interface CastPlusEngine {
    interface Events {
        fun state(value: String)
        fun size(width: Int, height: Int)
        fun request(token: String, sender: String, pin: String, accepted: Boolean)
    }

    fun start()
    fun attach(surface: Surface?)
    fun answer(token: String, allow: Boolean)
    fun stop()
}

object CastPlusSupport {
    @JvmStatic fun isAvailable(): Boolean =
        Build.SUPPORTED_ABIS.firstOrNull() in setOf("arm64-v8a", "armeabi-v7a")

    internal fun create(context: Context, name: String, events: CastPlusEngine.Events): CastPlusEngine {
        check(isAvailable())
        return HuaweiCastPlusEngine(context, name, events)
    }

    @JvmStatic fun initialize(context: Context) {
        if (!isAvailable() || Build.VERSION.SDK_INT < 30) return
        val process = android.app.Application.getProcessName()
        if (process != "${context.packageName}:projection_media" &&
            process != "${context.packageName}:castplus_nearby") return
        try {
            System.loadLibrary("castplus_network_compat")
        } catch (error: LinkageError) {
            Log.w("FcboardProjection", "Cast+ network adapter unavailable", error)
        }
    }
}
