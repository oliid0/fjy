package com.fcjy.fcboard;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.BitmapShader;
import android.graphics.ComposeShader;
import android.graphics.Matrix;
import android.graphics.PorterDuff;
import android.graphics.Shader;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import java.util.HashMap;
import java.util.Map;
import java.util.ArrayList;
import java.util.List;

/** Retained, lazily allocated coverage tiles. Stable geometry is rasterized once,
 * while only tiles under the live tip are recomposited. ALPHA_8 preserves a
 * single application of pen opacity/shader even where brush stamps overlap. */
final class NativeInkRaster {
    private static final class Cut {
        final Path path;final int through;
        Cut(Path path,int through){this.path=new Path(path);this.through=through;}
    }
    private final List<Cut> cuts=new ArrayList<>();
    private final Map<String,List<Path>> pendingErasures = new HashMap<>();
    private final Paint clear=new Paint(Paint.ANTI_ALIAS_FLAG);
    private static final int SIZE = 256;
    private static final class Tile {
        final int x, y;
        final Bitmap stable = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ALPHA_8);
        final Canvas canvas = new Canvas(stable);
        final RectF painted = new RectF();
        final RectF previewDamage = new RectF();
        final RectF previousTip = new RectF();
        Bitmap preview, erased;
        Canvas previewCanvas, erasedCanvas;
        Shader erasedMask, erasedColor;
        Shader stableMask, previewMask, stableColor, previewColor, pigment;
        long revision, previewRevision = -1, tipRevision = -1;
        Tile(int x, int y) { this.x = x; this.y = y; canvas.translate(-x, -y); }
        private Shader coverage(Bitmap bitmap) {
            BitmapShader shader = new BitmapShader(bitmap, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
            Matrix position = new Matrix(); position.setTranslate(x, y); shader.setLocalMatrix(position); return shader;
        }
        Shader color(Shader paint, boolean live) {
            if (pigment != paint) { pigment = paint; stableColor = previewColor = erasedColor = null; }
            if (live) {
                if (previewMask == null) previewMask = coverage(preview);
                if (previewColor == null) previewColor = new ComposeShader(paint, previewMask, PorterDuff.Mode.DST_IN);
                return previewColor;
            }
            if (erased != null) {
                if (erasedMask == null) erasedMask = coverage(erased);
                if (erasedColor == null) erasedColor = new ComposeShader(paint, erasedMask, PorterDuff.Mode.DST_IN);
                return erasedColor;
            }
            if (stableMask == null) stableMask = coverage(stable);
            if (stableColor == null) stableColor = new ComposeShader(paint, stableMask, PorterDuff.Mode.DST_IN);
            return stableColor;
        }
    }
    private final Map<Long, Tile> tiles = new HashMap<>();
    private final RectF bounds = new RectF();
    private final Paint mask = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint image = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final int width, height;
    private final RectF paintedBounds = new RectF();
    private final RectF tileBounds = new RectF();
    private final Rect visibleBounds = new Rect();
    NativeInkRaster(int width, int height) {
        this.width = Math.max(1, width); this.height = Math.max(1, height);
        mask.setColor(Color.WHITE);
        clear.setXfermode(new android.graphics.PorterDuffXfermode(PorterDuff.Mode.CLEAR));
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
        commit(path,geometry,Integer.MAX_VALUE);
    }
    void commit(Path path, Paint geometry,int source) {
        if (path.isEmpty()) return;
        RectF area = bounds(path, geometry); style(geometry);
        int left = Math.max(0, (int)Math.floor(area.left / SIZE)), top = Math.max(0, (int)Math.floor(area.top / SIZE));
        int right = Math.min((width - 1) / SIZE, (int)Math.floor(area.right / SIZE)), bottom = Math.min((height - 1) / SIZE, (int)Math.floor(area.bottom / SIZE));
        for (int row = top; row <= bottom; row++) for (int col = left; col <= right; col++) {
            Tile tile = tile(col, row); tile.painted.union(area);
            int saved=tile.canvas.save();clip(tile.canvas,source);tile.canvas.drawPath(path, mask);tile.canvas.restoreToCount(saved);tile.revision++;
            if (tile.preview != null) tile.previewDamage.union(area);
        }
    }
    // A lifted contact never appends geometry again. The worker may read these
    // masks while the display still presents the pending contact.
    Map<Long,Bitmap> finish(Path tip, Paint geometry, int source) {
        commit(tip, geometry, source);
        tip.rewind();
        Map<Long,Bitmap> masks = new HashMap<>();
        for (Map.Entry<Long,Tile> entry : tiles.entrySet()) masks.put(entry.getKey(), entry.getValue().stable);
        return masks;
    }
    void eraseFinished(String gesture, Path cut, RectF area) {
        pendingErasures.computeIfAbsent(gesture, ignored -> new ArrayList<>()).add(cut);
        clearFinished(cut, area);
    }
    private void clearFinished(Path cut, RectF area) {
        int right = Math.min((width-1)/SIZE, (int)Math.floor(area.right/SIZE));
        int bottom = Math.min((height-1)/SIZE, (int)Math.floor(area.bottom/SIZE));
        for (int y=Math.max(0,(int)Math.floor(area.top/SIZE)); y<=bottom; y++) {
            for (int x=Math.max(0,(int)Math.floor(area.left/SIZE)); x<=right; x++) {
                Tile tile = tiles.get(NativeScene.key(x,y));
                if (tile == null || !RectF.intersects(tile.painted, area)) continue;
                if (tile.erased == null) {
                    tile.erased = tile.stable.copy(Bitmap.Config.ALPHA_8,true);
                    tile.erasedCanvas = new Canvas(tile.erased);
                    tile.erasedCanvas.translate(-tile.x,-tile.y);
                }
                tile.erasedCanvas.drawPath(cut,clear);
            }
        }
    }
    void cancelFinishedErase(String gesture) {
        if (pendingErasures.remove(gesture) == null) return;
        for (Tile tile : tiles.values()) {
            tile.erased = null;
            tile.erasedCanvas = null;
            tile.erasedMask = tile.erasedColor = null;
        }
        RectF area = new RectF();
        for (List<Path> paths : pendingErasures.values()) for (Path cut : paths) {
            cut.computeBounds(area,true);
            clearFinished(cut,area);
        }
    }
    void erase(Path path,int through){
        cuts.add(new Cut(path,through));RectF area=new RectF();path.computeBounds(area,true);
        int lastX = Math.min((width - 1) / SIZE, (int)Math.floor(area.right / SIZE));
        int lastY = Math.min((height - 1) / SIZE, (int)Math.floor(area.bottom / SIZE));
        for (int y = Math.max(0, (int)Math.floor(area.top / SIZE)); y <= lastY; y++) {
            for (int x = Math.max(0, (int)Math.floor(area.left / SIZE)); x <= lastX; x++) {
                Tile tile = tiles.get(NativeScene.key(x, y));
                if (tile != null) {
                    if (RectF.intersects(tile.painted, area)) tile.canvas.drawPath(path, clear);
                    // A provisional tip can enter this tile before the stable stroke.
                    tile.revision++;
                    if (tile.preview != null) tile.previewDamage.union(area);
                }
            }
        }
    }
    private void clip(Canvas canvas,int source){
        // Cuts are ordered by the monotonically increasing source sample.
        // Binary search avoids scanning the lifetime of an ongoing contact.
        int low=0,high=cuts.size();
        while(low<high){int mid=(low+high)>>>1;if(cuts.get(mid).through<source)low=mid+1;else high=mid;}
        for(int i=low;i<cuts.size();i++)canvas.clipOutPath(cuts.get(i).path);
    }
    void draw(Canvas target, Paint color, Path tip, long tipRevision) {
        draw(target,color,tip,tipRevision,Integer.MAX_VALUE);
    }
    void draw(Canvas target, Paint color, Path tip, long tipRevision,int source) {
        RectF area = bounds(tip, color); style(color);
        int left = Math.max(0, (int)Math.floor(area.left / SIZE)), top = Math.max(0, (int)Math.floor(area.top / SIZE));
        int right = Math.min((width - 1) / SIZE, (int)Math.floor(area.right / SIZE)), bottom = Math.min((height - 1) / SIZE, (int)Math.floor(area.bottom / SIZE));
        if (!tip.isEmpty()) for (int row = top; row <= bottom; row++) for (int col = left; col <= right; col++) tile(col, row);
        Shader pigment = color.getShader();
        image.setColor(pigment == null ? color.getColor() : Color.WHITE);
        image.setAlpha(color.getAlpha());
        if (!target.getClipBounds(visibleBounds)) return;
        int lastCol = Math.min(width - 1, visibleBounds.right - 1) / SIZE;
        int lastRow = Math.min(height - 1, visibleBounds.bottom - 1) / SIZE;
        for (int row = Math.max(0, visibleBounds.top) / SIZE; row <= lastRow; row++) {
          for (int col = Math.max(0, visibleBounds.left) / SIZE; col <= lastCol; col++) {
            Tile tile = tiles.get(NativeScene.key(col, row));
            if (tile == null) continue;
            boolean live = !tip.isEmpty() && tile.x <= area.right && tile.x + SIZE >= area.left && tile.y <= area.bottom && tile.y + SIZE >= area.top;
            if (live) {
                if (tile.preview == null) {
                    tile.preview = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ALPHA_8);
                    tile.previewCanvas = new Canvas(tile.preview);
                    tile.previewCanvas.translate(-tile.x, -tile.y);
                    tile.previewDamage.set(tile.x, tile.y, tile.x + SIZE, tile.y + SIZE);
                }
                if (tile.previewRevision != tile.revision || tile.tipRevision != tipRevision) {
                    RectF dirty = tile.previewDamage;
                    dirty.union(tile.previousTip);
                    dirty.union(area);
                    Canvas canvas = tile.previewCanvas;
                    int saved = canvas.save();
                    canvas.clipRect((int)Math.floor(dirty.left), (int)Math.floor(dirty.top),
                        (int)Math.ceil(dirty.right), (int)Math.ceil(dirty.bottom));
                    canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR);
                    canvas.drawBitmap(tile.stable, tile.x, tile.y, null);
                    clip(canvas, source);
                    canvas.drawPath(tip, mask);
                    canvas.restoreToCount(saved);
                    dirty.setEmpty();
                    tile.previousTip.set(area);
                    tile.previewRevision = tile.revision; tile.tipRevision = tipRevision;
                }
            } else if (tile.preview != null) {
                // Release a former live-tip copy; stable tiles never change again
                // unless actual new geometry reaches them.
                tile.preview = null; tile.previewCanvas = null; tile.previousTip.setEmpty(); tile.previewMask = tile.previewColor = null; tile.previewRevision = tile.tipRevision = -1;
            }
            // Canvas.drawBitmap ignores a Paint shader for this bitmap route on
            // actual Android. Compose coverage explicitly, without a full-size
            // saveLayer or re-rasterizing the stable vector prefix.
            tileBounds.set(tile.x, tile.y, tile.x + SIZE, tile.y + SIZE);
            paintedBounds.set(tile.painted);
            if (live) paintedBounds.union(area);
            if (!paintedBounds.intersect(tileBounds) || target.quickReject(paintedBounds, Canvas.EdgeType.AA)) continue;
            int scope = target.save();
            target.clipRect(paintedBounds);
            if (pigment == null) {
                image.setShader(null);
                Bitmap coverage = live ? tile.preview : tile.erased != null ? tile.erased : tile.stable;
                target.drawBitmap(coverage, null, tileBounds, image);
            } else {
                image.setShader(tile.color(pigment, live));
                target.drawRect(paintedBounds, image);
            }
            target.restoreToCount(scope);
          }
        }
    }
}
