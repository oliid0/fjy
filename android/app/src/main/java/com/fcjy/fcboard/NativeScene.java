package com.fcjy.fcboard;

import android.content.Context;
import android.graphics.*;
import android.view.View;
import androidx.core.graphics.PathParser;
import java.util.*;
import org.json.*;

/** Worker-owned canonical scene. Only changed spatial buckets are rasterized;
 * the UI receives retained tiles, never a full board image per erase sample. */
final class NativeScene {
    static final int SIZE = 256;
    static long key(int x,int y) { return ((long)x<<32)|(y&0xffffffffL); }
    static final class Part {
        final Bitmap pixels = Bitmap.createBitmap(SIZE,SIZE,Bitmap.Config.ARGB_8888);
        final boolean ink;
        final long through;
        Part(boolean ink,long through) { this.ink=ink; this.through=through; }
    }
    static final class Tile {
        final int x,y;
        final List<Part> parts=new ArrayList<>();
        final Bitmap pixels=Bitmap.createBitmap(SIZE,SIZE,Bitmap.Config.ARGB_8888);
        Tile(int x,int y) { this.x=x;this.y=y; }
        void compose() {
            pixels.eraseColor(Color.TRANSPARENT); Canvas canvas=new Canvas(pixels);
            for(Part part:parts) canvas.drawBitmap(part.pixels,0,0,null);
        }
    }
    static final class Frame {
        final Map<Long,Tile> tiles=new HashMap<>();
        final Set<String> upserts=new HashSet<>(),removed=new HashSet<>();
        boolean reset;
        Bitmap background;
        boolean backgroundChanged;
        long eraseThrough;
    }
    private static final class Node {
        String id,order;
        boolean ink;
        long through;
        RectF bounds;
        Path path,nib,clip;
        Matrix transform;
        Paint geometry;
        Shader pigment;
        int alpha;
        Bitmap image;
        final List<Long> cells=new ArrayList<>();
        Node(JSONObject value,long received) throws JSONException {
            id=value.getString("id"); order=value.getString("order"); ink=value.getBoolean("ink");
            through=value.optLong("through",-1);if(through<0) through=received;
            JSONArray box=value.getJSONArray("bounds");bounds=new RectF(number(box,0),number(box,1),number(box,2),number(box,3));
            if(id.isEmpty()||!Float.isFinite(bounds.left+bounds.top+bounds.right+bounds.bottom)) throw new IllegalArgumentException("Invalid native scene bounds");
            if(value.has("bitmap")) { image=bitmap(value.getString("bitmap")); return; }
            String svg=value.getString("path"); path=PathParser.createPathFromPathData(svg);
            if(path==null) throw new IllegalArgumentException("Invalid native stroke path");
            JSONArray at=value.getJSONArray("transform"); transform=new Matrix();
            transform.setTranslate(-number(at,2),-number(at,3));transform.postRotate((float)Math.toDegrees(number(at,4)));transform.postTranslate(number(at,0),number(at,1));
            path.transform(transform);
            String end=value.optString("nib","");
            if(!end.isEmpty()) { nib=PathParser.createPathFromPathData(end);if(nib==null)throw new IllegalArgumentException("Invalid nib path");nib.transform(transform); }
            JSONArray frame=value.optJSONArray("clip");
            if(frame!=null) { clip=new Path();float x=number(frame,0),y=number(frame,1);clip.addRoundRect(new RectF(x,y,x+number(frame,2),y+number(frame,3)),number(frame,4),number(frame,4),Path.Direction.CW); }
            int color=Color.parseColor(value.getString("color"));double opacity=value.getDouble("opacity");
            if(!Double.isFinite(opacity)||opacity<0||opacity>1)throw new IllegalArgumentException("Invalid native stroke opacity");
            alpha=Math.round((float)opacity*Color.alpha(color));
            geometry=new Paint(Paint.ANTI_ALIAS_FLAG);geometry.setColor(Color.WHITE);geometry.setStrokeCap(Paint.Cap.ROUND);geometry.setStrokeJoin(Paint.Join.ROUND);
            float width=(float)value.optDouble("strokeWidth",0);
            geometry.setStyle(width>0?Paint.Style.STROKE:Paint.Style.FILL);geometry.setStrokeWidth(width);
            RectF rendered=new RectF();path.computeBounds(rendered,true);
            if(width>0)rendered.inset(-width/2,-width/2);
            if(nib!=null){RectF endBounds=new RectF();nib.computeBounds(endBounds,true);rendered.union(endBounds);}
            bounds.union(rendered);
            JSONArray dash=value.optJSONArray("dashes");
            if(dash!=null) { float[] values=new float[dash.length()];for(int i=0;i<values.length;i++)values[i]=number(dash,i);geometry.setPathEffect(new DashPathEffect(values,(float)value.optDouble("dashOffset",0))); }
            JSONObject gradient=value.optJSONObject("gradient");
            if(gradient==null) pigment=new LinearGradient(0,0,1,0,color|0xff000000,color|0xff000000,Shader.TileMode.CLAMP);
            else {
                JSONArray coordinates=gradient.getJSONArray("coordinates"),colors=gradient.getJSONArray("colors"),positions=gradient.getJSONArray("positions");
                int[] stops=new int[colors.length()];float[] offsets=new float[stops.length];
                for(int i=0;i<stops.length;i++){stops[i]=Color.parseColor(colors.getString(i));offsets[i]=number(positions,i);}
                pigment=new LinearGradient(number(coordinates,0),number(coordinates,1),number(coordinates,2),number(coordinates,3),stops,offsets,Shader.TileMode.CLAMP);
            }
        }
    }
    private final Map<String,Node> nodes=new HashMap<>();
    private final Map<Long,TreeMap<String,Node>> buckets=new HashMap<>();
    private final Bitmap mask=Bitmap.createBitmap(SIZE,SIZE,Bitmap.Config.ALPHA_8);
    private final Paint imagePaint=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG);
    private int width,height;
    private float zoom=1,scrollX,scrollY;
    private String viewport="";
    static float number(JSONArray input,int index)throws JSONException { float result=(float)input.getDouble(index);if(!Float.isFinite(result))throw new IllegalArgumentException("Invalid native scene number");return result; }
    static Bitmap bitmap(String data) {
        if(!data.startsWith("data:image/png;base64,"))throw new IllegalArgumentException("Invalid native scene bitmap");
        byte[] bytes=android.util.Base64.decode(data.substring(22),android.util.Base64.DEFAULT);
        Bitmap result=BitmapFactory.decodeByteArray(bytes,0,bytes.length);
        if(result==null)throw new IllegalArgumentException("Cannot decode native scene bitmap");return result;
    }
    private void unindex(Node node,Set<Long> dirty) {
        for(long key:node.cells){TreeMap<String,Node> bucket=buckets.get(key);if(bucket!=null){bucket.remove(node.order+"\u0000"+node.id);if(bucket.isEmpty())buckets.remove(key);}dirty.add(key);}node.cells.clear();
    }
    private void index(Node node,Set<Long> dirty) {
        RectF box=new RectF(node.bounds);box.offset(scrollX,scrollY);box.left*=zoom;box.top*=zoom;box.right*=zoom;box.bottom*=zoom;box.inset(-2,-2);
        int left=Math.max(0,(int)Math.floor(box.left/SIZE)),top=Math.max(0,(int)Math.floor(box.top/SIZE));
        int right=Math.min((width-1)/SIZE,(int)Math.floor(box.right/SIZE)),bottom=Math.min((height-1)/SIZE,(int)Math.floor(box.bottom/SIZE));
        for(int row=top;row<=bottom;row++)for(int col=left;col<=right;col++){
            long key=key(col,row);buckets.computeIfAbsent(key,k->new TreeMap<>()).put(node.order+"\u0000"+node.id,node);node.cells.add(key);dirty.add(key);
        }
    }
    private Matrix matrix(Tile tile) { Matrix matrix=new Matrix();matrix.setTranslate(scrollX,scrollY);matrix.postScale(zoom,zoom);matrix.postTranslate(-tile.x,-tile.y);return matrix; }
    private void draw(Node node,Tile tile,Canvas target) {
        Matrix position=matrix(tile);
        if(node.image!=null){target.save();target.concat(position);target.drawBitmap(node.image,null,node.bounds,imagePaint);target.restore();return;}
        mask.eraseColor(Color.TRANSPARENT);Canvas coverage=new Canvas(mask);coverage.concat(position);
        if(node.clip!=null)coverage.clipPath(node.clip);
        coverage.drawPath(node.path,node.geometry);
        if(node.nib!=null){Paint fill=new Paint(node.geometry);fill.setStyle(Paint.Style.FILL);fill.setPathEffect(null);coverage.drawPath(node.nib,fill);}
        Matrix pigmentPosition=new Matrix(node.transform);pigmentPosition.postConcat(position);node.pigment.setLocalMatrix(pigmentPosition);
        Paint color=new Paint(Paint.ANTI_ALIAS_FLAG);color.setColor(Color.WHITE);color.setAlpha(node.alpha);
        color.setShader(new ComposeShader(node.pigment,new BitmapShader(mask,Shader.TileMode.CLAMP,Shader.TileMode.CLAMP),PorterDuff.Mode.DST_IN));
        target.drawRect(0,0,SIZE,SIZE,color);
    }
    Frame synchronize(JSONObject data,float scale,long received) throws JSONException {
        Frame frame=new Frame();frame.eraseThrough=data.optLong("eraseThrough",0);Set<Long> dirty=new HashSet<>();
        // The bootstrap snapshot predates input accepted while its worker was starting.
        long authoritative=viewport.isEmpty()?0:received;
        float nextZoom=(float)data.getDouble("zoom")*scale,nextX=(float)data.getDouble("scrollX"),nextY=(float)data.getDouble("scrollY");
        int nextWidth=Math.max(1,Math.round((float)data.getDouble("width")*scale)),nextHeight=Math.max(1,Math.round((float)data.getDouble("height")*scale));
        if(!Float.isFinite(nextZoom+nextX+nextY)||nextZoom<=0)throw new IllegalArgumentException("Invalid native scene viewport");
        String nextView=nextWidth+":"+nextHeight+":"+nextZoom+":"+nextX+":"+nextY;
        frame.reset=data.optBoolean("reset")||!nextView.equals(viewport);
        if(data.optBoolean("reset")){nodes.clear();buckets.clear();}
        if(frame.reset){viewport=nextView;width=nextWidth;height=nextHeight;zoom=nextZoom;scrollX=nextX;scrollY=nextY;buckets.clear();for(Node node:nodes.values()){node.cells.clear();index(node,dirty);}}
        JSONArray removed=data.getJSONArray("removals"),updates=data.getJSONArray("nodes");
        for(int i=0;i<removed.length();i++){String id=removed.getString(i);Node old=nodes.remove(id);if(old!=null)unindex(old,dirty);frame.removed.add(id);}
        for(int i=0;i<updates.length();i++){
            JSONObject update=updates.getJSONObject(i);frame.eraseThrough=Math.max(frame.eraseThrough,update.optLong("through",0));
            Node node=new Node(update,authoritative),old=nodes.put(node.id,node);
            if(old!=null)unindex(old,dirty);index(node,dirty);frame.upserts.add(node.id);
        }
        if(data.has("background")){frame.background=bitmap(data.getString("background"));frame.backgroundChanged=true;}
        for(long key:dirty){
            Tile tile=new Tile((int)(key>>32)*SIZE,(int)key*SIZE);TreeMap<String,Node> bucket=buckets.get(key);
            Part part=null;Canvas canvas=null;
            if(bucket!=null)for(Node node:bucket.values()){
                if(part==null||part.ink!=node.ink||(part.ink&&part.through!=node.through)) {part=new Part(node.ink,node.through);tile.parts.add(part);canvas=new Canvas(part.pixels);}
                draw(node,tile,canvas);
            }
            tile.compose();frame.tiles.put(key,tile);
        }
        return frame;
    }
}

