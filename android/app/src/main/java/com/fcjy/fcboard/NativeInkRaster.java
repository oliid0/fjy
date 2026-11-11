package com.fcjy.fcboard;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.BitmapShader;
import android.graphics.ComposeShader;
import android.graphics.LinearGradient;
import android.graphics.Matrix;
import android.graphics.PorterDuff;
import android.graphics.Shader;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import java.util.HashMap;
import java.util.Map;

/** Retained, lazily allocated coverage tiles. Stable geometry is rasterized once,
 * while only tiles under the live tip are recomposited. ALPHA_8 preserves a
 * single application of pen opacity/shader even where brush stamps overlap. */
final class NativeInkRaster {
    private static final int SIZE = 256;
    private static final class Tile {
        final int x, y;
        final Bitmap stable = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ALPHA_8);
        final Canvas canvas = new Canvas(stable);
        Bitmap preview;
        Shader stableMask, previewMask, stableColor, previewColor, pigment;
        long revision, previewRevision = -1, tipRevision = -1;
        Tile(int x, int y) { this.x = x; this.y = y; canvas.translate(-x, -y); stableMask = coverage(stable); }
        private Shader coverage(Bitmap bitmap) {
            BitmapShader shader = new BitmapShader(bitmap, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
            Matrix position = new Matrix(); position.setTranslate(x, y); shader.setLocalMatrix(position); return shader;
        }
        Shader color(Shader paint, boolean live) {
            if (pigment != paint) { pigment = paint; stableColor = previewColor = null; }
            if (live) {
                if (previewMask == null) previewMask = coverage(preview);
                if (previewColor == null) previewColor = new ComposeShader(paint, previewMask, PorterDuff.Mode.DST_IN);
                return previewColor;
            }
            if (stableColor == null) stableColor = new ComposeShader(paint, stableMask, PorterDuff.Mode.DST_IN);
            return stableColor;
        }
    }
    private final Map<Long, Tile> tiles = new HashMap<>();
    private final RectF bounds = new RectF();
    private final Paint mask = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint image = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final int width, height;
    private Shader solid;
    private int solidColor;
    NativeInkRaster(int width, int height) {
        this.width = Math.max(1, width); this.height = Math.max(1, height);
        mask.setColor(Color.WHITE);
    }
    private RectF bounds(Path path, Paint geometry) {
        path.computeBounds(bounds, true);
        float pad = 2 + (geometry.getStyle() == Paint.Style.FILL ? 0 : geometry.getStrokeWidth() / 2);
        bounds.inset(-pad, -pad); return bounds;
    }
    private void style(Paint geometry) {
        mask.setStyle(geometry.getStyle()); mask.setStrokeWidth(geometry.getStrokeWidth());
        mask.setStrokeCap(geometry.getStrokeCap()); mask.setStrokeJoin(geometry.getStrokeJoin()); mask.setPathEffect(geometry.getPathEffect());
    }
    private Tile tile(int col, int row) {
        long key = ((long)col << 32) | (row & 0xffffffffL);
        Tile tile = tiles.get(key);
        if (tile == null) { tile = new Tile(col * SIZE, row * SIZE); tiles.put(key, tile); }
        return tile;
    }
    void commit(Path path, Paint geometry) {
        if (path.isEmpty()) return;
        RectF area = bounds(path, geometry); style(geometry);
        int left = Math.max(0, (int)Math.floor(area.left / SIZE)), top = Math.max(0, (int)Math.floor(area.top / SIZE));
        int right = Math.min((width - 1) / SIZE, (int)Math.floor(area.right / SIZE)), bottom = Math.min((height - 1) / SIZE, (int)Math.floor(area.bottom / SIZE));
        for (int row = top; row <= bottom; row++) for (int col = left; col <= right; col++) {
            Tile tile = tile(col, row); tile.canvas.drawPath(path, mask); tile.revision++;
        }
    }
    void draw(Canvas target, Paint color, Path tip, long tipRevision) {
        RectF area = bounds(tip, color); style(color);
        int left = Math.max(0, (int)Math.floor(area.left / SIZE)), top = Math.max(0, (int)Math.floor(area.top / SIZE));
        int right = Math.min((width - 1) / SIZE, (int)Math.floor(area.right / SIZE)), bottom = Math.min((height - 1) / SIZE, (int)Math.floor(area.bottom / SIZE));
        if (!tip.isEmpty()) for (int row = top; row <= bottom; row++) for (int col = left; col <= right; col++) tile(col, row);
        Shader pigment = color.getShader();
        if (pigment == null) {
            int opaque = color.getColor() | 0xff000000;
            if (solid == null || solidColor != opaque) { solidColor = opaque; solid = new LinearGradient(0, 0, 1, 0, opaque, opaque, Shader.TileMode.CLAMP); }
            pigment = solid;
        }
        image.setColor(Color.WHITE); image.setAlpha(color.getAlpha());
        for (Tile tile : tiles.values()) {
            boolean live = !tip.isEmpty() && tile.x <= area.right && tile.x + SIZE >= area.left && tile.y <= area.bottom && tile.y + SIZE >= area.top;
            if (live) {
                if (tile.preview == null) tile.preview = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ALPHA_8);
                if (tile.previewRevision != tile.revision || tile.tipRevision != tipRevision) {
                    tile.preview.eraseColor(Color.TRANSPARENT);
                    Canvas canvas = new Canvas(tile.preview); canvas.drawBitmap(tile.stable, 0, 0, null);
                    canvas.translate(-tile.x, -tile.y); canvas.drawPath(tip, mask);
                    tile.previewRevision = tile.revision; tile.tipRevision = tipRevision;
                }
            } else if (tile.preview != null) {
                // Release a former live-tip copy; stable tiles never change again
                // unless actual new geometry reaches them.
                tile.preview = null; tile.previewMask = tile.previewColor = null; tile.previewRevision = tile.tipRevision = -1;
            }
            // Canvas.drawBitmap ignores a Paint shader for this bitmap route on
            // actual Android. Compose coverage explicitly, without a full-size
            // saveLayer or re-rasterizing the stable vector prefix.
            image.setShader(tile.color(pigment, live));
            target.drawRect(tile.x, tile.y, tile.x + SIZE, tile.y + SIZE, image);
        }
    }
}
