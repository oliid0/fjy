package com.fcjy.fcboard;

import android.graphics.*;
import java.util.*;
import java.util.function.Consumer;

/** Split-pane raster history uses the same256px tile size as the canonical
 * scene. Pointer erasure modifies only hit tiles; snapshots are only for
 * entering/resizing/undo, never for MOVE or completed-stroke display. */
final class NativeSplitInk {
    private final Map<Long,Bitmap> tiles=new HashMap<>();
    private final Map<String,Map<Long,Bitmap>> backups=new HashMap<>();
    private final Paint image=new Paint(Paint.FILTER_BITMAP_FLAG),clear=new Paint(Paint.ANTI_ALIAS_FLAG);
    private int width,height;
    NativeSplitInk(){clear.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.CLEAR));}
    private Canvas canvas(Bitmap bitmap,long key){Canvas canvas=new Canvas(bitmap);canvas.translate(-(int)(key>>32)*NativeScene.SIZE,-(int)key*NativeScene.SIZE);return canvas;}
    private Set<Long> cells(RectF bounds){
        Set<Long> keys=new HashSet<>();int size=NativeScene.SIZE;
        int left=Math.max(0,(int)Math.floor(bounds.left/size)),right=Math.min((width-1)/size,(int)Math.floor(bounds.right/size));
        int top=Math.max(0,(int)Math.floor(bounds.top/size)),bottom=Math.min((height-1)/size,(int)Math.floor(bounds.bottom/size));
        for(int y=top;y<=bottom;y++)for(int x=left;x<=right;x++)keys.add(NativeScene.key(x,y));return keys;
    }
    void restore(Bitmap snapshot,int width,int height){
        tiles.clear();backups.clear();this.width=width;this.height=height;
        RectF viewport=new RectF(0,0,width,height);
        for(long key:cells(viewport)){
            Bitmap tile=Bitmap.createBitmap(NativeScene.SIZE,NativeScene.SIZE,Bitmap.Config.ARGB_8888);
            canvas(tile,key).drawBitmap(snapshot,null,viewport,image);tiles.put(key,tile);
        }
    }
    void size(int width,int height){this.width=width;this.height=height;}
    void commit(RectF bounds,Consumer<Canvas> draw){
        for(long key:cells(bounds)){
            Bitmap tile=tiles.computeIfAbsent(key,k->Bitmap.createBitmap(NativeScene.SIZE,NativeScene.SIZE,Bitmap.Config.ARGB_8888));draw.accept(canvas(tile,key));
            // Cancelling a simultaneous eraser must retain a newly completed pen.
            for(Map<Long,Bitmap> saved:backups.values()){Bitmap before=saved.get(key);if(before!=null)draw.accept(canvas(before,key));}
        }
    }
    void erase(String gesture,Path path){
        Map<Long,Bitmap> saved=backups.computeIfAbsent(gesture,k->new HashMap<>());RectF bounds=new RectF();path.computeBounds(bounds,true);
        for(long key:cells(bounds)){Bitmap tile=tiles.get(key);if(tile==null)continue;saved.computeIfAbsent(key,k->tile.copy(Bitmap.Config.ARGB_8888,true));canvas(tile,key).drawPath(path,clear);}
    }
    void finish(String gesture){backups.remove(gesture);}
    void cancel(String gesture){Map<Long,Bitmap> saved=backups.remove(gesture);if(saved!=null)tiles.putAll(saved);}
    void draw(Canvas canvas){for(Map.Entry<Long,Bitmap> tile:tiles.entrySet()){long key=tile.getKey();canvas.drawBitmap(tile.getValue(),(int)(key>>32)*NativeScene.SIZE,(int)key*NativeScene.SIZE,null);}}
}
