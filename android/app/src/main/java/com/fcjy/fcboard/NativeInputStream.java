package com.fcjy.fcboard;

import android.view.MotionEvent;

/** Android can merge several infrared HID interfaces into one InputDevice.
 * The source and original downTime distinguish independent gesture streams;
 * pointer IDs alone (or device IDs alone) cannot own those contacts. */
final class NativeInputStream {
    final int device, source, pointer;
    final long downTime;
    NativeInputStream(MotionEvent event) { this(event, -1); }
    NativeInputStream(MotionEvent event, int index) {
        device=event.getDeviceId(); source=event.getSource(); downTime=event.getDownTime();
        pointer=index<0?-1:event.getPointerId(index);
    }
    boolean sameGesture(NativeInputStream other) { return device==other.device&&source==other.source&&downTime==other.downTime; }
    @Override public boolean equals(Object other) {
        if(!(other instanceof NativeInputStream)) return false;
        NativeInputStream stream=(NativeInputStream)other;
        return sameGesture(stream)&&pointer==stream.pointer;
    }
    @Override public int hashCode() { return 31*(31*(31*device+source)+(int)(downTime^(downTime>>>32)))+pointer; }
}