/** UI-owned retained layers. CLEAR operates on ink parts only, preserving
 * locked strokes and every interleaved image/text/object in its actual order. */
final class NativeSceneView extends View {
    private static final class Cut {
        final String gesture;final long sequence;final Path path;final RectF bounds;
        Cut(String gesture,long sequence,Path path,RectF bounds){this.gesture=gesture;this.sequence=sequence;this.path=path;this.bounds=bounds;}
    }
    private static final class Backup { final NativeScene.Part part;final Bitmap pixels;Backup(NativeScene.Part part){this.part=part;pixels=part.pixels.copy(Bitmap.Config.ARGB_8888,true);} }
    private final Map<Long,NativeScene.Tile> tiles=new HashMap<>();
    private final Set<Long> dirty=new HashSet<>();
    private final Set<String> elements=new HashSet<>();
    private final List<Cut> cuts=new ArrayList<>();
    private final Map<String,Map<NativeScene.Part,Backup>> backups=new HashMap<>();
    private final Paint clear=new Paint(Paint.ANTI_ALIAS_FLAG),image=new Paint(Paint.FILTER_BITMAP_FLAG);
    private Bitmap background;
    private long sequence;
    private boolean hasFrame;
    NativeSceneView(Context context){super(context);setWillNotDraw(false);setFocusable(false);setClickable(false);clear.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.CLEAR));}
    long sequence(){return sequence;}
    boolean contains(String id){return elements.contains(id);}
    void apply(NativeScene.Frame frame){
        if(frame.reset){tiles.clear();dirty.clear();elements.clear();if(hasFrame){cuts.clear();backups.clear();}}
        hasFrame=true;
        if(frame.backgroundChanged)background=frame.background;
        elements.removeAll(frame.removed);elements.addAll(frame.upserts);
        for(Map.Entry<Long,NativeScene.Tile> entry:frame.tiles.entrySet()){
            NativeScene.Tile tile=entry.getValue();
            for(Cut cut:cuts)if(RectF.intersects(cut.bounds,new RectF(tile.x,tile.y,tile.x+NativeScene.SIZE,tile.y+NativeScene.SIZE))){clear(tile,cut,true);dirty.add(entry.getKey());}
            tiles.put(entry.getKey(),tile);
        }
        if(frame.eraseThrough>0)cuts.removeIf(cut->cut.sequence<=frame.eraseThrough);
        invalidate();
    }
    private void clear(NativeScene.Tile tile,Cut cut,boolean replay){
        for(NativeScene.Part part:tile.parts){
            if(!part.ink||(replay&&cut.sequence<=part.through))continue;
            Map<NativeScene.Part,Backup> saved=backups.get(cut.gesture);
            if(saved!=null&&!saved.containsKey(part))saved.put(part,new Backup(part));
            Canvas canvas=new Canvas(part.pixels);canvas.translate(-tile.x,-tile.y);canvas.drawPath(cut.path,clear);
        }
    }
    static Path sweep(float x1,float y1,float x2,float y2,float width,float height){
        // Same convex sweep as HEraserObject.unionEraserPath / native geometry.
        List<float[]> corners=new ArrayList<>();for(float[] p:new float[][]{{x1,y1},{x2,y2}})for(int dx:new int[]{-1,1})for(int dy:new int[]{-1,1})corners.add(new float[]{p[0]+dx*width/2,p[1]+dy*height/2});
        corners.sort(Comparator.comparingDouble((float[] p)->p[0]).thenComparingDouble(p->p[1]));
        List<float[]> hull=new ArrayList<>();
        for(float[] p:corners){while(hull.size()>1&&cross(hull.get(hull.size()-2),hull.get(hull.size()-1),p)<=0)hull.remove(hull.size()-1);hull.add(p);}
        int lower=hull.size();for(int i=corners.size()-2;i>=0;i--){float[] p=corners.get(i);while(hull.size()>lower&&cross(hull.get(hull.size()-2),hull.get(hull.size()-1),p)<=0)hull.remove(hull.size()-1);hull.add(p);}
        Path path=new Path();path.moveTo(hull.get(0)[0],hull.get(0)[1]);for(int i=1;i<hull.size();i++)path.lineTo(hull.get(i)[0],hull.get(i)[1]);path.close();
        return path;
    }
    long erase(String gesture,float x1,float y1,float x2,float y2,float width,float height){
        backups.computeIfAbsent(gesture,k->new IdentityHashMap<>());
        Path path=sweep(x1,y1,x2,y2,width,height);
        RectF bounds=new RectF();path.computeBounds(bounds,true);Cut cut=new Cut(gesture,++sequence,path,bounds);cuts.add(cut);
        int left=Math.max(0,(int)Math.floor(bounds.left/NativeScene.SIZE)),top=Math.max(0,(int)Math.floor(bounds.top/NativeScene.SIZE));
        int right=Math.min((getWidth()-1)/NativeScene.SIZE,(int)Math.floor(bounds.right/NativeScene.SIZE)),bottom=Math.min((getHeight()-1)/NativeScene.SIZE,(int)Math.floor(bounds.bottom/NativeScene.SIZE));
        for(int row=top;row<=bottom;row++)for(int col=left;col<=right;col++){long key=NativeScene.key(col,row);NativeScene.Tile tile=tiles.get(key);if(tile!=null){clear(tile,cut,false);dirty.add(key);}}
        postInvalidateOnAnimation();return sequence;
    }
    private static float cross(float[] a,float[] b,float[] c){return(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
    void finishErase(String gesture){backups.remove(gesture);}
    void cancelErase(String gesture){
        Map<NativeScene.Part,Backup> saved=backups.remove(gesture);
        if(saved!=null)for(Backup backup:saved.values()){backup.part.pixels.eraseColor(Color.TRANSPARENT);new Canvas(backup.part.pixels).drawBitmap(backup.pixels,0,0,null);}
        cuts.removeIf(cut->cut.gesture.equals(gesture));
        for(NativeScene.Tile tile:tiles.values())tile.compose();invalidate();
    }
    @Override protected void onDraw(Canvas canvas){
        super.onDraw(canvas);
        for(long key:dirty){NativeScene.Tile tile=tiles.get(key);if(tile!=null)tile.compose();}dirty.clear();
        if(background!=null)canvas.drawBitmap(background,null,new RectF(0,0,getWidth(),getHeight()),image);
        for(NativeScene.Tile tile:tiles.values())canvas.drawBitmap(tile.pixels,tile.x,tile.y,null);
    }
}
