package com.airplay.util

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.provider.Settings
import timber.log.Timber
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.SocketException
import java.util.UUID

/**
 * NetworkUtils — Helper functions for reading network interface information.
 *
 * WHY: The AirPlay protocol requires the receiver to advertise its MAC address
 * and device name via mDNS TXT records. This class provides clean, safe methods
 * to read this information from the Android system.
 *
 * HOW: All methods are static (on the companion object) — no instance needed.
 * Read the device name and MAC address once at startup and pass them to MdnsService.
 *
 * Example:
 *   val name = NetworkUtils.getDeviceName(context)   // "My Android TV"
 *   val mac  = NetworkUtils.getReceiverId(context)    // locally administered device ID
 *   val uuid = NetworkUtils.getPersistentUuid(context) // stable UUID per device
 */
object NetworkUtils {
    data class LanLink(val address: Inet4Address, val prefixLength: Int)

    private val lanInterface = Regex("(wlan|wifi|eth|en|ap|softap|swlan|usb|rndis)[0-9_.:-]*", RegexOption.IGNORE_CASE)

    @JvmStatic fun lanLinks(context: Context): List<LanLink> {
        val links = linkedMapOf<Inet4Address, LanLink>()
        val manager = context.getSystemService(ConnectivityManager::class.java)
        if (manager != null) {
            for (network in (listOfNotNull(manager.activeNetwork) + manager.allNetworks).distinct()) {
                val caps = manager.getNetworkCapabilities(network) ?: continue
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) ||
                    !(caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))) continue
                for (link in manager.getLinkProperties(network)?.linkAddresses.orEmpty()) {
                    val ip = link.address as? Inet4Address ?: continue
                    if (!ip.isAnyLocalAddress && !ip.isLinkLocalAddress && !ip.isLoopbackAddress)
                        links[ip] = LanLink(ip, link.prefixLength)
                }
            }
        }
        // Tethering interfaces may only be visible through NetworkInterface.
        try {
            val adapters = NetworkInterface.getNetworkInterfaces()
            while (adapters != null && adapters.hasMoreElements()) {
                val adapter = adapters.nextElement()
                if (!lanInterface.matches(adapter.name) || !adapter.isUp || adapter.isLoopback) continue
                for (link in adapter.interfaceAddresses) {
                    val ip = link.address as? Inet4Address ?: continue
                    val prefix = link.networkPrefixLength.toInt()
                    if (ip.isSiteLocalAddress && prefix in 1..32)
                        links.putIfAbsent(ip, LanLink(ip, prefix))
                }
            }
        } catch (error: SocketException) {
            Timber.w(error, "LAN interface changed during enumeration")
        }
        return links.values.toList()
    }

    /**
     * Returns the user-visible device name as configured in Android settings.
     *
     * This is the name that will appear in the macOS AirPlay picker, so it's
     * important that it matches what the user set in their TV's settings.
     *
     * Sources tried in order:
     * 1. Settings.Global.DEVICE_NAME (Android 5+, most TVs)
     * 2. Settings.Secure.BLUETOOTH_NAME (Bluetooth device name, often same as device name)
     * 3. Fallback: "Airplay" (if neither source is available)
     *
     * SECURITY: The returned value is sanitized — mDNS service names must not contain
     * certain special characters. We strip any character outside [A-Za-z0-9 _-].
     *
     * @param context Android context (needed to read system settings)
     * @return The sanitized device name, never null or empty.
     */
    fun getDeviceName(context: Context): String {
        val rawName = Settings.Global.getString(context.contentResolver, "device_name")
            ?: Settings.Secure.getString(context.contentResolver, "bluetooth_name")
            ?: DEFAULT_DEVICE_NAME

        // Sanitize: keep Unicode letters/digits (Chinese device names included)
        // plus space/underscore/hyphen — these are all valid in mDNS service
        // names (RFC 6763 allows arbitrary UTF-8) and in DLNA device names.
        val sanitized = rawName.replace(Regex("[^\\p{L}\\p{N} _\\-]"), "").trim()

        return sanitized.ifEmpty { DEFAULT_DEVICE_NAME }
    }

    /**
     * AirPlay's MAC-shaped identity stays unique per installation even when Android
     * masks hardware addresses; moving between Wi-Fi and Ethernet does not change it.
     *
     * @return MAC address in "aa:bb:cc:dd:ee:ff" format (lowercase, colon-separated).
     */
    fun getReceiverId(context: Context): String {
        val bits = UUID.fromString(getPersistentUuid(context)).leastSignificantBits
        return (5 downTo 0).joinToString(":") { index ->
            val value = ((bits ushr (index * 8)) and 0xff).toInt()
            "%02x".format(if (index == 5) (value and 0xfc) or 0x02 else value)
        }
    }

    /**
     * Returns a stable, device-specific UUID for use in AirPlay's `pi` TXT record.
     *
     * WHY: macOS uses the `pi` (persistent identifier) to recognize a receiver
     * across app restarts. If we generate a new UUID every time, macOS may show
     * duplicate entries in the AirPlay menu.
     *
     * This UUID is generated once and stored in Android's secure settings,
     * so it persists across app restarts and even reinstalls (as long as the
     * app's data is not cleared).
     *
     * SECURITY: This UUID is not a secret — it's transmitted in plaintext via mDNS.
     * It does not contain any sensitive device information.
     *
     * @param context Android context (needed to read/write secure settings)
     * @return A stable UUID string in standard "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" format.
     */
    @Synchronized fun getPersistentUuid(context: Context): String {
        // Persist the UUID in the app's own private SharedPreferences.
        // (Originally this used Settings.Secure, which requires the privileged
        // WRITE_SECURE_SETTINGS permission and threw a SecurityException on normal
        // installs, aborting AirPlay receiver startup. App-private storage needs no
        // permission and still persists across restarts.)
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val storedUuid = prefs.getString(PREF_KEY_DEVICE_UUID, null)
        if (!storedUuid.isNullOrBlank()) {
            return storedUuid
        }

        // Generate a new UUID and store it for future use
        val newUuid = UUID.randomUUID().toString()
        prefs.edit().putString(PREF_KEY_DEVICE_UUID, newUuid).apply()
        return newUuid
    }

    // Constants
    private const val DEFAULT_DEVICE_NAME = "Airplay"
    private const val PREFS_NAME = "airplay_prefs"
    private const val PREF_KEY_DEVICE_UUID = "airplay_device_uuid"
}
