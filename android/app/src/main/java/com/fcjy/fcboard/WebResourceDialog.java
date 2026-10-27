package com.fcjy.fcboard;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import java.util.HashMap;
import java.util.Map;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.graphics.Bitmap;
import com.getcapacitor.JSArray;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import android.widget.ImageButton;
import android.content.Context;
import android.content.res.Configuration;
import java.util.Locale;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.json.JSONObject;
import org.json.JSONTokener;

/** HMinWebWindow's in-app browsing flow, with the same controls available to the board agent. */
final class WebResourceDialog extends Dialog {
    final WebView web;
    private final TextView status;
    private final Context text;
    private final ImageButton back;
    private final ImageButton forward;
    private final android.view.View.OnLayoutChangeListener displayLayout =
        (view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> resizeToDisplay();
    private int displayWidth;
    private int displayHeight;
    private final String controlRuntime;
    private int pageEpoch;
    private boolean loading = true;
    private boolean pageFailed;
    private String lastVersion;
    private String lastNavigation;
    private final String navigationSession = java.util.UUID.randomUUID().toString();
    private int navigationRevision;
    private final Handler controlTimer = new Handler(Looper.getMainLooper());
    private final Map<PluginCall, Runnable> pendingControls = new HashMap<>();

    private void cancelControls(String reason) {
        for (PluginCall call : new java.util.ArrayList<>(pendingControls.keySet())) rejectControl(call, reason);
    }

    private void rejectControl(PluginCall call, String reason) {
        Runnable timeout = pendingControls.remove(call);
        if (timeout == null) return;
        controlTimer.removeCallbacks(timeout);
        call.reject(reason);
    }

    private void resolveControl(PluginCall call, JSObject response) {
        Runnable timeout = pendingControls.remove(call);
        if (timeout == null) return;
        controlTimer.removeCallbacks(timeout);
        call.resolve(response);
    }

    private static String readRuntime(Context context) {
        try (InputStream input = context.getAssets().open("web-controls.js");
            ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int size;
            while ((size = input.read(buffer)) != -1) output.write(buffer, 0, size);
            return output.toString(StandardCharsets.UTF_8.name());
        } catch (Exception error) { throw new IllegalStateException("Web controls are unavailable", error); }
    }

    static String checkedUrl(String value) {
        Uri uri = Uri.parse(value == null ? "" : value.trim());
        if (!("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) || uri.getHost() == null || uri.getUserInfo() != null) throw new IllegalArgumentException("Enter a complete http or https URL");
        return uri.toString();
    }

    WebResourceDialog(Activity activity, String url) { this(activity, url, Locale.getDefault().toLanguageTag()); }
    WebResourceDialog(Activity activity, String url, String language) {
        super(activity);
        Configuration config = new Configuration(activity.getResources().getConfiguration());
        config.setLocale(Locale.forLanguageTag(language));
        text = activity.createConfigurationContext(config);
        controlRuntime = readRuntime(activity);
        setCanceledOnTouchOutside(false);
        setOwnerActivity(activity);
        requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);
        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        android.graphics.drawable.GradientDrawable surface = new android.graphics.drawable.GradientDrawable();
        surface.setColor(Color.WHITE);
        surface.setCornerRadius(dp(16));
        root.setBackground(surface);
        root.setClipToOutline(true);
        LinearLayout controls = new LinearLayout(activity);
        controls.setGravity(Gravity.CENTER_VERTICAL);
        web = new WebView(activity);
        status = new TextView(activity);
        controls.setGravity(Gravity.CENTER);
        back = button(controls, R.drawable.factory_web_goback, R.string.web_back, () -> navigate("back"));
        forward = button(controls, R.drawable.factory_web_goback, R.string.web_forward, () -> navigate("forward"));
        forward.setRotation(180);
        back.setEnabled(false); forward.setEnabled(false);
        button(controls, R.drawable.factory_web_refresh, R.string.web_reload, () -> navigate("reload"));
        button(controls, R.drawable.factory_web_close, R.string.web_close, this::dismiss);
        status.setPadding(12, 4, 12, 4);
        root.addView(status);
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        root.addView(controls);
        setContentView(root);
        web.getSettings().setUseWideViewPort(true);
        web.getSettings().setLoadWithOverviewMode(true);
        web.getSettings().setSupportZoom(true);
        web.getSettings().setBuiltInZoomControls(true);
        web.getSettings().setDisplayZoomControls(false);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                try { checkedUrl(request.getUrl().toString()); return false; }
                catch (Exception unsupported) { status.setText(text.getString(R.string.web_external_app)); return true; }
            }
            @Override public void onPageStarted(WebView view, String current, Bitmap favicon) {
                cancelControls("WEB_PAGE_CHANGED_READ_AGAIN");
                pageEpoch++;
                loading = true;
                pageFailed = false;
                lastVersion = null;
                back.setEnabled(view.canGoBack());
                forward.setEnabled(view.canGoForward());
            }
            @Override public void onPageFinished(WebView view, String current) {
                loading = false;
                lastVersion = null;
                lastNavigation = null;
                if (!pageFailed) status.setText(view.getTitle());
                back.setEnabled(view.canGoBack());
                forward.setEnabled(view.canGoForward());
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) {
                    pageFailed = true;
                    status.setText(text.getString(R.string.web_load_failed));
                }
            }
        });
        setOnDismissListener(dialog -> {
            cancelControls("WEB_PAGE_CLOSED");
            activity.getWindow().getDecorView().removeOnLayoutChangeListener(displayLayout);
            root.removeView(web); web.stopLoading(); web.destroy();
        });
        web.loadUrl(checkedUrl(url));
    }

    private int dp(int value) { return Math.round(value * getContext().getResources().getDisplayMetrics().density); }
    private ImageButton button(LinearLayout row, int icon, int label, Runnable action) {
        ImageButton button = new ImageButton(getContext());
        button.setImageResource(icon); button.setContentDescription(text.getString(label));
        button.setBackgroundResource(android.R.drawable.list_selector_background);
        button.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
        button.setPadding(dp(8), dp(8), dp(8), dp(8));
        LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(dp(40), dp(40));
        size.setMargins(dp(8), 0, dp(8), 0); row.addView(button, size);
        button.setOnClickListener(view -> action.run()); return button;
    }

    @Override public void show() {
        super.show();
        getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
        getOwnerActivity().getWindow().getDecorView().addOnLayoutChangeListener(displayLayout);
        resizeToDisplay();
        getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL);
        getWindow().setGravity(Gravity.CENTER);
    }

    private void resizeToDisplay() {
        if (!isShowing() || getWindow() == null) return;
        android.graphics.Rect bounds = new android.graphics.Rect();
        getOwnerActivity().getWindow().getDecorView().getWindowVisibleDisplayFrame(bounds);
        if (bounds.width() == 0) bounds.set(0, 0, getContext().getResources().getDisplayMetrics().widthPixels, getContext().getResources().getDisplayMetrics().heightPixels);
        if (displayWidth == bounds.width() && displayHeight == bounds.height()) return;
        displayWidth = bounds.width();
        displayHeight = bounds.height();
        getWindow().setLayout(Math.min(dp(960), (int)(displayWidth * 0.9)), Math.min(dp(640), (int)(displayHeight * 0.82)));
    }

    private void navigate(String action) {
        if (("back".equals(action) && !web.canGoBack()) || ("forward".equals(action) && !web.canGoForward())) return;
        cancelControls("WEB_PAGE_CHANGED_READ_AGAIN");
        pageEpoch++;
        loading = true;
        pageFailed = false;
        lastVersion = null;
        if ("back".equals(action)) web.goBack();
        else if ("forward".equals(action)) web.goForward();
        else web.reload();
    }

    private String navigationState() {
        return new JSArray().put(pageEpoch).put(loading).put(web.getUrl())
            .put(web.canGoBack()).put(web.canGoForward()).toString();
    }

    private JSObject pageState(boolean open) {
        if (open) {
            String current = navigationState();
            if (!current.equals(lastNavigation)) lastVersion = null;
            lastNavigation = current;
            if (lastVersion == null) lastVersion = "navigation:" + navigationSession + ":" + (++navigationRevision);
        }
        JSObject result = new JSObject();
        result.put("open", open);
        result.put("loading", open && loading);
        result.put("url", web.getUrl());
        result.put("title", web.getTitle());
        result.put("canGoBack", open && web.canGoBack());
        result.put("canGoForward", open && web.canGoForward());
        result.put("message", status.getText().toString());
        result.put("controls", new JSArray());
        if (lastVersion != null) result.put("version", lastVersion);
        return result;
    }

    private void readControls(JSObject args, PluginCall call, int epoch, boolean reread) {
        if (!pendingControls.containsKey(call)) return;
        try {
            String script = controlRuntime + "\nwindow.fcNativeWebControls(JSON.parse(" + JSONObject.quote(args.toString()) + "))";
            web.evaluateJavascript(script, result -> {
                if (!pendingControls.containsKey(call)) return;
                try {
                    if (!isShowing() || pageEpoch != epoch) {
                        rejectControl(call, "WEB_PAGE_CHANGED_READ_AGAIN");
                        return;
                    }
                    Object decoded = new JSONTokener(result).nextValue();
                    if (!(decoded instanceof String)) throw new IllegalStateException("Web page is not ready");
                    JSObject response = new JSObject((String) decoded);
                    if (response.has("error")) { rejectControl(call, response.getString("error")); return; }
                    if (reread) {
                        // Read on the next UI turn so DOM updates triggered by the real event can commit.
                        web.post(() -> {
                            if (!isShowing() || pageEpoch != epoch) { rejectControl(call, "WEB_PAGE_CHANGED_READ_AGAIN"); return; }
                            JSObject read = new JSObject(); read.put("action", "read");
                            readControls(read, call, epoch, false);
                        });
                        return;
                    }
                    lastVersion = response.getString("version");
                    lastNavigation = navigationState();
                    response.put("open", true);
                    response.put("loading", loading);
                    response.put("canGoBack", web.canGoBack());
                    response.put("canGoForward", web.canGoForward());
                    response.put("message", status.getText().toString());
                    resolveControl(call, response);
                } catch (Exception error) { rejectControl(call, "Could not read web controls"); }
            });
        } catch (RuntimeException error) { rejectControl(call, "Could not read web controls"); }
    }

    void action(JSObject args, PluginCall call) {
        try {
            String action = args.optString("action", "read");
            if (!java.util.Arrays.asList("read", "click", "set", "scroll", "key", "back", "forward", "reload", "close").contains(action)) {
                call.reject("WEB_ACTION_INVALID"); return;
            }
            if ("close".equals(action)) {
                JSObject result = pageState(false);
                dismiss(); call.resolve(result); return;
            }
            if ("read".equals(action) && loading) { call.resolve(pageState(true)); return; }
            if (!"read".equals(action) && (lastVersion == null || !lastVersion.equals(args.optString("version"))
                || !navigationState().equals(lastNavigation))) {
                call.reject("WEB_STATE_CHANGED_READ_AGAIN"); return;
            }
            if ("back".equals(action) || "forward".equals(action) || "reload".equals(action)) {
                if (("back".equals(action) && !web.canGoBack()) || ("forward".equals(action) && !web.canGoForward())) {
                    call.reject("WEB_HISTORY_UNAVAILABLE"); return;
                }
                navigate(action);
                call.resolve(pageState(true)); return;
            }
            if (loading) { call.reject("WEB_PAGE_LOADING_READ_AGAIN"); return; }
            Runnable timeout = () -> rejectControl(call, "WEB_CONTROL_TIMEOUT");
            pendingControls.put(call, timeout);
            controlTimer.postDelayed(timeout, 5000);
            readControls(args, call, pageEpoch, !"read".equals(action));
        } catch (Exception error) {
            if (pendingControls.containsKey(call)) rejectControl(call, "Could not control web page");
            else call.reject("Could not control web page", error);
        }
    }
}
