package com.airplay.airplay.handshake

import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * MirrorCrypto — key derivation and helpers for the AirPlay mirroring video stream.
 *
 * The stream is AES-128-CTR encrypted. RPiPlay's per-packet `og`/`nextDecryptCount`
 * bookkeeping (lib/mirror_buffer.c) reduces to a single continuous CTR keystream over the
 * concatenated video payloads (every full-block chunk leaves the cipher block-aligned, so
 * `aes_ctr_start_fresh_block` is always a no-op) — so one [Cipher] with sequential
 * `update()` per payload is exactly equivalent.
 *
 * Reference: RPiPlay lib/mirror_buffer.c (mirror_buffer_init_aes / mirror_buffer_decrypt).
 */
object MirrorCrypto {

    /**
     * Builds the AES-128-CTR cipher that decrypts the mirror video stream.
     *
     * key = SHA512("AirPlayStreamKey"+id ‖ mediaKey)[:16],
     * iv  = SHA512("AirPlayStreamIV"+id ‖ mediaKey)[:16], where id is the unsigned decimal
     * streamConnectionID.
     */
    fun streamCipher(mediaKey: ByteArray, streamConnectionId: Long): Cipher {
        val id = java.lang.Long.toUnsignedString(streamConnectionId)
        val key = sha512("AirPlayStreamKey$id".toByteArray(Charsets.US_ASCII) + mediaKey).copyOf(16)
        val iv = sha512("AirPlayStreamIV$id".toByteArray(Charsets.US_ASCII) + mediaKey).copyOf(16)
        return Cipher.getInstance("AES/CTR/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(iv))
        }
    }

    /**
     * Converts 4-byte big-endian length-prefixed NAL units — the format of a decrypted
     * mirror video payload — into Annex-B (00 00 00 01 start codes) that MediaCodec expects.
     */
    fun lengthPrefixedToAnnexB(data: ByteArray): ByteArray {
        val out = ByteArrayOutputStream(data.size + 16)
        var i = 0
        while (i + 4 <= data.size) {
            val len = ((data[i].toInt() and 0xFF) shl 24) or
                ((data[i + 1].toInt() and 0xFF) shl 16) or
                ((data[i + 2].toInt() and 0xFF) shl 8) or
                (data[i + 3].toInt() and 0xFF)
            i += 4
            if (len <= 0 || len > data.size - i) return ByteArray(0)
            out.write(START_CODE)
            out.write(data, i, len)
            i += len
        }
        return if (i == data.size) out.toByteArray() else ByteArray(0)
    }

    val START_CODE = byteArrayOf(0, 0, 0, 1)

    /** FairPlay key reused directly, or mixed with the shared secret after completed legacy pairing. */
    fun mediaKey(aesKey: ByteArray, ecdhSecret: ByteArray?): ByteArray =
        if (ecdhSecret == null) aesKey else sha512(aesKey + ecdhSecret).copyOf(16)

    private fun sha512(b: ByteArray): ByteArray = MessageDigest.getInstance("SHA-512").digest(b)
}
