package com.airplay.util

import okhttp3.Dns
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import java.io.IOException
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.Proxy
import java.net.UnknownHostException

internal object ProjectionMediaHttp {
    fun create(): OkHttpClient = OkHttpClient.Builder().proxy(Proxy.NO_PROXY)
        .followRedirects(false)
        .addInterceptor(::requestMedia)
        .dns(object : Dns {
            override fun lookup(hostname: String) = Dns.SYSTEM.lookup(hostname).filter(::canReach)
                .ifEmpty { throw UnknownHostException("Projection media host is not allowed") }
        })
        .addNetworkInterceptor { chain ->
            val address = chain.connection()?.route()?.socketAddress?.address
            if (address == null || !canReach(address)) throw IOException("Projection media address is not allowed")
            chain.proceed(chain.request())
        }.build()

    private fun canReach(address: InetAddress): Boolean =
        !address.isLoopbackAddress && !address.isAnyLocalAddress && !address.isLinkLocalAddress &&
            !address.isMulticastAddress && HostAddressPolicy.checkHost(address.hostAddress) == null &&
            NetworkInterface.getByInetAddress(address) == null

    private fun requestMedia(chain: Interceptor.Chain): Response {
        var request = chain.request()
        repeat(6) {
            val host = request.url.host
            if (MediaUriPolicy.check(request.url.toString()) != null ||
                ((host.contains(':') || HostAddressPolicy.parseIpv4Literal(host) != null) &&
                    !canReach(InetAddress.getByName(host)))) throw IOException("Projection media address is not allowed")
            val response = chain.proceed(request)
            if (response.code !in setOf(301, 302, 303, 307, 308)) return response
            val next = response.use { it.header("Location")?.let(request.url::resolve) }
                ?: throw IOException("Invalid Projection media redirect")
            if (request.url.isHttps && !next.isHttps) throw IOException("Insecure Projection media redirect")
            request = request.newBuilder().url(next).build()
        }
        throw IOException("Too many Projection media redirects")
    }

}
