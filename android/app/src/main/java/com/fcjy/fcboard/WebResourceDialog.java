package com.fcjy.fcboard;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.net.Uri;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
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
        setCanceledOnTouchOutside(false);
        setOwnerActivity(activity);
        requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);
        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        LinearLayout controls = new LinearLayout(activity);
        controls.setGravity(Gravity.CENTER_VERTICAL);
        web = new WebView(activity);
        status = new TextView(activity);
        controls.setGravity(Gravity.CENTER);
        back = button(controls, R.drawable.factory_web_goback, R.string.web_back, () -> { if (web.canGoBack()) web.goBack(); });
        forward = button(controls, R.drawable.factory_web_goback, R.string.web_forward, () -> { if (web.canGoForward()) web.goForward(); });
        forward.setRotation(180);
        back.setEnabled(false); forward.setEnabled(false);
        button(controls, R.drawable.factory_web_refresh, R.string.web_reload, web::reload);
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
            @Override public void onPageFinished(WebView view, String current) { status.setText(view.getTitle()); back.setEnabled(view.canGoBack()); forward.setEnabled(view.canGoForward()); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) status.setText(text.getString(R.string.web_load_failed));
            }
        });
        setOnDismissListener(dialog -> { root.removeView(web); web.stopLoading(); web.destroy(); });
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
        android.graphics.Rect bounds = new android.graphics.Rect();
        getWindow().getDecorView().getWindowVisibleDisplayFrame(bounds);
        if (bounds.width() == 0) bounds.set(0, 0, getContext().getResources().getDisplayMetrics().widthPixels, getContext().getResources().getDisplayMetrics().heightPixels);
        getWindow().setLayout(Math.min(dp(400), (int)(bounds.width() * 0.86)), Math.min(dp(600), (int)(bounds.height() * 0.82)));
        getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL);
        getWindow().setGravity(Gravity.CENTER);
    }

    void action(JSObject args, PluginCall call) {
        String action = args.optString("action", "read");
        if ("close".equals(action)) { dismiss(); call.resolve(); return; }
        if ("back".equals(action)) { if (web.canGoBack()) web.goBack(); call.resolve(); return; }
        if ("forward".equals(action)) { if (web.canGoForward()) web.goForward(); call.resolve(); return; }
        if ("reload".equals(action)) { web.reload(); call.resolve(); return; }
        if (!java.util.Arrays.asList("read", "click", "set", "scroll", "key").contains(action)) { call.reject("网页操作不存在"); return; }
        String script = "JSON.stringify((()=>{try{const a=JSON.parse(" + JSONObject.quote(args.toString()) + ");"
            + "if(a.action==='scroll'){const x=Number(a.x||0),y=Number(a.y||0);if(!Number.isFinite(x+y)||Math.abs(x)>5000||Math.abs(y)>5000)throw Error('滚动距离无效');window.scrollBy(x,y);}"
            + "if(['click','set','key'].includes(a.action)){if(typeof a.selector!=='string'||a.selector.length>500)throw Error('缺少控件选择器');const el=document.querySelector(a.selector);if(!el||el.disabled||el.getAttribute('aria-disabled')==='true')throw Error('网页控件不可用');"
            + "if(a.action==='click')el.click();"
            + "if(a.action==='set'){if(!['INPUT','TEXTAREA','SELECT'].includes(el.tagName))throw Error('控件不能输入，请使用按键操作');const p=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,String(a.value??''));el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}"
            + "if(a.action==='key'){if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' ','Home','End'].includes(a.key))throw Error('按键不支持');el.focus();el.dispatchEvent(new KeyboardEvent('keydown',{key:a.key,bubbles:true}));el.dispatchEvent(new KeyboardEvent('keyup',{key:a.key,bubbles:true}));}}"
            + "const controls=[...document.querySelectorAll('button,input,select,textarea,a[href],[role=button],[role=slider]')].slice(0,200).map((el,i)=>{el.dataset.fcControl=String(i);return{selector:'[data-fc-control=\"'+i+'\"]',role:el.getAttribute('role')||el.tagName.toLowerCase(),label:el.getAttribute('aria-label')||el.innerText||el.getAttribute('title')||el.name||'',value:el.value??el.getAttribute('aria-valuenow'),disabled:!!el.disabled};});"
            + "return{url:location.href,title:document.title,text:(document.body?.innerText||'').slice(0,12000),controls};}catch(e){return{error:String(e.message||e)};}})())";
        web.evaluateJavascript(script, result -> {
            try {
                Object decoded = new JSONTokener(result).nextValue();
                if (!(decoded instanceof String)) throw new IllegalStateException("网页尚未准备好");
                JSObject response = new JSObject((String) decoded);
                if (response.has("error")) call.reject(response.getString("error")); else call.resolve(response);
            } catch (Exception error) { call.reject("无法读取网页控件", error); }
        });
    }
}
