package com.fcjy.fcboard;

import android.content.Context;
import android.graphics.*;
import androidx.core.graphics.PathParser;
import java.util.*;
import org.json.*;

/** Worker-owned canonical scene. Only changed spatial buckets are rasterized;
 * the UI receives retained tiles, never a full board image per erase sample. */
final class NativeScene {
    static final int SIZE = 256;
    static final class Cut {
        final String gesture;final long sequence;final Path path;final RectF bounds;
        Cut(String gesture,long sequence,Path path,RectF bounds){this.gesture=gesture;this.sequence=sequence;this.path=path;this.bounds=bounds;}
    }

    static long key(int x,int y) { return ((long)x<<32)|(y&0xffffffffL); }
    static final class Part {
        final Bitmap pixels;
        final boolean ink;
        final long through;
        Part(boolean ink,long through) { this(ink,through,Bitmap.createBitmap(SIZE,SIZE,Bitmap.Config.ARGB_8888)); }
        Part(boolean ink,long through,Bitmap pixels) { this.ink=ink;this.through=through;this.pixels=pixels; }
    }
    static final class Tile {
        final int x,y;
        final List<Part> parts=new ArrayList<>();
        final Bitmap pixels;
        Tile(int x,int y) { this(x,y,Bitmap.createBitmap(SIZE,SIZE,Bitmap.Config.ARGB_8888)); }
        Tile(int x,int y,Bitmap pixels) { this.x=x;this.y=y;this.pixels=pixels; }
        Tile snapshot(long through) {
            Tile copy=new Tile(x,y,pixels.copy(Bitmap.Config.ARGB_8888,true));
            for(Part part:parts)copy.parts.add(new Part(part.ink,Math.max(part.through,through),part.pixels.copy(Bitmap.Config.ARGB_8888,true)));
            return copy;
        }
        void compose() {
            pixels.eraseColor(Color.TRANSPARENT); Canvas canvas=new Canvas(pixels);
            for(Part part:parts) canvas.drawBitmap(part.pixels,0,0,null);
        }
    }
    static final class Frame {
        final Map<Long,Tile> tiles=new HashMap<>();
        final Set<String> upserts=new HashSet<>(),removed=new HashSet<>();
        final Map<Long,Bitmap> selected=new HashMap<>(),selectedIdle=new HashMap<>();
        RectF selectionBounds;
        String selectionThrough="",selectionKey="";
        boolean reset;
        Bitmap background;
        int backgroundColor=Color.TRANSPARENT;
        boolean backgroundChanged;
        long eraseThrough;
        long rasterizedNodes;
    }
    private static final class Node {
        String id,order;
        boolean ink,inline;
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
            id=value.getString("id"); order=value.getString("order"); ink=value.getBoolean("ink");inline=value.optBoolean("inline",false);
            through=value.optLong("through",-1);if(through<0) through=received;
            JSONArray box=value.getJSONArray("bounds");bounds=new RectF(number(box,0),number(box,1),number(box,2),number(box,3));
            if(id.isEmpty()||!Float.isFinite(bounds.left+bounds.top+bounds.right+bounds.bottom)) throw new IllegalArgumentException("Invalid native scene bounds");
            if(value.has("bitmap")) { image=bitmap(value.getString("bitmap")); return; }
            JSONObject brush=value.optJSONObject("brush");
            if(brush!=null){
                // The brush already consists of exact 2:1 ellipse stamps. SVG
                // semicircles round to impossible radii in PathParser, causing
                // recursive radius repair and thousands of warnings per second.
                path=new Path();JSONArray stamps=brush.getJSONArray("stamps");
                if(stamps.length()%3!=0)throw new IllegalArgumentException("Invalid native brush stamps");
                float angle=(float)brush.optDouble("angle",0);if(!Float.isFinite(angle))throw new IllegalArgumentException("Invalid brush angle");
                Path ellipse=new Path();Matrix position=new Matrix();
                for(int i=0;i<stamps.length();i+=3){
                    float x=number(stamps,i),y=number(stamps,i+1),width=number(stamps,i+2);
                    if(width<=0)throw new IllegalArgumentException("Invalid brush width");
                    float rx=width/2,ry=width/4;
                    if(angle==0)path.addOval(x-rx,y-ry,x+rx,y+ry,Path.Direction.CW);
                    else{ellipse.rewind();ellipse.addOval(-rx,-ry,rx,ry,Path.Direction.CW);position.setRotate((float)Math.toDegrees(angle));position.postTranslate(x,y);path.addPath(ellipse,position);}
                }
            }else path=PathParser.createPathFromPathData(value.getString("path"));
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
    private final Map<Long,Tile> rasterTiles=new HashMap<>();
    private long rasterizedNodes;
    private final Map<Long,TreeMap<String,Node>> buckets=new HashMap<>();
    private final Bitmap mask=Bitmap.createBitmap(SIZE,SIZE,Bitmap.Config.ALPHA_8);
    private final Paint imagePaint=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG);
    private int width,height;
    private float zoom=1,scrollX,scrollY;
    private String viewport="";
    private Set<String> selection=new HashSet<>();
    private final Map<Long,Bitmap> selectionPixels=new HashMap<>(),selectionIdlePixels=new HashMap<>();
    private long reconciledThrough,rasterEraseThrough;
    private final Paint rasterClear=new Paint();
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
        rasterizedNodes++;
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
    private Set<Long> eraseRaster(List<Cut> samples,long through){
        Set<Long> changed=new HashSet<>();rasterClear.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.CLEAR));
        for(Cut cut:samples){
            if(cut.sequence<=rasterEraseThrough||cut.sequence>through)continue;
            int left=Math.max(0,(int)Math.floor(cut.bounds.left/SIZE)),top=Math.max(0,(int)Math.floor(cut.bounds.top/SIZE));
            int right=Math.min((width-1)/SIZE,(int)Math.floor(cut.bounds.right/SIZE)),bottom=Math.min((height-1)/SIZE,(int)Math.floor(cut.bounds.bottom/SIZE));
            for(int row=top;row<=bottom;row++)for(int col=left;col<=right;col++){
                long cell=key(col,row);Tile tile=rasterTiles.get(cell);if(tile==null)continue;
                for(Part part:tile.parts){
                    if(!part.ink||cut.sequence<=part.through)continue;
                    Canvas canvas=new Canvas(part.pixels);canvas.translate(-tile.x,-tile.y);canvas.drawPath(cut.path,rasterClear);changed.add(cell);
                }
            }
        }
        return changed;
    }
    Frame synchronize(JSONObject data,float scale,long received,List<Cut> eraseSamples) throws JSONException {
        Frame frame=new Frame();frame.eraseThrough=data.optLong("eraseThrough",0);Set<Long> dirty=new HashSet<>(),rebuild=new HashSet<>();
        Map<Long,List<Node>> additions=new HashMap<>();long previousDraws=rasterizedNodes;
        // The bootstrap snapshot predates input accepted while its worker was starting.
        long authoritative=viewport.isEmpty()?0:received;
        float nextZoom=(float)data.getDouble("zoom")*scale,nextX=(float)data.getDouble("scrollX"),nextY=(float)data.getDouble("scrollY");
        int nextWidth=Math.max(1,Math.round((float)data.getDouble("width")*scale)),nextHeight=Math.max(1,Math.round((float)data.getDouble("height")*scale));
        if(!Float.isFinite(nextZoom+nextX+nextY)||nextZoom<=0)throw new IllegalArgumentException("Invalid native scene viewport");
        String nextView=nextWidth+":"+nextHeight+":"+nextZoom+":"+nextX+":"+nextY;
        frame.reset=data.optBoolean("reset")||!nextView.equals(viewport);
        if(data.optBoolean("reset")){rasterEraseThrough=0;nodes.clear();buckets.clear();rasterTiles.clear();}
        if(frame.reset){selectionPixels.clear();selectionIdlePixels.clear();rasterTiles.clear();viewport=nextView;width=nextWidth;height=nextHeight;zoom=nextZoom;scrollX=nextX;scrollY=nextY;buckets.clear();for(Node node:nodes.values()){node.cells.clear();index(node,dirty);}}
        Set<String> selected=new HashSet<>();JSONArray selectedIds=data.optJSONArray("selectionIds");
        if(selectedIds!=null)for(int i=0;i<selectedIds.length();i++)selected.add(selectedIds.getString(i));
        boolean selectionChanged=!selected.equals(selection);
        if(selectionChanged){
            // Like FocusSelectionView's retained background/selection bitmap,
            // only cells whose membership changed need to move between layers.
            // Selecting a small object must not replay all distant board ink.
            Set<String> changed=new HashSet<>(selection);changed.addAll(selected);
            for(String id:changed)if(selection.contains(id)!=selected.contains(id)){
                Node node=nodes.get(id);if(node!=null){dirty.addAll(node.cells);rebuild.addAll(node.cells);}
            }
            selection=selected;
        }
        JSONArray selectionBox=data.optJSONArray("selectionBounds");
        if(!selection.isEmpty()&&selectionBox!=null)frame.selectionBounds=new RectF((number(selectionBox,0)+scrollX)*zoom,(number(selectionBox,1)+scrollY)*zoom,(number(selectionBox,2)+scrollX)*zoom,(number(selectionBox,3)+scrollY)*zoom);
        frame.selectionThrough=data.optString("selectionThrough","");frame.selectionKey=data.optString("selectionKey","");
        JSONArray removed=data.getJSONArray("removals"),updates=data.getJSONArray("nodes");
        for(int i=0;i<updates.length();i++)frame.eraseThrough=Math.max(frame.eraseThrough,updates.getJSONObject(i).optLong("through",0));
        Set<String> erasureRemovals=new HashSet<>();JSONArray erased=data.optJSONArray("erasureRemovals");
        if(erased!=null)for(int i=0;i<erased.length();i++)erasureRemovals.add(erased.getString(i));
        boolean rasterErasure=!frame.reset&&!selectionChanged&&selection.isEmpty()&&frame.eraseThrough>rasterEraseThrough;
        boolean completeSweep=false;for(Cut cut:eraseSamples)if(cut.sequence==frame.eraseThrough)completeSweep=true;
        rasterErasure&=completeSweep;
        for(int i=0;rasterErasure&&i<updates.length();i++){
            JSONObject value=updates.getJSONObject(i);Node old=nodes.get(value.getString("id"));long through=value.optLong("through",0);
            if(!value.optBoolean("ink")||value.has("bitmap")||through<=0||through>frame.eraseThrough||(old!=null&&(!old.ink||old.image!=null)))rasterErasure=false;
        }
        for(int i=0;rasterErasure&&i<removed.length();i++){
            String id=removed.getString(i);Node old=nodes.get(id);
            if(!erasureRemovals.contains(id)||(old!=null&&(!old.ink||old.image!=null)))rasterErasure=false;
        }
        // HCanvas retains the raster and clears the actual sweep. The canonical
        // vector/index still receives every fragment, but unchanged dense ink in
        // the same tile never needs replay solely to confirm that same erasure.
        Set<Long> erasedCells=rasterErasure?eraseRaster(eraseSamples,frame.eraseThrough):Collections.emptySet();
        for(int i=0;i<removed.length();i++){String id=removed.getString(i);Node old=nodes.remove(id);if(old!=null){if(!rasterErasure)rebuild.addAll(old.cells);unindex(old,dirty);}frame.removed.add(id);}
        for(int i=0;i<updates.length();i++){
            JSONObject update=updates.getJSONObject(i);frame.eraseThrough=Math.max(frame.eraseThrough,update.optLong("through",0));
            Node node=new Node(update,authoritative),old=nodes.put(node.id,node);
            if(old!=null){if(!rasterErasure)rebuild.addAll(old.cells);unindex(old,dirty);}
            index(node,dirty);frame.upserts.add(node.id);
            for(long cell:node.cells){
                if(rasterErasure)continue;
                TreeMap<String,Node> bucket=buckets.get(cell);
                if(old==null&&!frame.reset&&bucket.lastEntry().getValue()==node&&!rebuild.contains(cell))additions.computeIfAbsent(cell,k->new ArrayList<>()).add(node);
                else rebuild.add(cell);
            }
        }
        if(rasterErasure){dirty.clear();dirty.addAll(erasedCells);}
        if(data.has("background")){frame.background=bitmap(data.getString("background"));frame.backgroundChanged=true;}
        else if(data.has("backgroundColor")){frame.backgroundColor=Color.parseColor(data.getString("backgroundColor"));frame.backgroundChanged=true;}
        // Versions through this watermark already contain their vector erasure.
        // They can share one retained ink part; keeping a 256x256 ARGB bitmap
        // for every old contact sequence makes rapid write/erase allocate layers
        // without bound. Newer ink keeps its birth sequence for pending sweeps.
        reconciledThrough=Math.max(reconciledThrough,frame.eraseThrough);
        for(long key:dirty){
            Tile tile=rasterTiles.get(key);List<Node> appended=additions.get(key);
            if(rasterErasure&&tile!=null){ /* The exact native sweep already reconciled these retained pixels. */ }
            else if(tile!=null&&!frame.reset&&!rebuild.contains(key)&&appended!=null){
                // HCanvas's retained bitmap behavior: append only new topmost
                // ink. Older vectors are rasterized again only for real edits,
                // erasure, reordering or a viewport change.
                for(Node node:appended){
                    if(selection.contains(node.id)||node.inline)continue;
                    long through=Math.max(node.through,reconciledThrough);
                    Part part=tile.parts.isEmpty()?null:tile.parts.get(tile.parts.size()-1);
                    if(part==null||part.ink!=node.ink||(part.ink&&Math.max(part.through,reconciledThrough)!=through)){part=new Part(node.ink,through);tile.parts.add(part);}
                    draw(node,tile,new Canvas(part.pixels));
                }
            }else{
                tile=new Tile((int)(key>>32)*SIZE,(int)key*SIZE);TreeMap<String,Node> bucket=buckets.get(key);
                Part part=null;Canvas canvas=null;
                if(bucket!=null)for(Node node:bucket.values()){
                    if(selection.contains(node.id)||node.inline)continue;
                    long through=Math.max(node.through,reconciledThrough);
                    if(part==null||part.ink!=node.ink||(part.ink&&part.through!=through)){part=new Part(node.ink,through);tile.parts.add(part);canvas=new Canvas(part.pixels);}
                    draw(node,tile,canvas);
                }
            }
            tile.compose();rasterTiles.put(key,tile);
            // UI CLEAR owns a separate snapshot; it cannot modify worker pixels
            // or corrupt later appends/cancelled erasures.
            frame.tiles.put(key,tile.snapshot(reconciledThrough));
        }
        if(frame.selectionBounds==null){selectionPixels.clear();selectionIdlePixels.clear();}
        else for(long cell:dirty){
            selectionPixels.remove(cell);selectionIdlePixels.remove(cell);
            TreeMap<String,Node> bucket=buckets.get(cell);if(bucket==null)continue;
            Tile tile=null;Canvas canvas=null;
            for(Node node:bucket.values())if(selection.contains(node.id)){
                if(tile==null){tile=new Tile((int)(cell>>32)*SIZE,(int)cell*SIZE);canvas=new Canvas(tile.pixels);}
                draw(node,tile,canvas);
            }
            if(tile!=null){
                selectionPixels.put(cell,tile.pixels);
                // Idle selection preserves the actual interleaved scene order.
                // Only an active transform lifts selected pixels into a preview.
                Tile idle=new Tile(tile.x,tile.y);Canvas idleCanvas=new Canvas(idle.pixels);
                for(Node node:bucket.values())if(!node.inline)draw(node,idle,idleCanvas);
                selectionIdlePixels.put(cell,idle.pixels);
            }
        }
        frame.selected.putAll(selectionPixels);frame.selectedIdle.putAll(selectionIdlePixels);
        rasterEraseThrough=Math.max(rasterEraseThrough,frame.eraseThrough);
        frame.rasterizedNodes=rasterizedNodes-previousDraws;
        return frame;
    }
}

