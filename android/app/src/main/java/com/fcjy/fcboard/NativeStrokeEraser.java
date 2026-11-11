package com.fcjy.fcboard;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Worker-confined port of eraser/stroke.ts swept rectangle and interpolating
 * clipping. Retains a spatial index so each historical sample tests nearby ink
 * rather than scanning every stroke in the board. No Android UI/Canvas calls. */
final class NativeStrokeEraser {
    private static final double CELL = 256;
    private static final class Node {
        final double x, y, pressure, distance, width;
        Node(double x, double y, double pressure, double distance, double width) {
            this.x=x; this.y=y; this.pressure=pressure; this.distance=distance; this.width=width;
        }
        Node mix(Node b, double t) { return new Node(x+(b.x-x)*t,y+(b.y-y)*t,pressure+(b.pressure-pressure)*t,distance+(b.distance-distance)*t,width+(b.width-width)*t); }
        JSONArray json() { return new JSONArray(Arrays.asList(x,y,pressure,distance,width)); }
    }
    private static final class Stroke {
        String id;
        double cap, cos, sin;
        boolean brush, nib;
        List<Node> outline;
        List<List<Node>> pieces = new ArrayList<>();
        final List<Long> cells = new ArrayList<>();
        double left, top, right, bottom;
    }
    private final Map<String, Stroke> strokes = new HashMap<>();
    private final Map<Long, Set<String>> grid = new HashMap<>();
    private final Set<String> large = new HashSet<>();
    private static List<Node> nodes(JSONArray input, boolean samples) throws JSONException {
        List<Node> result = new ArrayList<>();
        for (int i=0;i<input.length();i++) {
            JSONArray a=input.getJSONArray(i);
            double x=a.getDouble(0), y=a.getDouble(1), p=samples?a.getDouble(2):0, d=samples?a.getDouble(3):0, w=samples?a.getDouble(4):0;
            if (!Double.isFinite(x+y+p+d+w) || w<0) throw new IllegalArgumentException("Invalid native eraser geometry");
            result.add(new Node(x,y,p,d,w));
        }
        return result;
    }
    void synchronize(JSONArray updates, JSONArray removals) throws JSONException {
        for(int i=0;i<removals.length();i++) remove(removals.getString(i));
        for(int i=0;i<updates.length();i++) {
            JSONObject data=updates.getJSONObject(i); Stroke stroke=new Stroke();
            stroke.id=data.getString("id"); stroke.cap=data.getDouble("cap"); stroke.brush=data.getBoolean("brush");
            double angle=data.getDouble("brushAngle"); stroke.cos=Math.cos(angle); stroke.sin=Math.sin(angle);
            stroke.outline=nodes(data.getJSONArray("nibOutline"),false); stroke.nib=!stroke.outline.isEmpty();
            List<Node> points=nodes(data.getJSONArray("samples"),true);
            if (stroke.id.isEmpty() || !Double.isFinite(stroke.cap+angle) || stroke.cap<0 || points.isEmpty()) throw new IllegalArgumentException("Invalid native eraser stroke");
            stroke.pieces.add(points); remove(stroke.id); strokes.put(stroke.id,stroke); index(stroke);
        }
    }
    private static long key(int col,int row) { return ((long)col<<32)|(row&0xffffffffL); }
    private void unindex(Stroke stroke) {
        large.remove(stroke.id);
        for(long cell:stroke.cells) {
            Set<String> bucket=grid.get(cell); if(bucket!=null) { bucket.remove(stroke.id); if(bucket.isEmpty()) grid.remove(cell); }
        }
        stroke.cells.clear();
    }
    private void remove(String id) { Stroke previous=strokes.remove(id); if(previous!=null) unindex(previous); }
    private void index(Stroke stroke) {
        stroke.left=stroke.top=Double.POSITIVE_INFINITY; stroke.right=stroke.bottom=Double.NEGATIVE_INFINITY;
        for(List<Node> piece:stroke.pieces) for(Node node:piece) {
            double radius=stroke.brush?node.width/2:stroke.cap/2;
            stroke.left=Math.min(stroke.left,node.x-radius); stroke.right=Math.max(stroke.right,node.x+radius);
            stroke.top=Math.min(stroke.top,node.y-radius); stroke.bottom=Math.max(stroke.bottom,node.y+radius);
        }
        if(stroke.nib) for(Node point:stroke.outline) {
            stroke.left=Math.min(stroke.left,point.x); stroke.right=Math.max(stroke.right,point.x);
            stroke.top=Math.min(stroke.top,point.y); stroke.bottom=Math.max(stroke.bottom,point.y);
        }
        if(!Double.isFinite(stroke.left+stroke.top+stroke.right+stroke.bottom)) return;
        int l=(int)Math.floor(stroke.left/CELL), t=(int)Math.floor(stroke.top/CELL), r=(int)Math.floor(stroke.right/CELL), b=(int)Math.floor(stroke.bottom/CELL);
        if((long)(r-l+1)*(b-t+1)>4096) { large.add(stroke.id); return; }
        for(int row=t;row<=b;row++) for(int col=l;col<=r;col++) {
            long cell=key(col,row); stroke.cells.add(cell); grid.computeIfAbsent(cell,unused->new HashSet<>()).add(stroke.id);
        }
    }
    private Set<String> candidates(Node a,Node b,double width,double height) {
        int l=(int)Math.floor((Math.min(a.x,b.x)-width/2)/CELL), t=(int)Math.floor((Math.min(a.y,b.y)-height/2)/CELL);
        int r=(int)Math.floor((Math.max(a.x,b.x)+width/2)/CELL), d=(int)Math.floor((Math.max(a.y,b.y)+height/2)/CELL);
        if((long)(r-l+1)*(d-t+1)>4096) return new HashSet<>(strokes.keySet());
        Set<String> result=new HashSet<>(large);
        for(int row=t;row<=d;row++) for(int col=l;col<=r;col++) { Set<String> bucket=grid.get(key(col,row)); if(bucket!=null) result.addAll(bucket); }
        return result;
    }
    private static double cross(Node a,Node b,Node c) { return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); }
    private static List<Node> half(List<Node> input) {
        List<Node> hull=new ArrayList<>();
        for(Node p:input) { while(hull.size()>1&&cross(hull.get(hull.size()-2),hull.get(hull.size()-1),p)<=0) hull.remove(hull.size()-1); hull.add(p); }
        if(!hull.isEmpty()) hull.remove(hull.size()-1); return hull;
    }
    private static List<Node> area(Node a,Node b,double width,double height) {
        List<Node> corners=new ArrayList<>();
        for(Node p:new Node[]{a,b}) for(int x:new int[]{-1,1}) for(int y:new int[]{-1,1}) corners.add(new Node(p.x+x*width/2,p.y+y*height/2,0,0,0));
        corners.sort(Comparator.comparingDouble((Node p)->p.x).thenComparingDouble(p->p.y));
        List<Node> distinct=new ArrayList<>();
        for(Node p:corners) if(distinct.isEmpty() || distinct.get(distinct.size()-1).x!=p.x || distinct.get(distinct.size()-1).y!=p.y) distinct.add(p);
        List<Node> hull=half(distinct); Collections.reverse(distinct); hull.addAll(half(distinct)); return hull;
    }
    private static double[] interval(Node a,Node b,List<Node> area,Stroke stroke) {
        double enter=0,exit=1;
        for(int i=0;i<area.size();i++) {
            Node p=area.get(i),q=area.get((i+1)%area.size()); double nx=p.y-q.y,ny=q.x-p.x;
            double support=stroke!=null&&stroke.brush?Math.hypot(nx*stroke.cos+ny*stroke.sin,(-nx*stroke.sin+ny*stroke.cos)/2)/2:0;
            double start=cross(p,q,a)+a.width*support,delta=cross(p,q,b)+b.width*support-start;
            if(Math.abs(delta)<1e-10) { if(start<0) return null; }
            else if(delta>0) enter=Math.max(enter,-start/delta); else exit=Math.min(exit,-start/delta);
            if(enter>exit) return null;
        }
        return new double[]{enter,exit};
    }
    private static boolean contains(List<Node> polygon,Node p) {
        int winding=0;
        for(int i=0;i<polygon.size();i++) { Node a=polygon.get(i),b=polygon.get((i+1)%polygon.size());
            if(a.y<=p.y&&b.y>p.y&&cross(a,b,p)>0) winding++; else if(a.y>p.y&&b.y<=p.y&&cross(a,b,p)<0) winding--;
        }
        return winding!=0;
    }
    private static boolean cut(Stroke stroke,Node from,Node to,double width,double height) {
        if(Math.max(from.x,to.x)+width/2<stroke.left||Math.min(from.x,to.x)-width/2>stroke.right||Math.max(from.y,to.y)+height/2<stroke.top||Math.min(from.y,to.y)-height/2>stroke.bottom) return false;
        boolean touched=false;
        if(stroke.nib) {
            List<Node> nibArea=area(from,to,width,height);
            boolean hit=contains(stroke.outline,from)||contains(stroke.outline,to);
            for(int i=1;!hit&&i<stroke.outline.size();i++) hit=interval(stroke.outline.get(i-1),stroke.outline.get(i),nibArea,null)!=null;
            if(hit) { touched=true; stroke.nib=false; }
        }
        List<Node> polygon=area(from,to,width+stroke.cap,height+stroke.cap);
        List<List<Node>> output=new ArrayList<>();
        for(List<Node> samples:stroke.pieces) {
            if(samples.size()==1) { if(interval(samples.get(0),samples.get(0),polygon,stroke)!=null) touched=true; else output.add(samples); continue; }
            List<Node> current=new ArrayList<>();
            for(int i=1;i<samples.size();i++) {
                Node a=samples.get(i-1),b=samples.get(i); double[] hit=interval(a,b,polygon,stroke);
                if(hit==null||hit[1]-hit[0]<=1e-10) {
                    if(current.isEmpty()) current.add(a); current.add(b); continue;
                }
                touched=true;
                if(hit[0]>0) { if(current.isEmpty()) current.add(a); current.add(a.mix(b,hit[0])); }
                if(!current.isEmpty()) { output.add(current); current=new ArrayList<>(); }
                if(hit[1]<1) { current.add(a.mix(b,hit[1])); current.add(b); }
            }
            if(!current.isEmpty()) output.add(current);
        }
        if(touched) stroke.pieces=output;
        return touched;
    }
    JSONArray erase(JSONArray path,double width,double height) throws JSONException {
        if(!Double.isFinite(width+height)||width<=0||height<=0||path.length()<2) throw new IllegalArgumentException("Invalid native sweep");
        List<Node> points=nodes(path,false); Set<String> changed=new LinkedHashSet<>();
        for(int i=1;i<points.size();i++) {
            Node from=points.get(i-1),to=points.get(i);
            for(String id:candidates(from,to,width,height)) {
                Stroke stroke=strokes.get(id); if(stroke==null) continue;
                if(cut(stroke,from,to,width,height)) { changed.add(id); unindex(stroke); index(stroke); }
            }
        }
        JSONArray output=new JSONArray();
        for(String id:changed) {
            Stroke stroke=strokes.get(id); JSONArray pieces=new JSONArray();
            for(List<Node> piece:stroke.pieces) { JSONArray samples=new JSONArray(); for(Node node:piece) samples.put(node.json()); pieces.put(samples); }
            output.put(new JSONObject().put("id",id).put("pieces",pieces).put("nibHit",!stroke.nib));
        }
        return output;
    }
}
