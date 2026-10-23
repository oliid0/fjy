package com.fcjy.fcboard;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Iterator;

/** HWhiteBoard RecognitionModelBootstrapper, pinned to the same ML Kit 18.1.0.
 * Install through SharedPreferences before creating a recognizer, so the SDK
 * reads its own package's MDD registry. Never import the vendor's SDK identity.
 */
final class DigitalInkModels {
    private static boolean ready;

    static synchronized void install(Context context) throws Exception {
        if (ready) { return; }
        JSONObject manifest;
        try (InputStream input = context.getAssets().open("digital-ink/manifest.json")) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) { bytes.write(buffer, 0, count); }
            manifest = new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
        }
        if (!context.getPackageName().equals(manifest.getString("package")) || !"18.1.0".equals(manifest.getString("sdk"))) {
            throw new IllegalStateException("Digital Ink model registry does not match this application");
        }
        JSONArray files = manifest.getJSONArray("files");
        for (int index = 0; index < files.length(); index++) {
            JSONObject item = files.getJSONObject(index);
            String path = item.getString("path");
            File output = new File(context.getFilesDir(), path);
            if (!output.getCanonicalPath().startsWith(context.getFilesDir().getCanonicalPath() + File.separator)) {
                throw new IllegalArgumentException("Invalid Digital Ink model path");
            }
            if (valid(output, item)) { continue; }
            File parent = output.getParentFile();
            if (!parent.isDirectory() && !parent.mkdirs()) { throw new IllegalStateException("Cannot create model directory"); }
            File pending = new File(output.getPath() + ".pending");
            try (InputStream input = context.getAssets().open("digital-ink/" + path);
                 FileOutputStream target = new FileOutputStream(pending)) {
                byte[] buffer = new byte[65536];
                int count;
                while ((count = input.read(buffer)) != -1) { target.write(buffer, 0, count); }
                target.getFD().sync();
            }
            if (!valid(pending, item) || !pending.renameTo(output)) {
                pending.delete();
                throw new IllegalStateException("Offline handwriting model is incomplete: " + output.getName());
            }
        }
        // The original archive's registry is package-scoped (zzfx/zzwa/zzwe).
        // Only model metadata is seeded, once; preserve later SDK state.
        SharedPreferences seed = context.getSharedPreferences("fcboard-digital-ink", 0);
        if (seed.getInt("version", 0) != 1) {
            JSONObject preferences = manifest.getJSONObject("preferences");
            Iterator<String> names = preferences.keys();
            while (names.hasNext()) {
                String name = names.next();
                SharedPreferences.Editor edit = context.getSharedPreferences(name, 0).edit();
                JSONObject values = preferences.getJSONObject(name);
                Iterator<String> keys = values.keys();
                while (keys.hasNext()) { String key = keys.next(); edit.putString(key, values.getString(key)); }
                if (!edit.commit()) { throw new IllegalStateException("Cannot register offline handwriting models"); }
            }
            if (!context.getSharedPreferences("gms_icing_mdd_manager_metadatamlkit_digital_ink_recognition", 0)
                    .edit().putBoolean("mdd_migrated_to_offroad", true).commit()
                || !context.getSharedPreferences("gms_icing_mdd_migrations", 0)
                    .edit().putBoolean("migrated_to_new_file_key", true).putInt("mdd_file_key_version", 2).commit()
                || !seed.edit().putInt("version", 1).commit()) {
                throw new IllegalStateException("Cannot save handwriting model registration");
            }
        }
        ready = true;
    }

    private static boolean valid(File file, JSONObject item) throws Exception {
        if (!file.isFile() || file.length() != item.getLong("size")) { return false; }
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new java.io.FileInputStream(file)) {
            byte[] buffer = new byte[65536]; int count;
            while ((count = input.read(buffer)) != -1) { digest.update(buffer, 0, count); }
        }
        StringBuilder hash = new StringBuilder();
        for (byte value : digest.digest()) { hash.append(String.format(java.util.Locale.ROOT, "%02x", value & 255)); }
        return hash.toString().equals(item.getString("sha256"));
    }
}
