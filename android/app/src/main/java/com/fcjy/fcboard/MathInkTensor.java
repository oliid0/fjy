package com.fcjy.fcboard;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import java.nio.ByteBuffer;
import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.List;

/** Native rasterization of ink-on's CROHME preprocessing (Apache-2.0,
 * kimseungdae, pinned in scripts/local-models.json). Modified for Android Canvas;
 * preserves the original 256px height, 128px content height, 64px alignment,
 * top-left placement and boolean padding mask. Dots are explicitly rendered. */
final class MathInkTensor {
    final int width, height = 256;
    final FloatBuffer pixels;
    final ByteBuffer mask;
    MathInkTensor(float[] input, int[] lengths) {
        if (input == null || lengths == null || input.length < 2 || input.length > 24000) throw new IllegalArgumentException("Invalid math ink");
        float left = Float.POSITIVE_INFINITY, top = left, right = -left, bottom = -left;
        int count = 0;
        for (int length : lengths) { if (length < 0) throw new IllegalArgumentException("Invalid stroke length"); count += length; }
        if (count * 2 != input.length) throw new IllegalArgumentException("Math point count mismatch");
        for (int i = 0; i < input.length; i += 2) {
            if (!Float.isFinite(input[i]) || !Float.isFinite(input[i + 1])) throw new IllegalArgumentException("Invalid math coordinate");
            left = Math.min(left, input[i]); right = Math.max(right, input[i]);
            top = Math.min(top, input[i + 1]); bottom = Math.max(bottom, input[i + 1]);
        }
        float scale = 480f / Math.max(1, Math.max(right - left, bottom - top));
        int rawW = Math.max(1, (int)Math.ceil((right - left) * scale)) + 32;
        int rawH = Math.max(1, (int)Math.ceil((bottom - top) * scale)) + 32;
        Bitmap raw = Bitmap.createBitmap(rawW, rawH, Bitmap.Config.ARGB_8888);
        Bitmap target = null;
        try {
            Canvas canvas = new Canvas(raw); canvas.drawColor(Color.BLACK);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setColor(Color.WHITE); paint.setStrokeWidth(3); paint.setStrokeCap(Paint.Cap.ROUND); paint.setStrokeJoin(Paint.Join.ROUND);
            int offset = 0;
            for (int length : lengths) {
                if (length == 0) continue;
                List<float[]> points = new ArrayList<>();
                float x = (input[offset] - left) * scale + 16, y = (input[offset + 1] - top) * scale + 16;
                points.add(new float[]{x, y}); float remaining = 3;
                for (int j = 1; j < length; j++) {
                    float nx = (input[offset + j * 2] - left) * scale + 16, ny = (input[offset + j * 2 + 1] - top) * scale + 16;
                    float dx = nx - x, dy = ny - y, distance = (float)Math.hypot(dx, dy);
                    if (distance <= remaining) remaining -= distance;
                    else {
                        float covered = remaining;
                        for (; covered <= distance; covered += 3) points.add(new float[]{x + dx * covered / distance, y + dy * covered / distance});
                        remaining = covered - distance;
                    }
                    x = nx; y = ny;
                }
                points.add(new float[]{x, y}); offset += length * 2;
                if (points.size() == 2 && points.get(0)[0] == x && points.get(0)[1] == y) canvas.drawPoint(x, y, paint);
                else {
                    Path path = new Path(); path.moveTo(points.get(0)[0], points.get(0)[1]);
                    for (int i = 1; i < points.size() - 1; i++) {
                        float[] a = points.get(i), b = points.get(i + 1);
                        path.quadTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
                    }
                    path.lineTo(x, y); paint.setStyle(Paint.Style.STROKE); canvas.drawPath(path, paint);
                }
            }
            float fit = Math.min(128f / rawH, 1024f / rawW);
            int contentW = Math.max(1, Math.round(rawW * fit)), contentH = Math.max(1, Math.round(rawH * fit));
            width = Math.min(1024, Math.max(128, ((contentW + 16 + 63) / 64) * 64));
            target = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            Canvas destination = new Canvas(target); destination.drawColor(Color.BLACK);
            paint.setFilterBitmap(true); destination.drawBitmap(raw, null, new Rect(0, 0, contentW, contentH), paint);
            int[] rgba = new int[width * height]; target.getPixels(rgba, 0, width, 0, 0, width, height);
            pixels = FloatBuffer.allocate(rgba.length); mask = ByteBuffer.allocateDirect(rgba.length);
            for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) {
                int color = rgba[y * width + x];
                pixels.put((Color.red(color) * .299f + Color.green(color) * .587f + Color.blue(color) * .114f) / 255);
                mask.put((byte)(y < contentH && x < contentW ? 0 : 1));
            }
            pixels.flip(); mask.flip();
        } finally { raw.recycle(); if (target != null) target.recycle(); }
    }
}
