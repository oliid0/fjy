package com.airplay.util

import org.bouncycastle.asn1.ASN1Integer
import org.bouncycastle.asn1.DERBitString
import org.bouncycastle.asn1.DERNull
import org.bouncycastle.asn1.DERSequence
import org.bouncycastle.asn1.pkcs.PKCSObjectIdentifiers
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.asn1.x509.AlgorithmIdentifier
import org.bouncycastle.asn1.x509.Extension
import org.bouncycastle.asn1.x509.ExtensionsGenerator
import org.bouncycastle.asn1.x509.GeneralName
import org.bouncycastle.asn1.x509.GeneralNames
import org.bouncycastle.asn1.x509.SubjectPublicKeyInfo
import org.bouncycastle.asn1.x509.Time
import org.bouncycastle.asn1.x509.V3TBSCertificateGenerator
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.SecureRandom
import java.security.Signature
import java.security.cert.CertificateFactory
import java.util.Date
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext

/** TLS for one receiver instance. The key and its certificate live only in memory. */
internal class LocalTlsIdentity(commonName: String, address: String? = null) {
    private val pair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
    val certificate: ByteArray
    val tls: SSLContext

    init {
        val name = X500Name("CN=$commonName")
        val algorithm = AlgorithmIdentifier(PKCSObjectIdentifiers.sha256WithRSAEncryption, DERNull.INSTANCE)
        val now = System.currentTimeMillis()
        val tbs = V3TBSCertificateGenerator().apply {
            setSerialNumber(ASN1Integer(BigInteger(128, SecureRandom()).setBit(127)))
            setIssuer(name)
            setSubject(name)
            setSignature(algorithm)
            setStartDate(Time(Date(now - 60_000)))
            setEndDate(Time(Date(now + 3 * 86_400_000L)))
            if (address != null) {
                val extensions = ExtensionsGenerator()
                extensions.addExtension(Extension.subjectAlternativeName, false, GeneralNames(GeneralName(GeneralName.iPAddress, address)))
                setExtensions(extensions.generate())
            }
            setSubjectPublicKeyInfo(SubjectPublicKeyInfo.getInstance(pair.public.encoded))
        }.generateTBSCertificate()
        certificate = DERSequence(arrayOf(tbs, algorithm, DERBitString(sign(tbs.encoded, true)))).encoded
        val x509 = CertificateFactory.getInstance("X.509").generateCertificate(certificate.inputStream())
        val password = charArrayOf()
        val store = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
            load(null, null)
            setKeyEntry("receiver", pair.private, password, arrayOf(x509))
        }
        val keys = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(store, password) }
        tls = SSLContext.getInstance("TLS").apply { init(keys.keyManagers, null, null) }
    }

    fun sign(bytes: ByteArray, sha256: Boolean): ByteArray =
        Signature.getInstance(if (sha256) "SHA256withRSA" else "SHA1withRSA").run {
            initSign(pair.private)
            update(bytes)
            sign()
        }
}

/** HTTPS and WSS use the same LAN origin. WebRTC negotiates its own DTLS keys. */
fun projectionTlsContext(address: String): SSLContext = LocalTlsIdentity("Fcboard LAN", address).tls
