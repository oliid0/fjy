package com.airplay.cast

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.net.Inet4Address

internal class CastDiscovery(id: String, friendlyName: String, address: Inet4Address, port: Int) {
    private val service = "_googlecast._tcp.local"
    private val instance = "Fcboard-$id.$service"
    private val host = "fcboard-$id.local"
    private val owners = setOf(service, instance.lowercase(), host.lowercase())
    private val records = listOf(
        Record(service, 12, dns { name(instance) }),
        Record(instance, 16, dns {
            val label = friendlyName.take(60)
            for (entry in listOf("id=$id", "fn=$label", "md=Fcboard", "ve=05", "ca=5", "st=0", "nf=1", "rs=")) {
                val bytes = entry.toByteArray()
                writeByte(bytes.size)
                write(bytes)
            }
        }),
        Record(instance, 33, dns { writeShort(0); writeShort(0); writeShort(port); name(host) }),
        Record(host, 1, address.address)
    )
    private data class Record(val owner: String, val type: Int, val data: ByteArray)
    data class Reply(val bytes: ByteArray, val unicast: Boolean)

    fun answer(request: ByteArray, sourcePort: Int): Reply? = runCatching {
        fun word(offset: Int) = (request[offset].toInt() and 255) * 256 + (request[offset + 1].toInt() and 255)
        require(request.size >= 12 && word(2) and 0xf800 == 0)
        val count = word(4)
        require(count in 1..16)
        var offset = 12
        var unicast = sourcePort != 5353
        var matched = false
        val questionBlock = ByteArrayOutputStream()
        val questions = DataOutputStream(questionBlock)
        repeat(count) {
            var at = offset
            var end = -1
            val labels = mutableListOf<String>()
            val visited = mutableSetOf<Int>()
            var expanded = 1
            while (true) {
                require(at in request.indices && visited.add(at))
                val length = request[at].toInt() and 255
                if (length == 0) break
                if (length and 0xc0 == 0xc0) {
                    if (end == -1) end = at + 2
                    val pointer = word(at) and 0x3fff
                    require(pointer < at)
                    at = pointer
                } else {
                    expanded += length + 1
                    require(length in 1..63 && at + 1 + length <= request.size && expanded <= 255)
                    labels.add(request.decodeToString(at + 1, at + 1 + length, true))
                    at += length + 1
                }
            }
            offset = if (end < 0) at + 1 else end
            val type = word(offset)
            val klass = word(offset + 2)
            offset += 4
            val owner = labels.joinToString(".").lowercase()
            if (owner in owners && klass and 0x7fff == 1 && type in setOf(1, 12, 16, 33, 255)) {
                matched = true
                unicast = unicast || klass and 0x8000 != 0
            }
            if (sourcePort != 5353) {
                for (label in labels) { val bytes = label.toByteArray(); questions.writeByte(bytes.size); questions.write(bytes) }
                questions.writeByte(0)
                questions.writeShort(type)
                questions.writeShort(klass)
            }
        }
        if (!matched) return@runCatching null
        val legacy = sourcePort != 5353
        Reply(packet(if (legacy) 10 else 120, if (legacy) word(0) else 0, if (legacy) count else 0,
            questionBlock.toByteArray()), unicast)
    }.getOrNull()

    fun packet(ttl: Int, id: Int = 0, questions: Int = 0, query: ByteArray = byteArrayOf()) = dns {
        writeShort(id)
        writeShort(0x8400)
        writeShort(questions)
        writeShort(records.size)
        writeInt(0)
        write(query)
        for (record in records) {
            name(record.owner)
            writeShort(record.type)
            writeShort(if (questions != 0 || record.type == 12) 1 else 0x8001)
            writeInt(ttl)
            writeShort(record.data.size)
            write(record.data)
        }
    }

    private fun DataOutputStream.name(value: String) {
        for (label in value.split('.')) {
            val bytes = label.toByteArray()
            require(bytes.size in 1..63)
            writeByte(bytes.size)
            write(bytes)
        }
        writeByte(0)
    }

    private fun dns(block: DataOutputStream.() -> Unit): ByteArray =
        ByteArrayOutputStream().also { DataOutputStream(it).block() }.toByteArray()
}
