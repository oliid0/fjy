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

    /** PDF raster quality is bounded before decoding; the original PNG attachments stay intact. */
    static final class PdfPageSpec {
        static final long TOTAL_PIXELS = 12000000L;
        final int width;
        final int height;
        final int sampleSize;
        final int pageWidth;
        final int pageHeight;

        PdfPageSpec(int sourceWidth, int sourceHeight, int pageCount) throws IOException {
            if (sourceWidth < 1 || sourceHeight < 1 || sourceWidth > 4096 || sourceHeight > 4096
                || pageCount < 1 || pageCount > 20) throw new IOException("Invalid page image dimensions");
            pageWidth = Math.min(1440, sourceWidth);
            pageHeight = Math.max(1, (int) Math.round((double) pageWidth * sourceHeight / sourceWidth));
            double scale = Math.min(1, Math.min(1440.0 / Math.max(sourceWidth, sourceHeight),
                Math.sqrt((double) (TOTAL_PIXELS / pageCount) / ((long) sourceWidth * sourceHeight))));
            width = Math.max(1, (int) Math.floor(sourceWidth * scale));
            height = Math.max(1, (int) Math.floor(sourceHeight * scale));
            int sample = 1;
            while (sourceWidth / (sample * 2) >= width && sourceHeight / (sample * 2) >= height) sample *= 2;
            sampleSize = sample;
        }
    }

    static Intent create(Context context, JSArray pages) throws Exception {
        return create(context, pages, "png");
    }

    static Intent create(Context context, JSArray pages, String format) throws Exception {
        return create(context, pages, format, null);
    }

    /** Active NewEmailPopu calls savePdf: reuse the factory A4/title/image flow. */
    static Intent createMail(Context context, JSArray pages, String format, String title) throws Exception {
        return create(context, pages, format, title);
    }

    private static Intent create(Context context, JSArray pages, String format, String title) throws Exception {
        if (pages == null || pages.length() < 1 || pages.length() > 20) throw new IOException("请选择 1 至 20 页分享");
        if (!"png".equals(format) && !"pdf".equals(format)) throw new IOException("Unsupported board export format");
        File root = new File(context.getCacheDir(), "board-attachments");
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("无法准备分享附件");
        File[] old = root.listFiles();
        if (old != null) for (File file : old) {
            if (file.isFile() && System.currentTimeMillis() - file.lastModified() > 86400000) file.delete();
        }
        ArrayList<android.net.Uri> attachments = new ArrayList<>();
        ArrayList<File> images = new ArrayList<>();
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
            images.add(file);
            attachments.add(androidx.core.content.FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file));
        }
        if ("pdf".equals(format) && title != null) {
            File file = new File(root, id + ".pdf");
            FactoryPageExport.writePdf(images, file, title);
            attachments.clear();
            attachments.add(androidx.core.content.FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file));
        } else if ("pdf".equals(format)) {
            File file = new File(root, id + ".pdf");
            android.graphics.pdf.PdfDocument pdf = new android.graphics.pdf.PdfDocument();
            try {
                for (int index = 0; index < pages.length(); index++) {
                    File image = new File(root, id + "-" + (index + 1) + ".png");
                    android.graphics.BitmapFactory.Options options = new android.graphics.BitmapFactory.Options();
                    options.inJustDecodeBounds = true;
                    android.graphics.BitmapFactory.decodeFile(image.getAbsolutePath(), options);
                    PdfPageSpec spec = new PdfPageSpec(options.outWidth, options.outHeight, pages.length());
                    options.inJustDecodeBounds = false;
                    options.inSampleSize = spec.sampleSize;
                    options.inPreferredConfig = android.graphics.Bitmap.Config.ARGB_8888;
                    android.graphics.Bitmap bitmap = android.graphics.BitmapFactory.decodeFile(image.getAbsolutePath(), options);
                    if (bitmap == null) throw new IOException("Could not read page image");
                    try {
                        if (bitmap.getWidth() != spec.width || bitmap.getHeight() != spec.height) {
                            android.graphics.Bitmap scaled = android.graphics.Bitmap.createScaledBitmap(bitmap, spec.width, spec.height, true);
                            bitmap.recycle();
                            bitmap = scaled;
                        }
                        android.graphics.pdf.PdfDocument.Page page = pdf.startPage(
                            new android.graphics.pdf.PdfDocument.PageInfo.Builder(spec.pageWidth, spec.pageHeight, index + 1).create());
                        try {
                            page.getCanvas().drawBitmap(bitmap, null, new android.graphics.Rect(0, 0, spec.pageWidth, spec.pageHeight), null);
                        } finally { pdf.finishPage(page); }
                    } finally { bitmap.recycle(); }
                }
                try (FileOutputStream output = new FileOutputStream(file)) { pdf.writeTo(output); }
            } finally { pdf.close(); }
            attachments.clear();
            attachments.add(androidx.core.content.FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file));
        }
        android.content.Intent intent = new android.content.Intent(attachments.size() == 1
            ? android.content.Intent.ACTION_SEND : android.content.Intent.ACTION_SEND_MULTIPLE);
        intent.setType("pdf".equals(format) ? "application/pdf" : "image/png");
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