/** UI-owned retained layers. CLEAR operates on ink parts only, preserving
 * locked strokes and every interleaved image/text/object in its actual order. */
final class NativeSceneView extends NativeCanvasView {
    private static final class Backup { final NativeScene.Part part;final Bitmap pixels;Backup(NativeScene.Part part){this.part=part;pixels=part.pixels.copy(Bitmap.Config.ARGB_8888,true);} }
    private final Map<Long,NativeScene.Tile> tiles=new HashMap<>();
    private final Set<Long> dirty=new HashSet<>();
    private final Set<String> elements=new HashSet<>();
    private final List<NativeScene.Cut> cuts=new ArrayList<>();
    private final Map<String,Map<NativeScene.Part,Backup>> backups=new HashMap<>();
    private final Paint clear=new Paint(Paint.ANTI_ALIAS_FLAG),image=new Paint(Paint.FILTER_BITMAP_FLAG);
    private Bitmap background;
    private int backgroundColor=Color.TRANSPARENT;
    private long sequence;
    private Map<Long,Bitmap> selected=new HashMap<>(),selectedIdle=new HashMap<>();
    private RectF selectionBounds;
    private final Matrix selectionMatrix=new Matrix();
    private final Paint selectionPaint=new Paint(Paint.ANTI_ALIAS_FLAG);
    private String selectionGesture="",selectionKey="";
    synchronized boolean canTransform(){return selectionBounds!=null&&!selected.isEmpty();}
    synchronized boolean canTransform(String key){return selectionKey.equals(key)&&canTransform();}
    synchronized void transformSelection(String gesture,float scale,float dx,float dy,float anchorX,float anchorY){
        if(!canTransform())return;
        selectionGesture=gesture;selectionMatrix.setScale(scale,scale,anchorX,anchorY);selectionMatrix.postTranslate(dx,dy);requestRender();
    }
    synchronized void cancelSelection(String gesture){if(selectionGesture.equals(gesture)){selectionGesture="";selectionMatrix.reset();requestRender();}}

