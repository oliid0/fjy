package com.fcjy.fcboard;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Seal the board's TLS configuration with an install-specific, non-exportable Keystore key. */
final class ProjectionIdentity {
    private static final String ALIAS = "fcboard-projection-tls";
    private final SharedPreferences prefs;

    ProjectionIdentity(Context context) { prefs = context.getSharedPreferences(ALIAS, Context.MODE_PRIVATE); }

    private SecretKey key(boolean create) throws Exception {
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
        keys.load(null);
        SecretKey existing = (SecretKey) keys.getKey(ALIAS, null);
        if (existing != null) return existing;
        if (!create) throw new IOException("Stored TLS key is unavailable");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }

    JSONObject load() throws Exception {
        String value = prefs.getString("sealed", null);
        if (value == null) return null;
        String[] parts = value.split(":", 2);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        byte[] plaintext = cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP));
        try { return new JSONObject(new String(plaintext, StandardCharsets.UTF_8)); }
        finally { Arrays.fill(plaintext, (byte) 0); }
    }

    void save(JSONObject identity) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(true));
        byte[] plaintext = identity.toString().getBytes(StandardCharsets.UTF_8);
        try {
            String sealed = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" +
                Base64.encodeToString(cipher.doFinal(plaintext), Base64.NO_WRAP);
            if (!prefs.edit().putString("sealed", sealed).commit()) throw new IOException("Cannot save TLS identity");
        } finally { Arrays.fill(plaintext, (byte) 0); }
    }
}
