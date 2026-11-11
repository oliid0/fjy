package com.fcjy.fcboard;

import android.graphics.Bitmap;
import android.graphics.Canvas;
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
        long revision, previewRevision = -1, tipRevision = -1;
        Tile(int x, int y) { this.x = x; this.y = y; canvas.translate(-x, -y); }
    }
    private final Map<Long, Tile> tiles = new HashMap<>();
    private final RectF bounds = new RectF();
    private final Paint mask = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint image = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final int width, height;
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
        image.setColor(color.getColor()); image.setAlpha(color.getAlpha()); image.setShader(color.getShader());
        for (Tile tile : tiles.values()) {
            boolean live = !tip.isEmpty() && tile.x <= area.right && tile.x + SIZE >= area.left && tile.y <= area.bottom && tile.y + SIZE >= area.top;
            Bitmap pixels = tile.stable;
            if (live) {
                if (tile.preview == null) tile.preview = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ALPHA_8);
                if (tile.previewRevision != tile.revision || tile.tipRevision != tipRevision) {
                    tile.preview.eraseColor(Color.TRANSPARENT);
                    Canvas canvas = new Canvas(tile.preview); canvas.drawBitmap(tile.stable, 0, 0, null);
                    canvas.translate(-tile.x, -tile.y); canvas.drawPath(tip, mask);
                    tile.previewRevision = tile.revision; tile.tipRevision = tipRevision;
                }
                pixels = tile.preview;
            } else if (tile.preview != null) {
                // Release a former live-tip copy; stable tiles never change again
                // unless actual new geometry reaches them.
                tile.preview = null; tile.previewRevision = tile.tipRevision = -1;
            }
            target.drawBitmap(pixels, tile.x, tile.y, image);
        }
    }
}