    private NativeInkView input;
    synchronized void setInput(NativeInkView view){input=view;requestRender();}
    synchronized boolean hasInput(NativeInkView view){return input==view;}
    private boolean hasFrame;
    private boolean framePainted;
    private Runnable ready;
    synchronized void whenPresented(Runnable callback){ready=callback;}
    @Override protected void onFramePosted(){
        Runnable callback;
        synchronized(this){if(!framePainted)return;callback=ready;ready=null;}
        if(callback!=null)post(callback);
    }
    NativeSceneView(Context context){super(context);setFocusable(false);setClickable(false);clear.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.CLEAR));}
    synchronized long sequence(){return sequence;}
    synchronized List<NativeScene.Cut> erasureSamples(long through){
        List<NativeScene.Cut> result=new ArrayList<>();for(NativeScene.Cut cut:cuts)if(cut.sequence<=through)result.add(cut);return result;
    }
    synchronized boolean contains(String id){return elements.contains(id);}
    synchronized void apply(NativeScene.Frame frame){
        boolean repaintAll=frame.reset||frame.backgroundChanged||!selectionKey.equals(frame.selectionKey)||!selectionGesture.isEmpty();
        if(frame.reset){tiles.clear();dirty.clear();elements.clear();if(hasFrame){cuts.clear();backups.clear();}}
        hasFrame=true;
        selected=frame.selected;selectedIdle=frame.selectedIdle;selectionBounds=frame.selectionBounds;selectionKey=frame.selectionKey;
        if(selectionGesture.equals(frame.selectionThrough)||selectionBounds==null){selectionGesture="";selectionMatrix.reset();}
        if(frame.backgroundChanged){background=frame.background;backgroundColor=frame.backgroundColor;}
        elements.removeAll(frame.removed);elements.addAll(frame.upserts);
        for(Map.Entry<Long,NativeScene.Tile> entry:frame.tiles.entrySet()){
            NativeScene.Tile tile=entry.getValue(),retired=tiles.get(entry.getKey());
            // A replaced tile part can never be drawn again. Keeping its backup
            // across every geometry reply retains entire obsolete bitmap generations.
            if(retired!=null)for(Map<NativeScene.Part,Backup> saved:backups.values())saved.keySet().removeAll(retired.parts);
            for(NativeScene.Cut cut:cuts)if(RectF.intersects(cut.bounds,new RectF(tile.x,tile.y,tile.x+NativeScene.SIZE,tile.y+NativeScene.SIZE))){clear(tile,cut,true);dirty.add(entry.getKey());}
            tiles.put(entry.getKey(),tile);
        }
        if(frame.eraseThrough>0)cuts.removeIf(cut->cut.sequence<=frame.eraseThrough);
        if(repaintAll)requestRender();
        else for(NativeScene.Tile tile:frame.tiles.values())requestRender(new RectF(tile.x,tile.y,tile.x+NativeScene.SIZE,tile.y+NativeScene.SIZE));
    }
    private void clear(NativeScene.Tile tile,NativeScene.Cut cut,boolean replay){
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
    synchronized long erase(String gesture,float x1,float y1,float x2,float y2,float width,float height){
        backups.computeIfAbsent(gesture,k->new IdentityHashMap<>());
        Path path=sweep(x1,y1,x2,y2,width,height);
        RectF bounds=new RectF();path.computeBounds(bounds,true);NativeScene.Cut cut=new NativeScene.Cut(gesture,++sequence,path,bounds);cuts.add(cut);
        int left=Math.max(0,(int)Math.floor(bounds.left/NativeScene.SIZE)),top=Math.max(0,(int)Math.floor(bounds.top/NativeScene.SIZE));
        int right=Math.min((getWidth()-1)/NativeScene.SIZE,(int)Math.floor(bounds.right/NativeScene.SIZE)),bottom=Math.min((getHeight()-1)/NativeScene.SIZE,(int)Math.floor(bounds.bottom/NativeScene.SIZE));
        for(int row=top;row<=bottom;row++)for(int col=left;col<=right;col++){long key=NativeScene.key(col,row);NativeScene.Tile tile=tiles.get(key);if(tile!=null){clear(tile,cut,false);dirty.add(key);}}
        requestRender(bounds);return sequence;
    }
    private static float cross(float[] a,float[] b,float[] c){return(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
    synchronized void finishErase(String gesture){backups.remove(gesture);}
    synchronized void cancelErase(String gesture){
        Map<NativeScene.Part,Backup> saved=backups.remove(gesture);
        cuts.removeIf(cut->cut.gesture.equals(gesture));
        if(saved!=null)for(Map.Entry<Long,NativeScene.Tile> entry:tiles.entrySet()){
            NativeScene.Tile tile=entry.getValue();boolean restored=false;
            for(NativeScene.Part part:tile.parts){
                Backup backup=saved.get(part);if(backup==null)continue;
                part.pixels.eraseColor(Color.TRANSPARENT);new Canvas(part.pixels).drawBitmap(backup.pixels,0,0,null);restored=true;
                // Rebase other still-pending gestures on the restored pixels.
                for(Map<NativeScene.Part,Backup> pending:backups.values())pending.remove(part);
            }
            if(!restored)continue;
            for(NativeScene.Cut cut:cuts)if(RectF.intersects(cut.bounds,new RectF(tile.x,tile.y,tile.x+NativeScene.SIZE,tile.y+NativeScene.SIZE)))clear(tile,cut,true);
            dirty.add(entry.getKey());
        }
        requestRender();
    }
    @Override protected void paintCanvas(Canvas canvas){
        NativeInkView preview;
        synchronized(this){preview=input;}
        if(preview==null){synchronized(this){paintScene(canvas);}return;}
        // Match input -> scene lock order used by real eraser dispatch. One
        // buffer contains canonical ink, pending handoff and every live contact;
        // translucent pens cannot double-darken across independent surfaces.
        synchronized(preview){
            preview.sceneCommitted(this);
            synchronized(this){paintScene(canvas);}
            preview.paintCanvas(canvas);
        }
    }
    private void paintScene(Canvas canvas){
        framePainted=hasFrame;
        for(long key:dirty){NativeScene.Tile tile=tiles.get(key);if(tile!=null)tile.compose();}dirty.clear();
        canvas.drawColor(backgroundColor);
        if(background!=null)canvas.drawBitmap(background,null,new RectF(0,0,getWidth(),getHeight()),image);
        for(Map.Entry<Long,NativeScene.Tile> entry:tiles.entrySet()){
            NativeScene.Tile tile=entry.getValue();if(canvas.quickReject(tile.x,tile.y,tile.x+NativeScene.SIZE,tile.y+NativeScene.SIZE,Canvas.EdgeType.AA))continue;Bitmap idle=selectionGesture.isEmpty()?selectedIdle.get(entry.getKey()):null;
            canvas.drawBitmap(idle==null?tile.pixels:idle,tile.x,tile.y,null);
        }
        int saved=canvas.save();canvas.concat(selectionMatrix);
        if(!selectionGesture.isEmpty())for(Map.Entry<Long,Bitmap> entry:selected.entrySet()){long cell=entry.getKey();canvas.drawBitmap(entry.getValue(),(int)(cell>>32)*NativeScene.SIZE,(int)cell*NativeScene.SIZE,null);}
        canvas.restoreToCount(saved);
        if(!selectionGesture.isEmpty()&&selectionBounds!=null){
            RectF box=new RectF(selectionBounds);selectionMatrix.mapRect(box);
            selectionPaint.setStyle(Paint.Style.STROKE);selectionPaint.setColor(Color.rgb(22,182,241));selectionPaint.setStrokeWidth(2);
            canvas.drawRect(box,selectionPaint);
            selectionPaint.setStyle(Paint.Style.FILL);
            for(float px:new float[]{box.left,box.right})for(float py:new float[]{box.top,box.bottom})canvas.drawCircle(px,py,5,selectionPaint);
        }
    }
}
