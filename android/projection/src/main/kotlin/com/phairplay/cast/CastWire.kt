package com.airplay.cast

import org.bouncycastle.asn1.ASN1Integer
import org.bouncycastle.asn1.DERBitString
import org.bouncycastle.asn1.DERNull
import org.bouncycastle.asn1.DERSequence
import org.bouncycastle.asn1.pkcs.PKCSObjectIdentifiers
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.asn1.x509.AlgorithmIdentifier
import org.bouncycastle.asn1.x509.SubjectPublicKeyInfo
import org.bouncycastle.asn1.x509.Time
import org.bouncycastle.asn1.x509.V3TBSCertificateGenerator
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.SecureRandom
import java.security.Signature
import java.security.cert.CertificateFactory
import java.util.Date
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext

internal const val CAST_RECEIVER = "urn:x-cast:com.google.cast.receiver"
internal const val CAST_MEDIA = "urn:x-cast:com.google.cast.media"
internal const val CAST_CONNECTION = "urn:x-cast:com.google.cast.tp.connection"
internal const val CAST_HEARTBEAT = "urn:x-cast:com.google.cast.tp.heartbeat"
internal const val CAST_AUTH = "urn:x-cast:com.google.cast.tp.deviceauth"

internal data class CastMessage(val source: String, val destination: String, val namespace: String,
                                val payload: ByteArray, val binary: Boolean = false) {
    fun reply(body: String) = CastMessage(destination, source, namespace, body.toByteArray())
}

internal object CastWire {
    private const val MAX_FRAME = 256 * 1024

    fun read(input: DataInputStream): CastMessage {
        val size = input.readInt()
        require(size in 1..MAX_FRAME)
        val frame = ByteArray(size).also { input.readFully(it) }
        val fields = fields(frame)
        require(fields[1] == 0L && fields[8] != 1L)
        val binary = when (fields[5]) { 0L -> false; 1L -> true; else -> error("Unsupported Cast payload") }
        fun label(tag: Int) = (fields[tag] as ByteArray).decodeToString(throwOnInvalidSequence = true)
            .also { require(it.length in 1..256) }
        return CastMessage(label(2), label(3), label(4), fields[if (binary) 7 else 6] as ByteArray, binary)
    }

    fun write(output: DataOutputStream, message: CastMessage) {
        val body = encode(1 to 0, 2 to message.source.toByteArray(), 3 to message.destination.toByteArray(),
            4 to message.namespace.toByteArray(), 5 to (if (message.binary) 1 else 0),
            (if (message.binary) 7 else 6) to message.payload)
        require(body.size <= MAX_FRAME)
        synchronized(output) {
            output.writeInt(body.size)
            output.write(body)
            output.flush()
        }
    }

    fun encode(vararg fields: Pair<Int, Any>): ByteArray = ByteArrayOutputStream().apply {
        fun put(number: Long) {
            var value = number
            while (value >= 128) {
                write((value.toInt() and 127) or 128)
                value = value ushr 7
            }
            write(value.toInt())
        }
        for ((id, value) in fields) {
            if (value is ByteArray) {
                put(id * 8L + 2)
                put(value.size.toLong())
                write(value)
            } else {
                put(id * 8L)
                put((value as Number).toLong())
            }
        }
    }.toByteArray()

    fun fields(data: ByteArray): Map<Int, Any> {
        var index = 0
        fun readVarint(): Long {
            var result = 0L
            for (shift in 0..63 step 7) {
                require(index < data.size)
                val octet = data[index++].toInt() and 255
                require(shift < 63 || octet <= 1)
                result = result or ((octet and 127).toLong() shl shift)
                if (octet < 128) return result
            }
            error("Invalid protobuf varint")
        }
        fun advance(size: Int): Int {
            require(size in 0..(data.size - index))
            val offset = index
            index += size
            return offset
        }
        val result = mutableMapOf<Int, Any>()
        while (index < data.size) {
            val key = readVarint()
            require(key in 8..0xffffffffL)
            val tag = (key ushr 3).toInt()
            when ((key and 7).toInt()) {
                0 -> { val number = readVarint(); if (tag <= 8) result[tag] = number }
                1 -> advance(8)
                2 -> {
                    val length = readVarint()
                    require(length in 0..(data.size - index).toLong())
                    val offset = advance(length.toInt())
                    if (tag <= 8) result[tag] = data.copyOfRange(offset, index)
                }
                5 -> advance(4)
                else -> error("Invalid protobuf wire type")
            }
        }
        return result
    }
}

internal class LocalCastIdentity {
    private val pair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
    private val certificate: ByteArray
    val tls: SSLContext

    init {
        val name = X500Name("CN=Fcboard Cast")
        val algorithm = AlgorithmIdentifier(PKCSObjectIdentifiers.sha256WithRSAEncryption, DERNull.INSTANCE)
        val now = System.currentTimeMillis()
        val tbs = V3TBSCertificateGenerator().apply {
            setSerialNumber(ASN1Integer(BigInteger(128, SecureRandom()).setBit(127)))
            setIssuer(name)
            setSubject(name)
            setSignature(algorithm)
            setStartDate(Time(Date(now - 60_000)))
            setEndDate(Time(Date(now + 3 * 86_400_000L)))
            setSubjectPublicKeyInfo(SubjectPublicKeyInfo.getInstance(pair.public.encoded))
        }.generateTBSCertificate()
        certificate = DERSequence(arrayOf(tbs, algorithm, DERBitString(sign(tbs.encoded, true)))).encoded
        val x509 = CertificateFactory.getInstance("X.509").generateCertificate(certificate.inputStream())
        val password = charArrayOf()
        val store = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
            load(null, null)
            setKeyEntry("cast", pair.private, password, arrayOf(x509))
        }
        val keys = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(store, password) }
        tls = SSLContext.getInstance("TLS").apply { init(keys.keyManagers, null, null) }
    }

    private fun sign(bytes: ByteArray, sha256: Boolean): ByteArray =
        Signature.getInstance(if (sha256) "SHA256withRSA" else "SHA1withRSA").run {
            initSign(pair.private)
            update(bytes)
            sign()
        }

    fun answer(payload: ByteArray): ByteArray {
        require(payload.size <= 4096)
        val challenge = CastWire.fields(CastWire.fields(payload)[1] as ByteArray)
        val signature = challenge[1] ?: 1L
        val hash = challenge[3] ?: 0L
        if (signature != 1L || (hash != 0L && hash != 1L)) {
            return CastWire.encode(3 to CastWire.encode(1 to 2))
        }
        val nonce = challenge[2] as? ByteArray ?: byteArrayOf()
        require(nonce.size <= 256)
        return CastWire.encode(2 to CastWire.encode(1 to sign(nonce + certificate, hash == 1L),
            2 to certificate, 4 to 1, 5 to nonce, 6 to (hash as Long)))
    }
}
