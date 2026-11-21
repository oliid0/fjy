package com.fcjy.fcboard;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Picture;
import android.graphics.Color;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PathMeasure;
import android.graphics.RectF;
import android.graphics.LinearGradient;
import android.graphics.Shader;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executor;

/** Native Android contact state and retained coverage. No pen move enters
 * WebView. Completed paths are acknowledged after the normal scene paints. */
final class NativeInkView extends View {
    interface Events { void contact(JSObject event); }
    private final Events events;
    private final Executor publisher;
    private final Picture eraserPicture;
    private final RectF eraserRect = new RectF();
    private final Map<NativeInputStream, Contact> active = new HashMap<>();
    private final Set<NativeInputStream> ownedDevices = new HashSet<>();
    private final Map<String, Contact> pending = new HashMap<>();
    private final List<RectF> blocked = new ArrayList<>();
    private final Paint regionFill = new Paint(Paint.ANTI_ALIAS_FLAG), selectionFill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private boolean enabled, palmEnabled = true, routedInput, multiStroke = true;
    private boolean inputReported;
    private final float touchSlop;
    private float eraserSize = 60;
    private String token = "", mode = "pen";
    private boolean recognitionEnabled;
    synchronized void setRecognitionEnabled(boolean enabled){recognitionEnabled=enabled;}
    private RectF selection;
    private String selectionKey="";
    private float selectionMinScale=.1f;
    private boolean selectionResize=true;
    synchronized void setSelection(org.json.JSONArray bounds,String key,float minimum,boolean resize){
        selectionKey=key;selectionMinScale=Math.max(.1f,Math.min(10,minimum));selectionResize=resize;
        selection=bounds==null?null:new RectF((float)bounds.optDouble(0),(float)bounds.optDouble(1),(float)bounds.optDouble(2),(float)bounds.optDouble(3));
    }
    private float x, y, scale = 1, width = 4, unit = 1, opacity = 1, palm = 36;
    private int color = Color.BLACK;
    private boolean dashed, thickDashed;
    private float thickWidth, thickUnit, thickOpacity, thickThreshold;
    private int thickColor;
    private java.util.function.Supplier<NativeSceneView> retainedScene=()->null;
    private boolean strokeErase=true;
    private volatile NativeSceneView display;
    private boolean overlayPreview;
    synchronized void setDisplay(NativeSceneView view){display=view;requestRender();}
    synchronized void setOverlayPreview(boolean enabled) {
        if (overlayPreview == enabled) return;
        cancel();
        overlayPreview = enabled;
        setWillNotDraw(!enabled);
        invalidate();
    }
    private void requestRender(){
        if (overlayPreview) postInvalidateOnAnimation();
        else { NativeSceneView view=display;if(view!=null)view.requestRender(); }
    }
    private void requestRender(RectF bounds){
        if (overlayPreview) postInvalidateOnAnimation();
        else { NativeSceneView view=display;if(view!=null)view.requestRender(bounds); }
    }
    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (overlayPreview) paintCanvas(canvas);
    }
    private NativeSplitInk splitInk;
    synchronized void setPersistent(boolean enabled){if(enabled&&splitInk==null)splitInk=new NativeSplitInk();else if(!enabled)splitInk=null;}
    synchronized void restorePersistent(android.graphics.Bitmap bitmap,String expected){
        if(splitInk==null||!token.equals(expected))throw new IllegalStateException("Split surface changed before restore");
        cancel();android.view.ViewGroup.LayoutParams size=getLayoutParams();
        splitInk.restore(bitmap,Math.max(1,size.width),Math.max(1,size.height));requestRender();
    }
    synchronized void setRetainedScene(java.util.function.Supplier<NativeSceneView> scene,boolean strokeErase){retainedScene=scene;this.strokeErase=strokeErase;}
    private org.json.JSONObject appearance, thickAppearance;
    private static final class InkCut {
        final String gesture;final int at;final float fromX,fromY,toX,toY,width,height;final Path path;
        InkCut(String gesture,int at,float fromX,float fromY,float toX,float toY,float width,float height,Path path){
            this.gesture=gesture;this.at=at;this.fromX=fromX;this.fromY=fromY;this.toX=toX;this.toY=toY;this.width=width;this.height=height;this.path=path;
        }
    }
    private static final class Contact {
        String id = UUID.randomUUID().toString(), token, pointerType, mode, elementId;
        long nativeSequence, sentSequence;
        final List<float[]> points = new ArrayList<>();
        final Map<String,Path> erasures = new HashMap<>();
        final RectF bounds=new RectF();
        final Path path = new Path(), fillPath = new Path(), renderPath = new Path();
        final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        float major, minor, lastX, lastY, rasterX, rasterY;
        boolean palm, awaitingFrame;
        NativeInputStream stream;
        NativeBrush brush;
        java.util.function.Supplier<NativeBrush> brushFactory;
        final List<InkCut> cuts=new ArrayList<>();
        NativeInkRaster raster;
        final Path delta = new Path(), tip = new Path();
        long revision;
        float dashOn, dashOff, dashDistance;
        final PathMeasure measure = new PathMeasure();
        int sent, broadSamples;
        RectF selection;
        float anchorX,anchorY,transformScale=1,dx,dy,startX,startY;
        boolean resize;
        float minimumScale;
    }
    NativeInkView(Context context, Events events) { this(context, events, Runnable::run); }
    NativeInkView(Context context, Events events, Executor publisher) {
        super(context); setWillNotDraw(true); this.events = events; this.publisher = publisher;
        touchSlop = ViewConfiguration.get(context).getScaledTouchSlop();
        try { eraserPicture = com.caverock.androidsvg.SVG.getFromResource(context, R.raw.factory_eraser).renderToPicture(); }
        catch (com.caverock.androidsvg.SVGParseException error) { throw new IllegalStateException("Native eraser vector cannot be loaded", error); }
        selectionFill.setColor(Color.argb(128,3,136,236)); regionFill.setColor(Color.argb(48, 255, 0, 0)); setFocusable(false);
    }
    synchronized void configure(String token, boolean enabled, float x, float y, float scale, float width, float unit, float opacity, String color, boolean dashed, float palm, List<RectF> blocked, org.json.JSONObject thick, float threshold, String mode, boolean palmEnabled, float eraserSize, org.json.JSONObject appearance) {
        if (!token.equals(this.token) || !enabled) cancel();
        if (!mode.equals("pen") && !mode.equals("select") && !mode.equals("regionErase") && !mode.equals("erase")) throw new IllegalArgumentException("Invalid native gesture mode");
        this.palmEnabled = palmEnabled; this.eraserSize = eraserSize;
        this.appearance = appearance;
        this.thickAppearance = thick == null ? null : thick.optJSONObject("appearance");
        this.token = token; this.mode = mode; this.enabled = enabled; this.x = x; this.y = y; this.scale = scale; this.width = width; this.unit = unit; this.opacity = opacity;
        if(enabled&&!inputReported){inputReported=true;MainActivity.startup("input.enabled");}
        this.color = Color.parseColor(color); this.dashed = dashed; this.palm = palm; this.blocked.clear(); this.blocked.addAll(blocked);
        thickThreshold = thick == null ? 0 : threshold;
        if (thick != null) {
            thickColor = Color.parseColor(thick.optString("color", color));
            thickWidth = (float)thick.optDouble("penWidth", width); thickUnit = (float)thick.optDouble("unit", unit);
            thickOpacity = (float)thick.optDouble("opacity", opacity); thickDashed = thick.optBoolean("dashed", dashed);
            if (!Float.isFinite(thickWidth + thickUnit + thickOpacity + thickThreshold) || thickWidth <= 0 || thickUnit <= 0 || thickOpacity < 0 || thickOpacity > 1) throw new IllegalArgumentException("Invalid native thick pen profile");
        }
    }
    synchronized void setMultiStroke(boolean value) { multiStroke = value; }
    private boolean blocked(float cssX, float cssY) { for (RectF rect : blocked) if (rect.contains(cssX, cssY)) return true; return false; }
    synchronized boolean accepts(MotionEvent event,int index,float offsetX,float offsetY){
        float cssX=x+(event.getX(index)-offsetX)/scale,cssY=y+(event.getY(index)-offsetY)/scale;
        if(mode.equals("select")&&selection!=null){RectF hit=new RectF(selection);hit.inset(-20,-20);NativeSceneView scene=retainedScene.get();if(hit.contains(cssX,cssY)){
            if(scene==null||!scene.canTransform(selectionKey))return false;
            boolean corner=(Math.abs(cssX-selection.left)<20||Math.abs(cssX-selection.right)<20)&&(Math.abs(cssY-selection.top)<20||Math.abs(cssY-selection.bottom)<20);
            if(corner&&!selectionResize)return false;
        }}
        return enabled&&(event.getButtonState()&(MotionEvent.BUTTON_SECONDARY|MotionEvent.BUTTON_TERTIARY))==0&&!blocked(x+(event.getX(index)-offsetX)/scale,y+(event.getY(index)-offsetY)/scale);
    }
    private boolean palm(MotionEvent event, int index) {
        int tool = event.getToolType(index);
        return tool != MotionEvent.TOOL_TYPE_STYLUS && tool != MotionEvent.TOOL_TYPE_MOUSE && tool != MotionEvent.TOOL_TYPE_ERASER
            && Math.min(event.getTouchMajor(index), event.getTouchMinor(index)) / scale >= palm;
    }
    private static NativeInputStream key(MotionEvent event, int index) { return new NativeInputStream(event, index); }
    private boolean writing() { for (Contact contact : active.values()) if (contact.mode.equals("pen")) return true; return false; }
    private boolean erasing() { for (Contact contact : active.values()) if (contact.mode.equals("erase")) return true; return false; }
    private Contact start(MotionEvent event, int index, boolean erase, boolean temporary, boolean candidate, float offsetX, float offsetY) {
        return start(event,index,erase,temporary,candidate,offsetX,offsetY,null);
    }
    private Contact start(MotionEvent event, int index, boolean erase, boolean temporary, boolean candidate, float offsetX, float offsetY, Contact deferred) {
        Contact contact = new Contact(); contact.token = token; contact.mode = candidate ? "palm" : erase ? "erase" : mode; contact.palm = temporary;
        contact.stream = new NativeInputStream(event);
        if(contact.mode.equals("pen"))contact.elementId=contact.id;
        int tool = event.getToolType(index);
        contact.pointerType = tool == MotionEvent.TOOL_TYPE_STYLUS || tool == MotionEvent.TOOL_TYPE_ERASER ? "pen" : tool == MotionEvent.TOOL_TYPE_MOUSE ? "mouse" : "touch";
        contact.major = event.getTouchMajor(index) / scale; contact.minor = event.getTouchMinor(index) / scale;
        if (erase) {
            contact.major = temporary ? Math.max(eraserSize, contact.major) : eraserSize;
            contact.minor = temporary ? Math.max(eraserSize * 1.2f, contact.minor) : eraserSize * 1.2f;
        }
        boolean useThick = thickThreshold > 0 && Math.min(contact.major, contact.minor) >= thickThreshold;
        float penWidth = useThick ? thickWidth : width, penUnit = useThick ? thickUnit : unit;
        contact.paint.setColor(useThick ? thickColor : color);
        contact.paint.setAlpha(Math.round((useThick ? thickOpacity : opacity) * Color.alpha(useThick ? thickColor : color)));
        contact.paint.setStrokeWidth(penWidth * scale); contact.paint.setStyle(Paint.Style.STROKE);
        contact.paint.setStrokeCap(Paint.Cap.ROUND); contact.paint.setStrokeJoin(Paint.Join.ROUND);
        if (useThick ? thickDashed : dashed) {
            contact.dashOn = Math.max(penWidth * 1.6f, 8 * penUnit) * scale;
            contact.dashOff = Math.max(penWidth * 1.8f, 10 * penUnit) * scale;
            contact.paint.setPathEffect(new DashPathEffect(new float[]{contact.dashOn, contact.dashOff}, 0));
        }
        if(contact.mode.equals("select")&&selection!=null){
            float cssX=x+(event.getX(index)-offsetX)/scale,cssY=y+(event.getY(index)-offsetY)/scale;
            RectF hit=new RectF(selection);hit.inset(-20,-20);NativeSceneView scene=retainedScene.get();
            if(hit.contains(cssX,cssY)&&scene!=null&&scene.canTransform(selectionKey)){
                contact.mode="transform";contact.selection=new RectF(selection);
                contact.startX=cssX;contact.startY=cssY;
                boolean west=Math.abs(cssX-selection.left)<20,east=Math.abs(cssX-selection.right)<20;
                boolean north=Math.abs(cssY-selection.top)<20,south=Math.abs(cssY-selection.bottom)<20;
                contact.resize=selectionResize&&(west||east)&&(north||south);
                contact.minimumScale=selectionMinScale;
                contact.anchorX=west?selection.right:selection.left;contact.anchorY=north?selection.bottom:selection.top;
            }
        }
        if (contact.mode.equals("select") || contact.mode.equals("regionErase")) {
            contact.paint.setColor(contact.mode.equals("select") ? Color.rgb(22, 182, 241) : Color.RED);
            contact.paint.setAlpha(255); contact.paint.setStrokeWidth((contact.mode.equals("select") ? 1.5f : 2f) * scale);
            contact.paint.setPathEffect(new DashPathEffect(contact.mode.equals("select") ? new float[]{7 * scale, 7 * scale} : new float[]{8 * scale, 16 * scale}, 0));
        }
        if (contact.mode.equals("pen")) {
            org.json.JSONObject profile = useThick && thickAppearance != null ? thickAppearance : appearance;
            if (profile != null) {
                if ("brush".equals(profile.optString("pen"))) {
                    float variation=(float)profile.optDouble("variation",45),physicalWidth=penWidth*scale,physicalUnit=penUnit*scale;
                    boolean simulate=!contact.pointerType.equals("pen")&&!profile.optBoolean("touchPressure",false);
                    int viewportWidth=getWidth(),viewportHeight=getHeight();
                    contact.brushFactory=()->new NativeBrush(physicalWidth,physicalUnit,variation,simulate,viewportWidth,viewportHeight);
                    contact.brush=contact.brushFactory.get();
                    contact.paint.setStyle(Paint.Style.FILL); contact.paint.setPathEffect(null);
                }
                org.json.JSONObject rainbow = profile.optJSONObject("rainbow");
                if (rainbow != null) {
                    org.json.JSONArray colors = rainbow.optJSONArray("colors"), positions = rainbow.optJSONArray("positions");
                    if (colors != null && positions != null && colors.length() >= 2 && colors.length() <= 16 && positions.length() == colors.length()) {
                        int[] stops = new int[colors.length()]; float[] offsets = new float[stops.length];
                        for (int i = 0; i < stops.length; i++) { stops[i] = Color.parseColor(colors.optString(i)); offsets[i] = (float)positions.optDouble(i); }
                        contact.paint.setShader(new LinearGradient(0, 0, getWidth(), 0, stops, offsets, Shader.TileMode.CLAMP));
                    }
                }
                org.json.JSONObject gradient = profile.optJSONObject("gradient");
                if (gradient != null) {
                    org.json.JSONArray colors = gradient.optJSONArray("colors");
                    if (colors != null && colors.length() >= 2 && colors.length() <= 16) {
                        int[] stops = new int[colors.length()];
                        for (int i = 0; i < stops.length; i++) stops[i] = Color.parseColor(colors.optString(i));
                        float startX = (float)gradient.optDouble("x", 0) * scale, startY = (float)gradient.optDouble("y", 0) * scale;
                        float size = (float)gradient.optDouble("size", 320) * scale;
                        if (Float.isFinite(startX + startY + size) && size > 0) contact.paint.setShader(new LinearGradient(startX, startY, startX + size, startY + size, stops, null, Shader.TileMode.MIRROR));
                    }
                }
            }
        }
        if (contact.mode.equals("pen") && contact.brush == null) contact.raster = new NativeInkRaster(getWidth(), getHeight());
        active.put(key(event, index), contact);
        float startX=event.getX(index)-offsetX,startY=event.getY(index)-offsetY;
        if(candidate){contact.startX=startX;contact.startY=startY;}
        if(deferred==null)sample(contact,startX,startY,event.getPressure(index),true);
        else for(int i=0;i<deferred.points.size();i++){
            float[] point=deferred.points.get(i);sample(contact,(point[0]-x)*scale,(point[1]-y)*scale,point[2],i==0);
        }
        if (!candidate) { emit(contact, "start", false); contact.sent = 1; }
        contact.awaitingFrame = erase && !candidate;
        return contact;
    }
    private void finish(Contact contact) {
        if (contact.brush != null) contact.brush.finish();
        if (contact.brush == null && contact.raster == null) contact.path.lineTo(contact.lastX, contact.lastY);
        if (contact.mode.equals("pen")) {
            for (Contact eraser : active.values()) {
                if (eraser.mode.equals("erase") && (eraser.nativeSequence > eraser.sentSequence ||
                    (splitInk != null && eraser.points.size() > eraser.sent))) emit(eraser, "move", false);
            }
        }
        if(splitInk!=null){
            splitInk.size(getWidth(),getHeight());
            if(contact.mode.equals("pen")){
                // Preserve raster operation order for export/undo when a writer
                // finishes during another contact's ongoing eraser gesture.
                splitInk.commit(contact.bounds,target->draw(target,contact));
            }
            else if(contact.mode.equals("erase"))splitInk.finish(contact.id);
        }else pending.put(contact.id, contact);
        // UP may repeat the last sample, so sample() need not invalidate. The
        // cursor is transient input, never wait for asynchronous vector/JS ack.
        if(contact.mode.equals("erase")){
            float halfWidth=contact.major*scale/2+2,halfHeight=contact.minor*scale/2+2;
            requestRender(new RectF(contact.lastX-halfWidth,contact.lastY-halfHeight,contact.lastX+halfWidth,contact.lastY+halfHeight));
        }else requestRender(contact.bounds);
        emit(contact, "end", true);
    }
    synchronized void setRoutedInput() { routedInput = true; }
    @Override public boolean onTouchEvent(MotionEvent event) { return !routedInput && handleTouchEvent(event, 0, 0); }
    synchronized boolean handleTouchEvent(MotionEvent event, float offsetX, float offsetY) {
        int action = event.getActionMasked(), index = event.getActionIndex();
        NativeInputStream device = new NativeInputStream(event);
        if (action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_POINTER_DOWN) {
            if (action == MotionEvent.ACTION_DOWN) cancelStream(device);
            float cssX = x + (event.getX(index)-offsetX) / scale, cssY = y + (event.getY(index)-offsetY) / scale;
            if (!enabled || (event.getButtonState() & (MotionEvent.BUTTON_SECONDARY | MotionEvent.BUTTON_TERTIARY)) != 0 || blocked(cssX, cssY)) return ownedDevices.contains(device);
            boolean broad = palmEnabled && palm(event, index);
            boolean candidate = mode.equals("pen") && broad;
            boolean temporary = candidate || (broad && (mode.equals("erase") || mode.equals("regionErase"))) || event.getToolType(index) == MotionEvent.TOOL_TYPE_ERASER;
            boolean erase = temporary || mode.equals("erase");
            if (!erase && !mode.equals("pen") && !active.isEmpty()) return true;
            if (erase && !candidate && erasing()) return ownedDevices.contains(device);
            if (!erase && mode.equals("pen") && !multiStroke && writing()) { ownedDevices.add(device); return true; }
            ownedDevices.add(device);
            start(event, index, erase, temporary, candidate, offsetX, offsetY);
            getParent().requestDisallowInterceptTouchEvent(true); return true;
        }
        if (action == MotionEvent.ACTION_MOVE) {
            for (int i = 0; i < event.getPointerCount(); i++) {
                Contact contact = active.get(key(event, i)); if (contact == null) continue;
                if (contact.mode.equals("pen") && palmEnabled) {
                    contact.broadSamples=palm(event,i)?contact.broadSamples+1:0;
                    // A single distorted infrared report must not cancel a finger.
                    if(contact.broadSamples>=2){
                        requestRender(contact.bounds);active.remove(key(event,i));emit(contact,"cancel",false);
                        start(event,i,true,true,true,offsetX,offsetY);continue;
                    }
                }
                if (contact.mode.equals("palm")) {
                    if(!palm(event,i))contact=start(event,i,false,false,false,offsetX,offsetY,contact);
                    else {
                        if (erasing()) continue;
                        if (Math.hypot(event.getX(i)-offsetX-contact.startX, event.getY(i)-offsetY-contact.startY) < touchSlop) {
                            for(int h=0;h<event.getHistorySize();h++)sample(contact,event.getHistoricalX(i,h)-offsetX,event.getHistoricalY(i,h)-offsetY,event.getHistoricalPressure(i,h),false);
                            sample(contact,event.getX(i)-offsetX,event.getY(i)-offsetY,event.getPressure(i),false);continue;
                        }
                        contact.mode = "erase"; emit(contact, "start", false); contact.sent = 1; contact.awaitingFrame = true;
                    }
                }
                for (int h = 0; h < event.getHistorySize(); h++) sample(contact, event.getHistoricalX(i, h)-offsetX, event.getHistoricalY(i, h)-offsetY, event.getHistoricalPressure(i, h), false);
                sample(contact, event.getX(i)-offsetX, event.getY(i)-offsetY, event.getPressure(i), false);
            }
            return ownedDevices.contains(device);
        }
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_POINTER_UP) {
            Contact contact = active.remove(key(event, index));
            if(contact!=null&&contact.mode.equals("palm")&&!palm(event,index)){
                contact=start(event,index,false,false,false,offsetX,offsetY,contact);active.remove(key(event,index));
            }
            if (contact != null && !contact.mode.equals("palm")) {
                for (int h=0;h<event.getHistorySize();h++) sample(contact,event.getHistoricalX(index,h)-offsetX,event.getHistoricalY(index,h)-offsetY,event.getHistoricalPressure(index,h),false);
                sample(contact, event.getX(index)-offsetX, event.getY(index)-offsetY, event.getPressure(index), false); finish(contact);
            }
            boolean handled = ownedDevices.contains(device);
            if (action == MotionEvent.ACTION_UP) ownedDevices.remove(device);
            return handled;
        }
        if (action == MotionEvent.ACTION_CANCEL) { boolean handled = ownedDevices.contains(device); cancelStream(device); return handled; }
        return ownedDevices.contains(device);
    }
    private void sample(Contact contact, float px, float py, float pressure, boolean first) {
        if(contact.mode.equals("transform")){
            float cssX=x+px/scale,cssY=y+py/scale;
            if(contact.resize){
                float width=contact.selection.width(),height=contact.selection.height();
                float changeX=(contact.anchorX==contact.selection.right?-1:1)*(cssX-contact.startX);
                float changeY=(contact.anchorY==contact.selection.bottom?-1:1)*(cssY-contact.startY);
                contact.transformScale=Math.max(contact.minimumScale,Math.min(10f,((width+changeX)/Math.max(1,width)+(height+changeY)/Math.max(1,height))/2));
            }else{contact.dx=cssX-contact.startX;contact.dy=cssY-contact.startY;}
            NativeSceneView scene=retainedScene.get();
            if(scene!=null)scene.transformSelection(contact.id,contact.transformScale,contact.dx*scale,contact.dy*scale,(contact.anchorX-x)*scale,(contact.anchorY-y)*scale);
            contact.lastX=px;contact.lastY=py;
            if(first)contact.points.add(new float[]{cssX,cssY,pressure});
            return;
        }
        if (contact.points.size() >= 120000) return;
        if (!first && Math.hypot(px - contact.lastX, py - contact.lastY) < .15f * scale) return;
        if(recognitionEnabled&&contact.mode.equals("pen")){
            if(getContext() instanceof MainActivity)((MainActivity)getContext()).inkActivity();
            else ModelPool.inkActivity();
        }
        NativeSceneView scene=retainedScene.get();
        if(contact.mode.equals("erase")&&strokeErase) {
            float fromX=first?px:contact.lastX,fromY=first?py:contact.lastY;
            Path cut=NativeSceneView.sweep(fromX,fromY,px,py,contact.major*scale,contact.minor*scale);
            if(scene!=null)contact.nativeSequence=scene.erase(contact.id,cut);
            if(splitInk!=null){splitInk.size(getWidth(),getHeight());splitInk.erase(contact.id,cut);}
            RectF area=new RectF();cut.computeBounds(area,true);
            for(Contact preview:pending.values())if(preview.mode.equals("pen")&&RectF.intersects(preview.bounds,area))preview.erasures.computeIfAbsent(contact.id,k->new Path()).addPath(cut);
            for(Contact writer:active.values())if(writer.mode.equals("pen")&&RectF.intersects(writer.bounds,area)){
                InkCut inkCut=new InkCut(contact.id,writer.points.size()-1,fromX,fromY,px,py,contact.major*scale,contact.minor*scale,cut);
                writer.cuts.add(inkCut);erasePreview(writer,inkCut);
            }
        }
        float pad=contact.paint.getStrokeWidth()*4+12*scale;
        float padX=contact.mode.equals("erase")?Math.max(pad,contact.major*scale/2+2):pad;
        float padY=contact.mode.equals("erase")?Math.max(pad,contact.minor*scale/2+2):pad;
        RectF damage=new RectF(px-padX,py-padY,px+padX,py+padY);
        // The final quadratic/taper can change the preceding two intervals.
        // Damage follows the tip, never the whole growing stroke/board.
        for(int i=Math.max(0,contact.points.size()-3);i<contact.points.size();i++){
            float[] point=contact.points.get(i);float atX=(point[0]-x)*scale,atY=(point[1]-y)*scale;
            damage.union(atX-padX,atY-padY,atX+padX,atY+padY);
        }
        requestRender(damage);
        if(first)contact.bounds.set(damage);else contact.bounds.union(damage);
        contact.points.add(new float[]{x + px / scale, y + py / scale, pressure});
        geometry(contact,px,py,pressure,first,contact.points.size()-1);
    }
    private void geometry(Contact contact,float px,float py,float pressure,boolean first,int source){
        if (contact.raster != null) {
            contact.delta.rewind();
            if (first) contact.delta.addCircle(px, py, contact.paint.getStrokeWidth() / 2, Path.Direction.CW);
            else {
                contact.delta.moveTo(contact.rasterX, contact.rasterY);
                contact.delta.quadTo(contact.lastX, contact.lastY, (contact.lastX + px) / 2, (contact.lastY + py) / 2);
            }
            Paint geometry = contact.paint;
            Paint.Style previousStyle = geometry.getStyle();
            if (first) geometry.setStyle(Paint.Style.FILL);
            contact.raster.commit(contact.delta, geometry,source); geometry.setStyle(previousStyle);
            if (!first && contact.dashOn > 0) {
                contact.measure.setPath(contact.delta, false); contact.dashDistance += contact.measure.getLength();
                contact.paint.setPathEffect(new DashPathEffect(new float[]{contact.dashOn, contact.dashOff}, contact.dashDistance % (contact.dashOn + contact.dashOff)));
            }
            contact.rasterX = first ? px : (contact.lastX + px) / 2;
            contact.rasterY = first ? py : (contact.lastY + py) / 2;
            contact.tip.rewind(); contact.tip.moveTo(contact.rasterX, contact.rasterY); contact.tip.lineTo(px, py); contact.revision++;
        }
        if (contact.brush != null) contact.brush.add(px, py, pressure);
        else if (contact.raster != null) { /* Stable geometry already rasterized. */ }
        else if (first) contact.path.moveTo(px, py);
        else contact.path.lineTo(px, py);
        contact.lastX = px; contact.lastY = py;
    }
    private void erasePreview(Contact contact,InkCut cut){
        if(contact.brush!=null)contact.brush.erase(cut.path,cut.at);
        else if(contact.raster!=null)contact.raster.erase(cut.path,cut.at);
    }
    private void rebuildPreview(Contact contact){
        contact.brush=contact.brushFactory==null?null:contact.brushFactory.get();
        contact.raster=contact.brush==null?new NativeInkRaster(getWidth(),getHeight()):null;
        contact.dashDistance=0;contact.tip.rewind();
        if(contact.dashOn>0)contact.paint.setPathEffect(new DashPathEffect(new float[]{contact.dashOn,contact.dashOff},0));
        int next=0;
        for(int i=0;i<contact.points.size();i++){
            float[] point=contact.points.get(i);geometry(contact,(point[0]-x)*scale,(point[1]-y)*scale,point[2],i==0,i);
            while(next<contact.cuts.size()&&contact.cuts.get(next).at==i)erasePreview(contact,contact.cuts.get(next++));
        }
        if(pending.containsKey(contact.id)&&contact.brush!=null)contact.brush.finish();
        requestRender(contact.bounds);
    }
    private void emit(Contact contact, String phase, boolean complete) {
        int from = contact.mode.equals("erase") && !phase.equals("start") && !phase.equals("cancel") ? contact.sent : 0;
        int to = complete || phase.equals("move") ? contact.points.size() : Math.min(1, contact.points.size());
        List<float[]> values = new ArrayList<>(contact.points.subList(Math.min(from, to), to));
        if (values.isEmpty()) values.add(contact.points.get(contact.points.size() - 1));
        if (contact.mode.equals("erase")) {
            contact.sent = to;
            if (!phase.equals("start")) contact.sentSequence = contact.nativeSequence;
        }
        String id = contact.id, stamp = contact.token, kind = contact.mode, pointerType = contact.pointerType;
        boolean temporary = contact.palm;
        float major = contact.major, minor = contact.minor;
        long sequence=contact.nativeSequence;
        List<InkCut> cuts=complete&&contact.mode.equals("pen")?new ArrayList<>(contact.cuts):java.util.Collections.emptyList();
        float originX=x,originY=y,ratio=scale;
        JSObject transform=contact.mode.equals("transform")?new JSObject().put("scale",contact.transformScale).put("dx",contact.dx).put("dy",contact.dy).put("anchorX",contact.anchorX).put("anchorY",contact.anchorY):null;
        // JSON encoding of a long lifted stroke must never occupy the input/UI thread.
        publisher.execute(() -> {
            JSArray points = new JSArray();
            for (float[] point : values) points.put(new JSArray(java.util.Arrays.asList(point[0], point[1], point[2])));
            JSArray erased=new JSArray();
            for(InkCut cut:cuts)erased.put(new JSObject().put("gesture",cut.gesture).put("at",cut.at).put("width",cut.width/ratio).put("height",cut.height/ratio)
                .put("path",new JSArray(java.util.Arrays.asList(new JSArray(java.util.Arrays.asList(originX+cut.fromX/ratio,originY+cut.fromY/ratio)),new JSArray(java.util.Arrays.asList(originX+cut.toX/ratio,originY+cut.toY/ratio))))));
            events.contact(new JSObject().put("id", id).put("token", stamp).put("phase", phase).put("points", points)
                .put("mode", kind).put("palm", temporary).put("width", major).put("height", minor).put("pointerType", pointerType).put("nativeSequence",sequence).put("transform",transform).put("cuts",erased));
        });
    }
    synchronized void acknowledge(String id) {
        acknowledge(id,"",false);
    }
    synchronized void acknowledge(String id,String elementId,boolean complete) {
        Contact pendingContact=pending.get(id);NativeSceneView scene=retainedScene.get();
        if(pendingContact!=null&&pendingContact.mode.equals("pen")&&!elementId.isEmpty()&&scene!=null&&!scene.contains(elementId))pendingContact.elementId=elementId;
        else if(pending.remove(id)!=null)requestRender(pendingContact.bounds);
        if(complete&&scene!=null)scene.finishErase(id);
        for (Contact contact : active.values()) if (contact.id.equals(id)) {
            contact.awaitingFrame = false;
            float halfWidth=contact.major*scale/2+2,halfHeight=contact.minor*scale/2+2;
            requestRender(new RectF(contact.lastX-halfWidth,contact.lastY-halfHeight,contact.lastX+halfWidth,contact.lastY+halfHeight));
        }
    }
    synchronized void sceneCommitted(){sceneCommitted(retainedScene.get());}
    synchronized void sceneCommitted(NativeSceneView scene){
        if(scene==null)return;
        java.util.Iterator<Contact> contacts=pending.values().iterator();
        while(contacts.hasNext()){
            Contact contact=contacts.next();
            if(contact.elementId!=null&&scene.contains(contact.elementId)){requestRender(contact.bounds);contacts.remove();}
        }
    }
    private void restorePreview(String gesture){
        if(splitInk!=null)splitInk.cancel(gesture);
        List<Contact> writers=new ArrayList<>(active.values());writers.addAll(pending.values());
        for(Contact preview:writers){preview.erasures.remove(gesture);if(preview.cuts.removeIf(cut->cut.gesture.equals(gesture)))rebuildPreview(preview);}
    }
    synchronized void cancel() {
        for (Contact contact : active.values()) if (!contact.mode.equals("palm")) { NativeSceneView scene=retainedScene.get();if(contact.mode.equals("transform")&&scene!=null)scene.cancelSelection(contact.id);if(contact.mode.equals("erase")){if(scene!=null)scene.cancelErase(contact.id);restorePreview(contact.id);}emit(contact, "cancel", false); }
        NativeSceneView scene=retainedScene.get();if(scene!=null)for(Contact contact:pending.values())if(contact.mode.equals("transform"))scene.cancelSelection(contact.id);
        active.clear(); pending.clear(); ownedDevices.clear(); requestRender();
    }
    synchronized void cancelStream(NativeInputStream device) {
        java.util.Iterator<Contact> contacts = active.values().iterator();
        while (contacts.hasNext()) {
            Contact contact = contacts.next();
            if (contact.stream.sameGesture(device)) { if (!contact.mode.equals("palm")) {NativeSceneView scene=retainedScene.get();if(contact.mode.equals("transform")&&scene!=null)scene.cancelSelection(contact.id);if(contact.mode.equals("erase")){if(scene!=null)scene.cancelErase(contact.id);restorePreview(contact.id);}emit(contact, "cancel", false);} contacts.remove(); }
        }
        ownedDevices.remove(device); requestRender();
    }
    protected synchronized void paintCanvas(Canvas canvas) {
        int scope=canvas.save();
        for(RectF box:blocked)canvas.clipOutRect((box.left-x)*scale,(box.top-y)*scale,(box.right-x)*scale,(box.bottom-y)*scale);
        if(splitInk!=null)splitInk.draw(canvas);
        for (Contact contact : pending.values()) {
            // Erasure reconciliation may wait for JS; its cursor ends at native UP.
            if (contact.mode.equals("erase")) continue;
            int saved=canvas.save();
            for(Path cut:contact.erasures.values())canvas.clipOutPath(cut);
            draw(canvas,contact);canvas.restoreToCount(saved);
        }
        for (Contact contact : active.values()) {
            draw(canvas, contact);
            if (contact.mode.equals("erase") && contact.nativeSequence == 0 && !contact.awaitingFrame && contact.points.size() > contact.sent) {
                contact.awaitingFrame = true; emit(contact, "move", false);
            }
        }
        canvas.restoreToCount(scope);
    }
    private void draw(Canvas canvas, Contact contact) {
        if (contact.mode.equals("palm")||contact.mode.equals("transform")) return;
        if (contact.mode.equals("erase")) {
            float halfWidth = contact.major * scale / 2, halfHeight = contact.minor * scale / 2;
            eraserRect.set(contact.lastX - halfWidth, contact.lastY - halfHeight, contact.lastX + halfWidth, contact.lastY + halfHeight);
            canvas.drawPicture(eraserPicture, eraserRect); return;
        }
        if ((contact.mode.equals("regionErase") || contact.mode.equals("select")) && contact.points.size() >= 3) {
            contact.fillPath.set(contact.path); contact.fillPath.close();
            canvas.drawPath(contact.fillPath, contact.mode.equals("select") ? selectionFill : regionFill);
        }
        if (contact.brush != null) { contact.brush.draw(canvas, contact.paint); return; }
        if (contact.raster != null) { contact.raster.draw(canvas, contact.paint, contact.tip, contact.revision,contact.points.size()-1); return; }
        if (contact.points.size() == 1) canvas.drawPoint(contact.lastX, contact.lastY, contact.paint);
        else {
            contact.renderPath.set(contact.path); contact.renderPath.lineTo(contact.lastX, contact.lastY);
            canvas.drawPath(contact.renderPath, contact.paint);
        }
    }
}
