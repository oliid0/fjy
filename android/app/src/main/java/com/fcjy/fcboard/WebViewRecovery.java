package com.fcjy.fcboard;

import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.WebViewListener;

/** Recover the Capacitor surface, never reload an unusable WebView instance. */
final class WebViewRecovery extends WebViewListener {
    private final MainActivity activity;
    private boolean handled;

    private WebViewRecovery(MainActivity activity) { this.activity = activity; }

    static void install(MainActivity activity) {
        if (activity.getBridge() != null) activity.getBridge().addWebViewListener(new WebViewRecovery(activity));
    }

    @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        if (handled) return true;
        if (activity.getBridge() == null || view != activity.getBridge().getWebView()) return false;
        handled = true;
        android.util.Log.e("FcboardWebView", detail.didCrash()
            ? "Whiteboard renderer crashed; awaiting explicit recovery"
            : "Whiteboard renderer reclaimed; awaiting explicit recovery");
        // Android requires removing and destroying this specific failed view.
        // The existing BoardBook reloads its last persisted workspace when the
        // new Capacitor Activity starts; no JS can run in the failed renderer.
        if (view.getParent() instanceof ViewGroup) ((ViewGroup)view.getParent()).removeView(view);
        view.destroy();
        new Handler(Looper.getMainLooper()).post(() -> {
            if (activity.isFinishing() || activity.isDestroyed()) return;
            new android.app.AlertDialog.Builder(activity)
                .setTitle(R.string.app_name)
                .setMessage(R.string.webview_recovery_message)
                .setPositiveButton(R.string.web_reload, (dialog, which) -> activity.recreate())
                .setNegativeButton(R.string.web_close, (dialog, which) -> activity.finish())
                .setCancelable(false)
                .show();
        });
        return true;
    }
}
