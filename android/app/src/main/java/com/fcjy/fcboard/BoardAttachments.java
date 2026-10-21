package com.fcjy.fcboard;

import android.content.Context;
import android.content.Intent;
import android.util.Base64;
import com.getcapacitor.JSArray;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.UUID;

/** FileProvider attachments follow Capacitor SharePlugin's read-grant and ClipData flow. */
final class BoardAttachments {
    private BoardAttachments() {}

    static Intent create(Context context, JSArray pages) throws Exception {
        if (pages == null || pages.length() < 1 || pages.length() > 20) throw new IOException("请选择 1 至 20 页分享");
        File root = new File(context.getCacheDir(), "board-attachments");
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("无法准备分享附件");
        File[] old = root.listFiles();
        if (old != null) for (File file : old) {
            if (file.isFile() && System.currentTimeMillis() - file.lastModified() > 86400000) file.delete();
        }
        ArrayList<android.net.Uri> attachments = new ArrayList<>();
        String id = UUID.randomUUID().toString();
        int total = 0;
        for (int index = 0; index < pages.length(); index++) {
            String value = pages.getString(index);
            if (!value.startsWith("data:image/png;base64,") || value.length() > 14000000) throw new IOException("分享页面格式或大小无效");
            byte[] image = Base64.decode(value.substring(22), Base64.DEFAULT);
            total += image.length;
            if (total > 20000000) throw new IOException("分享图片总大小超过 20 MB，请减少页数");
            if (image.length < 8 || image[0] != (byte)137 || image[1] != 80 || image[2] != 78 || image[3] != 71) throw new IOException("分享页面必须是 PNG 图片");
            File file = new File(root, id + "-" + (index + 1) + ".png");
            try (FileOutputStream output = new FileOutputStream(file)) { output.write(image); }
            attachments.add(androidx.core.content.FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file));
        }
        android.content.Intent intent = new android.content.Intent(attachments.size() == 1
            ? android.content.Intent.ACTION_SEND : android.content.Intent.ACTION_SEND_MULTIPLE);
        intent.setType("image/png");
        intent.putExtra(android.content.Intent.EXTRA_SUBJECT, "Fcboard 白板");
        if (attachments.size() == 1) intent.putExtra(android.content.Intent.EXTRA_STREAM, attachments.get(0));
        else intent.putParcelableArrayListExtra(android.content.Intent.EXTRA_STREAM, attachments);
        android.content.ClipData clip = android.content.ClipData.newRawUri("Fcboard 白板", attachments.get(0));
        for (int index = 1; index < attachments.size(); index++) clip.addItem(new android.content.ClipData.Item(attachments.get(index)));
        intent.setClipData(clip);
        intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return intent;
    }
}
