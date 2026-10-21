package com.fcjy.fcboard;

import android.content.Context;
import android.content.Intent;
import java.util.LinkedHashMap;
import java.util.Map;

/** Package names and split action verified in HWhiteBoard 5.42's HGizmoSettingWindow. */
final class FactoryTools {
    static final Map<String, String> PACKAGES = new LinkedHashMap<>();
    static final Map<String, String[]> INSERTIONS = new LinkedHashMap<>();
    static {
        PACKAGES.put("transfer", "com.bsd.fastfile");
        PACKAGES.put("vote", "com.bsd.vote.android");
        PACKAGES.put("calculator", "com.bsd.bsdcalculator");
        PACKAGES.put("spotlight", "com.hwh.spotlight");
        PACKAGES.put("timer", "com.bsd.timer");
        PACKAGES.put("split", null);
        // HInsertSettingWindow: WPS, the vendor file browser and the signal source.
        INSERTIONS.put("document", new String[]{"cn.wps.moffice_eng", "cn.wps.moffice_i18n"});
        INSERTIONS.put("media", new String[]{"com.hht.uc.FileBrowser"});
        INSERTIONS.put("signal", new String[]{"com.beststar.android.livetv"});
    }

    static Intent resolve(Context context, String tool) {
        if (tool == null || !PACKAGES.containsKey(tool)) throw new IllegalArgumentException("未知的大屏工具");
        Intent intent = "split".equals(tool)
            ? new Intent("bsd.intent.action.SPLITE_SCREEN")
            : context.getPackageManager().getLaunchIntentForPackage(PACKAGES.get(tool));
        if (intent == null || intent.resolveActivity(context.getPackageManager()) == null) return null;
        return intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    static Intent resolveInsertion(Context context, String insertion) {
        if (insertion == null || !INSERTIONS.containsKey(insertion)) throw new IllegalArgumentException("未知的插入应用");
        for (String name : INSERTIONS.get(insertion)) {
            Intent intent = context.getPackageManager().getLaunchIntentForPackage(name);
            if (intent != null && intent.resolveActivity(context.getPackageManager()) != null) return intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        return null;
    }
}
