package com.fcjy.fcboard;

import android.content.Context;
import android.content.Intent;
import java.util.LinkedHashMap;
import java.util.Map;

/** Package names and split action verified in HWhiteBoard 5.42's HGizmoSettingWindow. */
final class FactoryTools {
    static final Map<String, String> PACKAGES = new LinkedHashMap<>();
    static {
        PACKAGES.put("transfer", "com.bsd.fastfile");
        PACKAGES.put("vote", "com.bsd.vote.android");
        PACKAGES.put("calculator", "com.bsd.bsdcalculator");
        PACKAGES.put("spotlight", "com.hwh.spotlight");
        PACKAGES.put("timer", "com.bsd.timer");
        PACKAGES.put("split", null);
    }

    static Intent resolve(Context context, String tool) {
        if (tool == null || !PACKAGES.containsKey(tool)) throw new IllegalArgumentException("未知的大屏工具");
        Intent intent = "split".equals(tool)
            ? new Intent("bsd.intent.action.SPLITE_SCREEN")
            : context.getPackageManager().getLaunchIntentForPackage(PACKAGES.get(tool));
        if (intent == null || intent.resolveActivity(context.getPackageManager()) == null) return null;
        return intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }
}
