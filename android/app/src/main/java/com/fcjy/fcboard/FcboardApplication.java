package com.fcjy.fcboard;

import android.app.Application;
import com.airplay.castplus.CastPlusSupport;

public final class FcboardApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        CastPlusSupport.initialize(this);
    }
}
