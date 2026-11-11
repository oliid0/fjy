package com.fcjy.fcboard;

import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import java.util.ArrayList;
import java.util.List;

/** Incremental port of factoryBrushWidths/Samples/traceFactoryBrush.
 * Sealed path chunks retain their GPU geometry; only the live tail is rebuilt. */
final class NativeBrush {
    private static final class Node {
        final float x, y, width;
        Node(float x, float y, float width) { this.x = x; this.y = y; this.width = width; }
    }
    private final float unit, base, variation;
    private final boolean simulatePressure;
    private final List<Path> sealed = new ArrayList<>();
    private final Path tail = new Path();
    private final RectF bounds = new RectF();
    private Path body = new Path();
    private Node previous, current, source;
    private float lastWidth, lastVelocity;
    private int nodes, stamps;
    private boolean finished;
    NativeBrush(float width, float unit, float variation, boolean simulatePressure) {
        this.unit = unit; this.base = width * 4 / 3 + 3 * unit;
        this.variation = Math.max(0, Math.min(50, variation)) / 50;
        this.simulatePressure = simulatePressure;
    }
    private static Node mid(Node a, Node b) { return new Node((a.x+b.x)/2, (a.y+b.y)/2, (a.width+b.width)/2); }
    void add(float x, float y, float pressure) {
        // Commit the preceding quadratic once, keeping the last one provisional
        // so pointer-up can taper its width to zero without replaying the prefix.
        if (nodes > 1) { Node end = mid(previous, current); curve(null, source, previous, current, nodes == 2); source = end; }
        float factor = simulatePressure ? 1 : 1 + ((float)Math.sqrt(Math.max(0, Math.min(1, pressure))) * .9f - .45f) * variation * .3f;
        if (nodes == 0) lastWidth = base * (1 + .4f * variation) * factor;
        else {
            float velocity = (float)Math.hypot(x-current.x, y-current.y) / unit * .02f;
            float weighted = velocity * .6f + lastVelocity * .4f;
            float maximum = 1 + .4f * variation, minimum = Math.max(.08f, 1 - .92f * variation);
            float target = maximum - (maximum-minimum) * (float)Math.pow(Math.min(1, Math.max(0, weighted*4)), .6);
            lastWidth += (base*target*factor-lastWidth) * (variation*.6f+.3f); lastVelocity = velocity;
        }
        previous = current; current = new Node(x, y, Math.max(unit, Math.max(base*.08f, lastWidth))); nodes++;
        if (nodes == 1) { source = current; stamp(null, current); }
    }
    void finish() { finished = true; }
    private void stamp(Path target, Node node) {
        stamp(target, node.x, node.y, node.width);
    }
    private void stamp(Path target, float x, float y, float width) {
        if (width <= 0) return;
        float rx = width/2, ry = width/4;
        if (target == null) {
            if (stamps == 256) { sealed.add(body); body = new Path(); stamps = 0; }
            target = body; stamps++;
        }
        target.addOval(x-rx, y-ry, x+rx, y+ry, Path.Direction.CW);
        bounds.union(x-rx, y-ry, x+rx, y+ry);
    }
    private void line(Path target, Node a, Node b) {
        int steps = Math.min(4096, (int)Math.floor(Math.hypot(b.x-a.x,b.y-a.y)/(2*unit))+1);
        for (int i=1;i<=steps;i++) {
            float t=(float)i/steps;
            stamp(target, a.x+(b.x-a.x)*t, a.y+(b.y-a.y)*t, a.width+(b.width-a.width)*t);
        }
    }
    private Node curve(Path target, Node from, Node before, Node last, boolean first) {
        Node end = mid(before,last), control = first ? mid(before,end) : before, cursor = from;
        int steps=Math.min(4096,(int)Math.floor(Math.hypot(last.x-before.x,last.y-before.y)/unit/10)+1);
        for(int i=1;i<=steps;i++) {
            float t=(float)i/steps,a=1-t;
            Node next=new Node(a*a*from.x+2*a*t*control.x+t*t*end.x, a*a*from.y+2*a*t*control.y+t*t*end.y,
                from.width+(end.width-from.width)*t);
            line(target,cursor,next); cursor=next;
        }
        return end;
    }
    void draw(Canvas canvas, Paint paint) {
        if (nodes == 0 || paint.getAlpha() == 0) return;
        tail.rewind();
        if (nodes > 1) {
            Node tip=finished ? new Node(current.x,current.y,0) : current;
            Node end=curve(tail,source,previous,tip,nodes==2); line(tail,end,tip);
        }
        int alpha=paint.getAlpha(), saved=0;
        if(alpha<255) { saved=canvas.saveLayerAlpha(bounds,alpha); paint.setAlpha(255); }
        for(Path path:sealed) canvas.drawPath(path,paint);
        canvas.drawPath(body,paint); canvas.drawPath(tail,paint);
        if(alpha<255) { canvas.restoreToCount(saved); paint.setAlpha(alpha); }
    }
}
