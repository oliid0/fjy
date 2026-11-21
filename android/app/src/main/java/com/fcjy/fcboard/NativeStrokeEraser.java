package com.fcjy.fcboard;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
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
        int source;
        Node(double x, double y, double pressure, double distance, double width) {
            this.x=x; this.y=y; this.pressure=pressure; this.distance=distance; this.width=width;
        }
        Node mix(Node b, double t) { Node node=new Node(x+(b.x-x)*t,y+(b.y-y)*t,pressure+(b.pressure-pressure)*t,distance+(b.distance-distance)*t,width+(b.width-width)*t);node.source=b.source;return node; }
        JSONArray json() { return new JSONArray(Arrays.asList(x,y,pressure,distance,width)); }
    }
    private static final class Stroke {
        String id;
        double cap, cos, sin;
        boolean brush, nib;
        int nibSource;
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
            Node node=new Node(x,y,p,d,w);node.source=samples?a.optInt(5,0):0;result.add(node);
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
            stroke.nibSource=data.optInt("nibSource",0);
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
    private static Node corner(double x,double y) { return new Node(x,y,0,0,0); }
    private static List<Node> area(Node a,Node b,double width,double height) {
        double l=Math.min(a.x,b.x)-width/2, r=Math.max(a.x,b.x)+width/2;
        double t=Math.min(a.y,b.y)-height/2, d=Math.max(a.y,b.y)+height/2;
        if (a.x==b.x || a.y==b.y)
            return Arrays.asList(corner(l,t),corner(r,t),corner(r,d),corner(l,d));
        if ((a.x<b.x)==(a.y<b.y))
            return Arrays.asList(corner(l,t),corner(l+width,t),corner(r,d-height),
                corner(r,d),corner(r-width,d),corner(l,t+height));
        return Arrays.asList(corner(r,t),corner(r,t+height),corner(l+width,d),
            corner(l,d),corner(l,d-height),corner(r-width,t));
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
    private static final class Sweep {
        final Node from,to;
        final double left,top,right,bottom;
        final List<Node> area;
        final Map<Double,List<Node>> expanded = new HashMap<>();
        List<Node> forCap(double cap,double width,double height) {
            return cap == 0 ? area : expanded.computeIfAbsent(cap,
                radius -> area(from,to,width+radius,height+radius));
        }
        Sweep(Node from,Node to,double width,double height){
            this.from=from;this.to=to;
            left=Math.min(from.x,to.x)-width/2;right=Math.max(from.x,to.x)+width/2;
            top=Math.min(from.y,to.y)-height/2;bottom=Math.max(from.y,to.y)+height/2;
            area=area(from,to,width,height);
        }
        boolean overlaps(double l,double t,double r,double b){return right>=l&&left<=r&&bottom>=t&&top<=b;}
    }
    private static boolean covers(List<Node> polygon,double x,double y){
        Node point=new Node(x,y,0,0,0);
        for(int i=0;i<polygon.size();i++)if(cross(polygon.get(i),polygon.get((i+1)%polygon.size()),point)<-1e-10)return false;
        return true;
    }
    private static List<double[]> merged(List<double[]> intervals){
        // Same interval union as eraser/region.ts: cut each original segment
        // once, rather than repeatedly copying its survivors for every MOVE.
        intervals.sort(Comparator.comparingDouble(hit->hit[0]));
        List<double[]> result=new ArrayList<>();
        for(double[] hit:intervals){
            if(hit[1]-hit[0]<=1e-10)continue;
            double[] previous=result.isEmpty()?null:result.get(result.size()-1);
            if(previous!=null&&hit[0]<=previous[1]+1e-10)previous[1]=Math.max(previous[1],hit[1]);
            else result.add(hit);
        }
        return result;
    }
    private static boolean cut(Stroke stroke,List<Sweep> sweeps,double width,double height,int through) {
        List<List<Node>> polygons=new ArrayList<>();
        for(Sweep sweep:sweeps){
            // HCanvas quickContains/quickReject: a fully covered stroke needs
            // neither interpolation nor reconstruction of its dense centerline.
            if(through==Integer.MAX_VALUE&&covers(sweep.area,stroke.left,stroke.top)&&covers(sweep.area,stroke.right,stroke.top)
                &&covers(sweep.area,stroke.right,stroke.bottom)&&covers(sweep.area,stroke.left,stroke.bottom)){
                stroke.pieces=Collections.emptyList();stroke.nib=false;return true;
            }
            polygons.add(sweep.forCap(stroke.cap,width,height));
        }
        boolean touched=false;
        if(stroke.nib&&stroke.nibSource<=through)for(Sweep sweep:sweeps){
            boolean hit=contains(stroke.outline,sweep.from)||contains(stroke.outline,sweep.to);
            for(int i=1;!hit&&i<stroke.outline.size();i++)hit=interval(stroke.outline.get(i-1),stroke.outline.get(i),sweep.area,null)!=null;
            if(hit){touched=true;stroke.nib=false;break;}
        }
        List<List<Node>> output=new ArrayList<>();
        for(List<Node> samples:stroke.pieces){
            if(samples.size()==1){
                Node point=samples.get(0);boolean hit=false;
                if(point.source<=through)for(List<Node> polygon:polygons)if(interval(point,point,polygon,stroke)!=null){hit=true;break;}
                if(hit)touched=true;else output.add(samples);continue;
            }
            List<Node> current=new ArrayList<>();
            List<double[]> hits=new ArrayList<>();
            for(int i=1;i<samples.size();i++){
                hits.clear();
                Node a=samples.get(i-1),b=samples.get(i);
                if(b.source<=through){
                    double radius=stroke.brush?Math.max(a.width,b.width)/2:stroke.cap/2;
                    double left=Math.min(a.x,b.x)-radius, right=Math.max(a.x,b.x)+radius;
                    double top=Math.min(a.y,b.y)-radius, bottom=Math.max(a.y,b.y)+radius;
                    for(int j=0;j<sweeps.size();j++){
                        Sweep sweep=sweeps.get(j);
                        if(!sweep.overlaps(left,top,right,bottom))continue;
                        double[] hit=interval(a,b,polygons.get(j),stroke);
                        if(hit!=null&&hit[1]-hit[0]>1e-10){
                            hits.add(hit);
                            if(hit[0]<=0&&hit[1]>=1){hits.clear();hits.add(hit);break;}
                        }
                    }
                }
                if(hits.isEmpty()){if(current.isEmpty())current.add(a);current.add(b);continue;}
                touched=true;double start=0;
                for(double[] hit:merged(hits)){
                    if(hit[0]>start){if(current.isEmpty())current.add(start==0?a:a.mix(b,start));current.add(a.mix(b,hit[0]));}
                    if(!current.isEmpty()){output.add(current);current=new ArrayList<>();}
                    start=Math.max(start,hit[1]);
                }
                if(start<1){current.add(a.mix(b,start));current.add(b);}
            }
            if(!current.isEmpty())output.add(current);
        }
        if(touched)stroke.pieces=output;
        return touched;
    }
    JSONArray erase(JSONArray path,double width,double height) throws JSONException {
        return erase(path,width,height,Integer.MAX_VALUE);
    }
    private JSONArray erase(JSONArray path,double width,double height,int through) throws JSONException {
        if(!Double.isFinite(width+height)||width<=0||height<=0||path.length()<2) throw new IllegalArgumentException("Invalid native sweep");
        List<Node> points=nodes(path,false);Set<String> changed=new LinkedHashSet<>();
        // Bound temporary candidate references even when JS returns thousands
        // of queued samples over dense ink. Every sample is processed in order.
        for(int start=1;start<points.size();start+=32){
            Map<String,List<Sweep>> affected=new LinkedHashMap<>();
            for(int i=start;i<Math.min(points.size(),start+32);i++){
                Node from=points.get(i-1),to=points.get(i);Sweep sweep=new Sweep(from,to,width,height);
                for(String id:candidates(from,to,width,height)){
                    Stroke stroke=strokes.get(id);
                    if(stroke!=null&&sweep.overlaps(stroke.left,stroke.top,stroke.right,stroke.bottom))affected.computeIfAbsent(id,unused->new ArrayList<>()).add(sweep);
                }
            }
            for(Map.Entry<String,List<Sweep>> entry:affected.entrySet()){
                Stroke stroke=strokes.get(entry.getKey());
                if(cut(stroke,entry.getValue(),width,height,through)) changed.add(stroke.id);
            }
        }
        JSONArray output=new JSONArray();
        for(String id:changed){
            Stroke stroke=strokes.get(id);unindex(stroke);index(stroke);JSONArray pieces=new JSONArray();
            for(List<Node> piece:stroke.pieces){JSONArray samples=new JSONArray();for(Node node:piece)samples.put(node.json());pieces.put(samples);}
            output.put(new JSONObject().put("id",id).put("pieces",pieces).put("nibHit",!stroke.nib));
        }
        return output;
    }
    JSONObject clip(JSONObject update,JSONArray cuts) throws JSONException {
        synchronize(new JSONArray().put(update),new JSONArray());
        for(int i=0;i<cuts.length();i++){
            JSONObject cut=cuts.getJSONObject(i);int at=cut.getInt("at");
            if(at<0)throw new IllegalArgumentException("Invalid ink cut order");
            erase(cut.getJSONArray("path"),cut.getDouble("width"),cut.getDouble("height"),at);
        }
        Stroke stroke=strokes.get(update.getString("id"));JSONArray pieces=new JSONArray();
        for(List<Node> piece:stroke.pieces){JSONArray samples=new JSONArray();for(Node node:piece)samples.put(node.json());pieces.put(samples);}
        return new JSONObject().put("pieces",pieces).put("nibHit",!stroke.nib);
    }
}
