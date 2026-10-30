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
import android.widget.SeekBar;
import android.widget.ProgressBar;
import android.widget.FrameLayout;
import android.view.MotionEvent;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.json.JSONObject;
import org.json.JSONTokener;

/** HMinWebWindow's in-app browsing flow, with the same controls available to the board agent. */
final class WebResourceDialog extends Dialog {
    final WebView web;
    final TextView moveHandle;
    final ImageButton resizeHandle;
    private final TextView status;
    private final Context text;
    private final ImageButton back;
    private final ImageButton forward;
    private final SeekBar horizontal;
    private final ProgressBar spinner;
    private final Runnable syncHorizontal = this::syncHorizontalScroll;
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
    WebResourceDialog(Activity activity, String url, String language) { this(activity, url, language, ignored -> {}); }
    WebResourceDialog(Activity activity, String url, String language, java.util.function.Consumer<JSObject> selected) {
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
        moveHandle = new TextView(activity);
        moveHandle.setText(Uri.parse(url).getHost());
        moveHandle.setTextSize(13);
        moveHandle.setSingleLine(true);
        moveHandle.setEllipsize(android.text.TextUtils.TruncateAt.END);
        moveHandle.setPadding(dp(12), 0, dp(12), 0);
        moveHandle.setGravity(Gravity.CENTER_VERTICAL);
        moveHandle.setContentDescription(text.getString(R.string.web_move));
        moveHandle.setOnTouchListener(windowGesture(false));
        root.addView(moveHandle, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(28)));
        LinearLayout controls = new LinearLayout(activity);
        controls.setGravity(Gravity.CENTER_VERTICAL);
        web = new WebView(activity);
        status = new TextView(activity);
        status.setVisibility(android.view.View.GONE);
        spinner = new ProgressBar(activity);
        horizontal = new SeekBar(activity);
        horizontal.setMax(1000);
        horizontal.setPadding(dp(10), 0, dp(10), 0);
        horizontal.setEnabled(false);
        horizontal.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onStartTrackingTouch(SeekBar bar) {}
            @Override public void onStopTrackingTouch(SeekBar bar) { syncHorizontalScroll(); }
            @Override public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (fromUser) web.evaluateJavascript("(function(){var e=window.__fcHorizontalTarget;if(e&&e.isConnected)e.scrollLeft=Math.max(0,e.scrollWidth-e.clientWidth)*" + progress + "/1000;})()", null);
            }
        });
        final float[] touch = new float[2];
        final int[] touchPage = new int[1];
        web.setOnTouchListener((view, event) -> {
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) { touch[0] = event.getX(); touch[1] = event.getY(); touchPage[0] = pageEpoch; }
            return false;
        });
        web.setOnLongClickListener(view -> {
            final int expectedPage = pageEpoch;
            if (loading || touchPage[0] != expectedPage) return true;
            float scale = Math.max(0.1f, web.getScale());
            String script = "(function(){var e=document.elementFromPoint(" + (touch[0] / scale) + "," + (touch[1] / scale) + ");if(!e)return null;var i=e.closest('img')||e.querySelector('img');if(i)return {kind:'image',value:i.currentSrc||i.src};var t=(e.innerText||'').trim();return t?{kind:'text',value:t.slice(0,10000)}:null;})()";
            web.evaluateJavascript(script, raw -> {
                if (!isShowing() || expectedPage != pageEpoch) return;
                try {
                    JSONObject value = new JSONObject(raw);
                    String kind = value.optString("kind"), content = value.optString("value");
                    if (content.isEmpty() || !("image".equals(kind) || "text".equals(kind))) return;
                    if ("image".equals(kind)) checkedUrl(content);
                    selected.accept(new JSObject().put("kind", kind).put("value", content));
                } catch (Exception ignored) { /* A navigation can remove the pressed node. */ }
            });
            return true;
        });
        controls.setGravity(Gravity.CENTER);
        back = button(controls, R.drawable.factory_web_goback, R.string.web_back, () -> navigate("back"));
        forward = button(controls, R.drawable.factory_web_goback, R.string.web_forward, () -> navigate("forward"));
        forward.setRotation(180);
        back.setEnabled(false); forward.setEnabled(false);
        button(controls, R.drawable.factory_web_refresh, R.string.web_reload, () -> navigate("reload"));
        button(controls, R.drawable.factory_web_close, R.string.web_close, this::dismiss);
        status.setPadding(12, 4, 12, 4);
        root.addView(status);
        FrameLayout content = new FrameLayout(activity);
        content.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        content.addView(spinner, new FrameLayout.LayoutParams(dp(110), dp(110), Gravity.CENTER));
        root.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        root.addView(horizontal, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(18)));
        LinearLayout footer = new LinearLayout(activity);
        footer.setGravity(Gravity.CENTER_VERTICAL);
        footer.addView(controls, new LinearLayout.LayoutParams(0, dp(40), 1));
        resizeHandle = new ImageButton(activity);
        resizeHandle.setImageResource(R.drawable.factory_web_resize);
        resizeHandle.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
        resizeHandle.setBackgroundColor(Color.TRANSPARENT);
        resizeHandle.setPadding(dp(4), dp(4), dp(4), dp(4));
        resizeHandle.setContentDescription(text.getString(R.string.web_resize));
        resizeHandle.setOnTouchListener(windowGesture(true));
        footer.addView(resizeHandle, new LinearLayout.LayoutParams(dp(28), dp(28)));
        root.addView(footer);
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
                catch (Exception unsupported) { status.setVisibility(android.view.View.VISIBLE); status.setText(text.getString(R.string.web_external_app)); return true; }
            }
            @Override public void onPageStarted(WebView view, String current, Bitmap favicon) {
                cancelControls("WEB_PAGE_CHANGED_READ_AGAIN");
                pageEpoch++;
                loading = true;
                spinner.setVisibility(android.view.View.VISIBLE);
                status.setVisibility(android.view.View.GONE);
                pageFailed = false;
                lastVersion = null;
                back.setEnabled(view.canGoBack());
                forward.setEnabled(view.canGoForward());
            }
            @Override public void onPageFinished(WebView view, String current) {
                moveHandle.setText(view.getTitle());
                loading = false;
                spinner.setVisibility(android.view.View.GONE);
                lastVersion = null;
                lastNavigation = null;
                if (!pageFailed) status.setVisibility(android.view.View.GONE);
                controlTimer.postDelayed(syncHorizontal, 500);
                controlTimer.postDelayed(syncHorizontal, 1500);
                back.setEnabled(view.canGoBack());
                forward.setEnabled(view.canGoForward());
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) {
                    pageFailed = true;
                    spinner.setVisibility(android.view.View.GONE);
                    status.setVisibility(android.view.View.VISIBLE);
                    status.setText(text.getString(R.string.web_load_failed));
                }
            }
        });
        setOnDismissListener(dialog -> {
            cancelControls("WEB_PAGE_CLOSED");
            controlTimer.removeCallbacksAndMessages(null);
            activity.getWindow().getDecorView().removeOnLayoutChangeListener(displayLayout);
            content.removeView(web); web.stopLoading(); web.destroy();
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
    }

    private void resizeToDisplay() {
        if (!isShowing() || getWindow() == null) return;
        android.graphics.Rect bounds = new android.graphics.Rect();
        getOwnerActivity().getWindow().getDecorView().getWindowVisibleDisplayFrame(bounds);
        if (bounds.width() == 0) bounds.set(0, 0, getContext().getResources().getDisplayMetrics().widthPixels, getContext().getResources().getDisplayMetrics().heightPixels);
        if (displayWidth == bounds.width() && displayHeight == bounds.height()) return;
        boolean first = displayWidth == 0;
        displayWidth = bounds.width();
        displayHeight = bounds.height();
        android.view.WindowManager.LayoutParams current = getWindow().getAttributes();
        int width = first ? Math.min(dp(400), (int)(displayWidth * 0.9)) : current.width;
        int height = first ? Math.min(dp(600), (int)(displayHeight * 0.82)) : current.height;
        setWindowBounds(first ? (displayWidth - width) / 2 : current.x,
            first ? (displayHeight - height) / 2 : current.y, width, height);
    }

    /** ZXStudyFloatingWindow.setupTouchLogic / handleDragEvent / handleResizeEvent. */
    private android.view.View.OnTouchListener windowGesture(boolean resizing) {
        return new android.view.View.OnTouchListener() {
            private android.view.WindowManager.LayoutParams before;
            private float rawX, rawY;
            private int screenWidth, screenHeight;
            @Override public boolean onTouch(android.view.View view, MotionEvent event) {
                if (!isShowing() || getWindow() == null) return false;
                if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                    before = new android.view.WindowManager.LayoutParams(); before.copyFrom(getWindow().getAttributes());
                    rawX = event.getRawX(); rawY = event.getRawY();
                    screenWidth = displayWidth; screenHeight = displayHeight; return true;
                }
                if (before == null) return false;
                if (screenWidth != displayWidth || screenHeight != displayHeight) { before = null; return true; }
                if (event.getActionMasked() == MotionEvent.ACTION_CANCEL || event.getPointerCount() > 1) {
                    getWindow().setAttributes(before); before = null; return true;
                }
                if (event.getActionMasked() == MotionEvent.ACTION_MOVE) {
                    int x = Math.round(event.getRawX() - rawX), y = Math.round(event.getRawY() - rawY);
                    setWindowBounds(resizing ? before.x : before.x + x, resizing ? before.y : before.y + y,
                        resizing ? before.width + x : before.width, resizing ? before.height + y : before.height);
                    return true;
                }
                if (event.getActionMasked() == MotionEvent.ACTION_UP) { before = null; view.performClick(); return true; }
                return true;
            }
        };
    }

    private void setWindowBounds(int x, int y, int width, int height) {
        android.view.WindowManager.LayoutParams next = getWindow().getAttributes();
        next.gravity = Gravity.TOP | Gravity.LEFT;
        next.width = Math.max(Math.min(dp(260), displayWidth), Math.min(displayWidth, width));
        next.height = Math.max(Math.min(dp(180), displayHeight), Math.min(displayHeight, height));
        next.x = Math.max(0, Math.min(displayWidth - next.width, x));
        next.y = Math.max(0, Math.min(displayHeight - next.height, y));
        getWindow().setAttributes(next);
    }

    private JSObject windowBounds() {
        android.view.WindowManager.LayoutParams current = getWindow().getAttributes();
        JSObject bounds = new JSObject(); bounds.put("x", current.x); bounds.put("y", current.y);
        bounds.put("width", current.width); bounds.put("height", current.height); return bounds;
    }

    private void syncHorizontalScroll() {
        if (!isShowing() || loading) return;
        final int expected = pageEpoch;
        web.evaluateJavascript("(function(){var all=[document.scrollingElement,...document.querySelectorAll('*')],best=null,score=0;for(var e of all){if(!e)continue;var r=e.getBoundingClientRect(),max=e.scrollWidth-e.clientWidth;if(max>1&&e.clientWidth>0&&r.bottom>0&&r.top<innerHeight){var s=max*Math.min(r.height,innerHeight);if(s>score){score=s;best=e;}}}window.__fcHorizontalTarget=best;return best?{max:best.scrollWidth-best.clientWidth,x:best.scrollLeft}:{max:0,x:0};})()", raw -> {
            if (!isShowing() || expected != pageEpoch) return;
            try {
                JSONObject state = new JSONObject(raw);
                double max = state.optDouble("max", 0);
                horizontal.setEnabled(max > 1);
                horizontal.setProgress(max > 1 ? (int)Math.round(1000 * state.optDouble("x", 0) / max) : 0);
            } catch (Exception ignored) {}
        });
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
        result.put("window", windowBounds());
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
                    response.put("window", windowBounds());
                    resolveControl(call, response);
                } catch (Exception error) { rejectControl(call, "Could not read web controls"); }
            });
        } catch (RuntimeException error) { rejectControl(call, "Could not read web controls"); }
    }

    void action(JSObject args, PluginCall call) {
        try {
            String action = args.optString("action", "read");
            if (!java.util.Arrays.asList("read", "click", "set", "scroll", "key", "back", "forward", "reload", "close", "move", "resize").contains(action)) {
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
            if ("move".equals(action) || "resize".equals(action)) {
                android.view.WindowManager.LayoutParams current = getWindow().getAttributes();
                String first = "move".equals(action) ? "x" : "width", second = "move".equals(action) ? "y" : "height";
                double a = args.optDouble(first, Double.NaN), b = args.optDouble(second, Double.NaN);
                if (!Double.isFinite(a) || !Double.isFinite(b) || Math.abs(a) > 100000 || Math.abs(b) > 100000) { call.reject("WEB_WINDOW_BOUNDS_INVALID"); return; }
                setWindowBounds("move".equals(action) ? (int)a : current.x, "move".equals(action) ? (int)b : current.y,
                    "resize".equals(action) ? (int)a : current.width, "resize".equals(action) ? (int)b : current.height);
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
