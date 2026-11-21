package com.airplay.cast

import com.airplay.util.LocalTlsIdentity
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream

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
    private val identity = LocalTlsIdentity("Fcboard Cast")
    val tls get() = identity.tls

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
        return CastWire.encode(2 to CastWire.encode(1 to identity.sign(nonce + identity.certificate, hash == 1L),
            2 to identity.certificate, 4 to 1, 5 to nonce, 6 to (hash as Long)))
    }
}
