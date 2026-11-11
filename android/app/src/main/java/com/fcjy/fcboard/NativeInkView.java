package com.fcjy.fcboard;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.view.MotionEvent;
import android.view.View;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Hardware-accelerated, transparent Android pen preview. No move event enters
 * WebView. Completed paths are acknowledged after the normal scene paints. */
final class NativeInkView extends View {
    interface Events { void contact(JSObject event); }
    private final Events events;
    private final Map<Integer, Contact> active = new HashMap<>();
    private final Map<String, Contact> pending = new HashMap<>();
    private final List<RectF> blocked = new ArrayList<>();
    private final Paint regionFill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private boolean enabled;
    private String token = "", mode = "pen";
    private float x, y, scale = 1, width = 4, unit = 1, opacity = 1, palm = 36;
    private int color = Color.BLACK;
    private boolean dashed, thickDashed;
    private float thickWidth, thickUnit, thickOpacity, thickThreshold;
    private int thickColor;
    private static final class Contact {
        String id = UUID.randomUUID().toString(), token, pointerType, mode;
        final List<float[]> points = new ArrayList<>();
        final Path path = new Path(), fillPath = new Path();
        final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        float major, minor, lastX, lastY;
    }
    NativeInkView(Context context, Events events) { super(context); this.events = events; regionFill.setColor(Color.argb(48, 255, 0, 0)); setWillNotDraw(false); setFocusable(false); }
    void configure(String token, boolean enabled, float x, float y, float scale, float width, float unit, float opacity, String color, boolean dashed, float palm, List<RectF> blocked, org.json.JSONObject thick, float threshold, String mode) {
        if (!token.equals(this.token) || !enabled) cancel();
        if (!mode.equals("pen") && !mode.equals("select") && !mode.equals("regionErase")) throw new IllegalArgumentException("Invalid native gesture mode");
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
    private boolean blocked(float cssX, float cssY) { for (RectF rect : blocked) if (rect.contains(cssX, cssY)) return true; return false; }
    @Override public boolean onTouchEvent(MotionEvent event) {
        int action = event.getActionMasked(), index = event.getActionIndex(), pointer = event.getPointerId(index);
        if (action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_POINTER_DOWN) {
            float cssX = x + event.getX(index) / scale, cssY = y + event.getY(index) / scale;
            if (!enabled || (event.getButtonState() & (MotionEvent.BUTTON_SECONDARY | MotionEvent.BUTTON_TERTIARY)) != 0 || blocked(cssX, cssY) || event.getToolType(index) == MotionEvent.TOOL_TYPE_ERASER || event.getTouchMajor(index) / scale >= palm) return !active.isEmpty();
            if (!mode.equals("pen") && !active.isEmpty()) return true;
            if (active.size() >= 10 || pending.size() >= 16) return false;
            Contact contact = new Contact(); contact.token = token; contact.mode = mode;
            contact.pointerType = event.getToolType(index) == MotionEvent.TOOL_TYPE_STYLUS ? "pen" : event.getToolType(index) == MotionEvent.TOOL_TYPE_MOUSE ? "mouse" : "touch";
            contact.major = event.getTouchMajor(index) / scale; contact.minor = event.getTouchMinor(index) / scale;
            boolean useThick = thickThreshold > 0 && Math.min(contact.major, contact.minor) >= thickThreshold;
            float penWidth = useThick ? thickWidth : width, penUnit = useThick ? thickUnit : unit;
            contact.paint.setColor(useThick ? thickColor : color); contact.paint.setAlpha(Math.round((useThick ? thickOpacity : opacity) * Color.alpha(useThick ? thickColor : color))); contact.paint.setStrokeWidth(penWidth * scale);
            contact.paint.setStyle(Paint.Style.STROKE); contact.paint.setStrokeCap(Paint.Cap.ROUND); contact.paint.setStrokeJoin(Paint.Join.ROUND);
            if (useThick ? thickDashed : dashed) contact.paint.setPathEffect(new DashPathEffect(new float[]{Math.max(penWidth * 1.6f, 8 * penUnit) * scale, Math.max(penWidth * 1.8f, 10 * penUnit) * scale}, 0));
            if (!mode.equals("pen")) {
                contact.paint.setColor(mode.equals("select") ? Color.rgb(22, 182, 241) : Color.RED);
                contact.paint.setAlpha(255); contact.paint.setStrokeWidth((mode.equals("select") ? 1.5f : 2f) * scale);
                contact.paint.setPathEffect(new DashPathEffect(mode.equals("select") ? new float[]{7 * scale, 7 * scale} : new float[]{8 * scale, 16 * scale}, 0));
            }
            active.put(pointer, contact); sample(contact, event.getX(index), event.getY(index), event.getPressure(index), true);
            emit(contact, "start", false); getParent().requestDisallowInterceptTouchEvent(true); postInvalidateOnAnimation(); return true;
        }
        if (action == MotionEvent.ACTION_MOVE) {
            for (int i = 0; i < event.getPointerCount(); i++) {
                Contact contact = active.get(event.getPointerId(i)); if (contact == null) continue;
                for (int h = 0; h < event.getHistorySize(); h++) sample(contact, event.getHistoricalX(i, h), event.getHistoricalY(i, h), event.getHistoricalPressure(i, h), false);
                sample(contact, event.getX(i), event.getY(i), event.getPressure(i), false);
            }
            postInvalidateOnAnimation(); return !active.isEmpty();
        }
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_POINTER_UP) {
            Contact contact = active.remove(pointer); if (contact == null) return !active.isEmpty();
            sample(contact, event.getX(index), event.getY(index), event.getPressure(index), false); contact.path.lineTo(contact.lastX, contact.lastY);
            pending.put(contact.id, contact); emit(contact, "end", true); postInvalidateOnAnimation(); return true;
        }
        if (action == MotionEvent.ACTION_CANCEL) { cancel(); return true; }
        return !active.isEmpty();
    }
    private void sample(Contact contact, float px, float py, float pressure, boolean first) {
        if (contact.points.size() >= 120000) return;
        if (!first && Math.hypot(px - contact.lastX, py - contact.lastY) < .15f * scale) return;
        contact.points.add(new float[]{x + px / scale, y + py / scale, pressure});
        if (first) contact.path.moveTo(px, py);
        else if (!contact.mode.equals("pen")) contact.path.lineTo(px, py);
        else contact.path.quadTo(contact.lastX, contact.lastY, (contact.lastX + px) / 2, (contact.lastY + py) / 2);
        contact.lastX = px; contact.lastY = py;
    }
    private void emit(Contact contact, String phase, boolean complete) {
        JSArray points = new JSArray();
        List<float[]> values = complete ? contact.points : contact.points.subList(0, Math.min(1, contact.points.size()));
        for (float[] point : values) points.put(new JSArray(java.util.Arrays.asList(point[0], point[1], point[2])));
        events.contact(new JSObject().put("id", contact.id).put("token", contact.token).put("phase", phase).put("points", points)
            .put("mode", contact.mode).put("width", contact.major).put("height", contact.minor).put("pointerType", contact.pointerType));
    }
    void acknowledge(String id) { pending.remove(id); postInvalidateOnAnimation(); }
    void cancel() {
        for (Contact contact : active.values()) emit(contact, "cancel", false);
        active.clear(); pending.clear(); postInvalidateOnAnimation();
    }
    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        for (Contact contact : pending.values()) draw(canvas, contact);
        for (Contact contact : active.values()) draw(canvas, contact);
    }
    private void draw(Canvas canvas, Contact contact) {
        if (contact.mode.equals("regionErase") && contact.points.size() >= 3) {
            contact.fillPath.set(contact.path); contact.fillPath.close();
            canvas.drawPath(contact.fillPath, regionFill);
        }
        if (contact.points.size() == 1) canvas.drawPoint(contact.lastX, contact.lastY, contact.paint);
        else canvas.drawPath(contact.path, contact.paint);
    }
}
