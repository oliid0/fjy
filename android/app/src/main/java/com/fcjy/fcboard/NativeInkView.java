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

/** Hardware-accelerated, transparent Android pen preview. No move event enters
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
    private final Paint regionFill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private boolean enabled, palmEnabled = true, routedInput, multiStroke = true;
    private final float touchSlop;
    private float eraserSize = 60;
    private String token = "", mode = "pen";
    private float x, y, scale = 1, width = 4, unit = 1, opacity = 1, palm = 36;
    private int color = Color.BLACK;
    private boolean dashed, thickDashed;
    private float thickWidth, thickUnit, thickOpacity, thickThreshold;
    private int thickColor;
    private org.json.JSONObject appearance, thickAppearance;
    private static final class Contact {
        String id = UUID.randomUUID().toString(), token, pointerType, mode;
        final List<float[]> points = new ArrayList<>();
        final Path path = new Path(), fillPath = new Path(), renderPath = new Path();
        final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        float major, minor, lastX, lastY, rasterX, rasterY;
        boolean palm, awaitingFrame, rejected;
        NativeInputStream stream;
        NativeBrush brush;
        NativeInkRaster raster;
        final Path delta = new Path(), tip = new Path();
        long revision;
        float dashOn, dashOff, dashDistance;
        final PathMeasure measure = new PathMeasure();
        int sent;
    }
    NativeInkView(Context context, Events events) { this(context, events, Runnable::run); }
    NativeInkView(Context context, Events events, Executor publisher) {
        super(context); this.events = events; this.publisher = publisher;
        touchSlop = ViewConfiguration.get(context).getScaledTouchSlop();
        try { eraserPicture = com.caverock.androidsvg.SVG.getFromResource(context, R.raw.factory_eraser).renderToPicture(); }
        catch (com.caverock.androidsvg.SVGParseException error) { throw new IllegalStateException("Native eraser vector cannot be loaded", error); }
        regionFill.setColor(Color.argb(48, 255, 0, 0)); setWillNotDraw(false); setFocusable(false);
    }
    void configure(String token, boolean enabled, float x, float y, float scale, float width, float unit, float opacity, String color, boolean dashed, float palm, List<RectF> blocked, org.json.JSONObject thick, float threshold, String mode, boolean palmEnabled, float eraserSize, org.json.JSONObject appearance) {
        if (!token.equals(this.token) || !enabled) cancel();
        if (!mode.equals("pen") && !mode.equals("select") && !mode.equals("regionErase") && !mode.equals("erase")) throw new IllegalArgumentException("Invalid native gesture mode");
        this.palmEnabled = palmEnabled; this.eraserSize = eraserSize;
        this.appearance = appearance;
        this.thickAppearance = thick == null ? null : thick.optJSONObject("appearance");
        this.token = token; this.mode = mode; this.enabled = enabled; this.x = x; this.y = y; this.scale = scale; this.width = width; this.unit = unit; this.opacity = opacity;
        this.color = Color.parseColor(color); this.dashed = dashed; this.palm = palm; this.blocked.clear(); this.blocked.addAll(blocked);
        thickThreshold = thick == null ? 0 : threshold;
        if (thick != null) {
            thickColor = Color.parseColor(thick.optString("color", color));
            thickWidth = (float)thick.optDouble("penWidth", width); thickUnit = (float)thick.optDouble("unit", unit);
            thickOpacity = (float)thick.optDouble("opacity", opacity); thickDashed = thick.optBoolean("dashed", dashed);
            if (!Float.isFinite(thickWidth + thickUnit + thickOpacity + thickThreshold) || thickWidth <= 0 || thickUnit <= 0 || thickOpacity < 0 || thickOpacity > 1) throw new IllegalArgumentException("Invalid native thick pen profile");
        }
    }
    void setMultiStroke(boolean value) { multiStroke = value; }
    private boolean blocked(float cssX, float cssY) { for (RectF rect : blocked) if (rect.contains(cssX, cssY)) return true; return false; }
    private boolean palm(MotionEvent event, int index) {
        int tool = event.getToolType(index);
        return tool != MotionEvent.TOOL_TYPE_STYLUS && tool != MotionEvent.TOOL_TYPE_MOUSE && tool != MotionEvent.TOOL_TYPE_ERASER
            && Math.max(event.getTouchMajor(index), event.getTouchMinor(index)) / scale >= palm;
    }
    private static NativeInputStream key(MotionEvent event, int index) { return new NativeInputStream(event, index); }
    private boolean writing() { for (Contact contact : active.values()) if (contact.mode.equals("pen")) return true; return false; }
    private boolean erasing() { for (Contact contact : active.values()) if (contact.mode.equals("erase")) return true; return false; }
    private Contact start(MotionEvent event, int index, boolean erase, boolean temporary, boolean candidate, float offsetX, float offsetY) {
        Contact contact = new Contact(); contact.token = token; contact.mode = candidate ? "palm" : erase ? "erase" : mode; contact.palm = temporary;
        contact.stream = new NativeInputStream(event); contact.rejected = candidate && (!palmEnabled || writing());
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
        if (contact.mode.equals("select") || contact.mode.equals("regionErase")) {
            contact.paint.setColor(contact.mode.equals("select") ? Color.rgb(22, 182, 241) : Color.RED);
            contact.paint.setAlpha(255); contact.paint.setStrokeWidth((contact.mode.equals("select") ? 1.5f : 2f) * scale);
            contact.paint.setPathEffect(new DashPathEffect(contact.mode.equals("select") ? new float[]{7 * scale, 7 * scale} : new float[]{8 * scale, 16 * scale}, 0));
        }
        if (contact.mode.equals("pen")) {
            org.json.JSONObject profile = useThick && thickAppearance != null ? thickAppearance : appearance;
            if (profile != null) {
                if ("brush".equals(profile.optString("pen"))) {
                    contact.brush = new NativeBrush(penWidth * scale, penUnit * scale, (float)profile.optDouble("variation", 45),
                        !contact.pointerType.equals("pen") && !profile.optBoolean("touchPressure", false), getWidth(), getHeight());
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
        sample(contact, event.getX(index)-offsetX, event.getY(index)-offsetY, event.getPressure(index), true);
        if (!candidate) { emit(contact, "start", false); contact.sent = 1; }
        contact.awaitingFrame = erase && !candidate;
        return contact;
    }
    private void finish(Contact contact) {
        if (contact.brush != null) contact.brush.finish();
        if (contact.brush == null) contact.path.lineTo(contact.lastX, contact.lastY);
        pending.put(contact.id, contact); emit(contact, "end", true);
    }
    private void rejectRestingHands() {
        for (Contact contact : active.values()) {
            if (contact.mode.equals("palm")) contact.rejected = true;
        }
    }
    void setRoutedInput() { routedInput = true; }
    @Override public boolean onTouchEvent(MotionEvent event) { return !routedInput && handleTouchEvent(event, 0, 0); }
    boolean handleTouchEvent(MotionEvent event, float offsetX, float offsetY) {
        int action = event.getActionMasked(), index = event.getActionIndex();
        NativeInputStream device = new NativeInputStream(event);
        if (action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_POINTER_DOWN) {
            if (action == MotionEvent.ACTION_DOWN) cancelStream(device);
            float cssX = x + (event.getX(index)-offsetX) / scale, cssY = y + (event.getY(index)-offsetY) / scale;
            if (!enabled || (event.getButtonState() & (MotionEvent.BUTTON_SECONDARY | MotionEvent.BUTTON_TERTIARY)) != 0 || blocked(cssX, cssY)) return ownedDevices.contains(device);
            boolean candidate = palm(event, index), temporary = candidate || event.getToolType(index) == MotionEvent.TOOL_TYPE_ERASER;
            boolean erase = temporary || mode.equals("erase");
            if (!erase && !mode.equals("pen") && !active.isEmpty()) return true;
            if (erase && !candidate && erasing()) return ownedDevices.contains(device);
            if (!erase && mode.equals("pen") && !multiStroke && writing()) { ownedDevices.add(device); return true; }
            if (!erase && mode.equals("pen")) rejectRestingHands();
            ownedDevices.add(device);
            start(event, index, erase, temporary, candidate, offsetX, offsetY);
            getParent().requestDisallowInterceptTouchEvent(true); invalidate(); return true;
        }
        if (action == MotionEvent.ACTION_MOVE) {
            for (int i = 0; i < event.getPointerCount(); i++) {
                Contact contact = active.get(key(event, i)); if (contact == null) continue;
                if (!contact.mode.equals("erase") && !contact.mode.equals("palm") && palm(event, i)) {
                    active.remove(key(event, i)); emit(contact, "cancel", false);
                    start(event, i, true, true, true, offsetX, offsetY); continue;
                }
                if (contact.mode.equals("palm")) {
                    if (contact.rejected) continue;
                    if (writing() || erasing()) { contact.rejected = true; continue; }
                    if (Math.hypot(event.getX(i)-offsetX-contact.lastX, event.getY(i)-offsetY-contact.lastY) < touchSlop) continue;
                    contact.mode = "erase"; emit(contact, "start", false); contact.sent = 1; contact.awaitingFrame = true;
                }
                for (int h = 0; h < event.getHistorySize(); h++) sample(contact, event.getHistoricalX(i, h)-offsetX, event.getHistoricalY(i, h)-offsetY, event.getHistoricalPressure(i, h), false);
                sample(contact, event.getX(i)-offsetX, event.getY(i)-offsetY, event.getPressure(i), false);
            }
            invalidate(); return ownedDevices.contains(device);
        }
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_POINTER_UP) {
            Contact contact = active.remove(key(event, index));
            if (contact != null && !contact.mode.equals("palm")) {
                sample(contact, event.getX(index)-offsetX, event.getY(index)-offsetY, event.getPressure(index), false); finish(contact);
            }
            boolean handled = ownedDevices.contains(device);
            if (action == MotionEvent.ACTION_UP) ownedDevices.remove(device);
            invalidate(); return handled;
        }
        if (action == MotionEvent.ACTION_CANCEL) { boolean handled = ownedDevices.contains(device); cancelStream(device); return handled; }
        return ownedDevices.contains(device);
    }
    private void sample(Contact contact, float px, float py, float pressure, boolean first) {
        if (contact.points.size() >= 120000) return;
        if (!first && Math.hypot(px - contact.lastX, py - contact.lastY) < .15f * scale) return;
        contact.points.add(new float[]{x + px / scale, y + py / scale, pressure});
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
            contact.raster.commit(contact.delta, geometry); geometry.setStyle(previousStyle);
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
        else if (!contact.mode.equals("pen")) contact.path.lineTo(px, py);
        else contact.path.quadTo(contact.lastX, contact.lastY, (contact.lastX + px) / 2, (contact.lastY + py) / 2);
        contact.lastX = px; contact.lastY = py;
    }
    private void emit(Contact contact, String phase, boolean complete) {
        int from = contact.mode.equals("erase") && !phase.equals("start") && !phase.equals("cancel") ? contact.sent : 0;
        int to = complete || phase.equals("move") ? contact.points.size() : Math.min(1, contact.points.size());
        List<float[]> values = new ArrayList<>(contact.points.subList(Math.min(from, to), to));
        if (values.isEmpty()) values.add(contact.points.get(contact.points.size() - 1));
        if (contact.mode.equals("erase")) contact.sent = to;
        String id = contact.id, stamp = contact.token, kind = contact.mode, pointerType = contact.pointerType;
        boolean temporary = contact.palm;
        float major = contact.major, minor = contact.minor;
        // JSON encoding of a long lifted stroke must never occupy the input/UI thread.
        publisher.execute(() -> {
            JSArray points = new JSArray();
            for (float[] point : values) points.put(new JSArray(java.util.Arrays.asList(point[0], point[1], point[2])));
            events.contact(new JSObject().put("id", id).put("token", stamp).put("phase", phase).put("points", points)
                .put("mode", kind).put("palm", temporary).put("width", major).put("height", minor).put("pointerType", pointerType));
        });
    }
    void acknowledge(String id) {
        pending.remove(id);
        for (Contact contact : active.values()) if (contact.id.equals(id)) contact.awaitingFrame = false;
        postInvalidateOnAnimation();
    }
    void cancel() {
        for (Contact contact : active.values()) if (!contact.mode.equals("palm")) emit(contact, "cancel", false);
        active.clear(); pending.clear(); ownedDevices.clear(); invalidate();
    }
    void cancelStream(NativeInputStream device) {
        java.util.Iterator<Contact> contacts = active.values().iterator();
        while (contacts.hasNext()) {
            Contact contact = contacts.next();
            if (contact.stream.sameGesture(device)) { if (!contact.mode.equals("palm")) emit(contact, "cancel", false); contacts.remove(); }
        }
        ownedDevices.remove(device); invalidate();
    }
    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        for (Contact contact : pending.values()) draw(canvas, contact);
        for (Contact contact : active.values()) {
            draw(canvas, contact);
            if (contact.mode.equals("erase") && !contact.awaitingFrame && contact.points.size() > contact.sent) {
                contact.awaitingFrame = true; emit(contact, "move", false);
            }
        }
    }
    private void draw(Canvas canvas, Contact contact) {
        if (contact.mode.equals("palm")) return;
        if (contact.mode.equals("erase")) {
            float halfWidth = contact.major * scale / 2, halfHeight = contact.minor * scale / 2;
            eraserRect.set(contact.lastX - halfWidth, contact.lastY - halfHeight, contact.lastX + halfWidth, contact.lastY + halfHeight);
            canvas.drawPicture(eraserPicture, eraserRect); return;
        }
        if (contact.mode.equals("regionErase") && contact.points.size() >= 3) {
            contact.fillPath.set(contact.path); contact.fillPath.close();
            canvas.drawPath(contact.fillPath, regionFill);
        }
        if (contact.brush != null) { contact.brush.draw(canvas, contact.paint); return; }
        if (contact.raster != null) { contact.raster.draw(canvas, contact.paint, contact.tip, contact.revision); return; }
        if (contact.points.size() == 1) canvas.drawPoint(contact.lastX, contact.lastY, contact.paint);
        else {
            contact.renderPath.set(contact.path); contact.renderPath.lineTo(contact.lastX, contact.lastY);
            canvas.drawPath(contact.renderPath, contact.paint);
        }
    }
}
