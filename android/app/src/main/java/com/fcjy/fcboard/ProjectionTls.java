package com.fcjy.fcboard;

import android.content.Context;
import android.content.RestrictionsManager;
import android.os.Bundle;
import android.security.KeyChain;
import java.io.IOException;
import java.net.Socket;
import java.security.Principal;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.Collection;
import java.util.List;
import javax.net.ssl.KeyManager;
import javax.net.ssl.SSLContext;
import javax.net.ssl.X509KeyManager;

final class ProjectionTls implements X509KeyManager {
    final String host;
    private final String alias;
    private final PrivateKey key;
    private final X509Certificate[] chain;

    ProjectionTls(Context context) throws Exception {
        RestrictionsManager manager = context.getSystemService(RestrictionsManager.class);
        Bundle config = manager == null ? Bundle.EMPTY : manager.getApplicationRestrictions();
        host = config.getString("projection_tls_host", "").trim().toLowerCase(java.util.Locale.ROOT);
        alias = config.getString("projection_tls_key_alias", "").trim();
        if (alias.isEmpty() || host.length() > 253 || !host.matches("[a-zA-Z0-9][a-zA-Z0-9.-]*")) {
            throw new IOException("Managed projection TLS identity is not provisioned");
        }
        Context app = context.getApplicationContext();
        key = KeyChain.getPrivateKey(app, alias);
        chain = KeyChain.getCertificateChain(app, alias);
        if (key == null || chain == null || chain.length == 0 || !matchesHost(chain[0], host)) {
            throw new IOException("Managed projection certificate is unavailable or does not cover the host");
        }
        for (X509Certificate certificate : chain) certificate.checkValidity();
    }

    SSLContext context() throws Exception {
        SSLContext tls = SSLContext.getInstance("TLS");
        tls.init(new KeyManager[] { this }, null, null);
        return tls;
    }

    private static boolean matchesHost(X509Certificate certificate, String host) throws Exception {
        Collection<List<?>> names = certificate.getSubjectAlternativeNames();
        if (names == null) return false;
        boolean ip = host.matches("[0-9.]+");
        for (List<?> entry : names) {
            if (entry.size() < 2 || !Integer.valueOf(ip ? 7 : 2).equals(entry.get(0)) ||
                !(entry.get(1) instanceof String)) continue;
            String name = (String) entry.get(1);
            if (host.equalsIgnoreCase(name)) return true;
            int dot = host.indexOf('.');
            if (!ip && dot > 0 && name.startsWith("*.") && name.indexOf('.', 2) > 2 &&
                host.substring(dot + 1).equalsIgnoreCase(name.substring(2))) return true;
        }
        return false;
    }

    @Override public String chooseServerAlias(String type, Principal[] issuers, Socket socket) {
        return chain[0].getPublicKey().getAlgorithm().equals(type) ? alias : null;
    }

    @Override public String[] getServerAliases(String type, Principal[] issuers) {
        return chooseServerAlias(type, issuers, null) != null ? new String[] { alias } : null;
    }

    @Override public X509Certificate[] getCertificateChain(String selected) {
        return alias.equals(selected) ? chain.clone() : null;
    }

    @Override public PrivateKey getPrivateKey(String selected) { return alias.equals(selected) ? key : null; }
    @Override public String[] getClientAliases(String type, Principal[] issuers) { return null; }
    @Override public String chooseClientAlias(String[] types, Principal[] issuers, Socket socket) { return null; }
}
