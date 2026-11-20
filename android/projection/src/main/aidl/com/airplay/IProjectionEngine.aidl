package com.airplay;
import android.view.Surface;
import com.airplay.IProjectionEvents;

oneway interface IProjectionEngine {
    void start(String protocol, in Surface target, IProjectionEvents events);
    void attach(String protocol, in Surface target, IProjectionEvents events);
    void stop(String protocol, IProjectionEvents events);
}
