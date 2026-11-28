package com.fcjy.fcboard;

import android.os.Bundle;
import android.view.WindowManager;
import android.view.MotionEvent;
import android.view.KeyEvent;
import com.getcapacitor.BridgeActivity;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.splashscreen.SplashScreenViewProvider;

public class MainActivity extends BridgeActivity {
    private SplashScreenViewProvider startupSplash;
    private final java.util.Set<String> presentedScenes = new java.util.HashSet<>();
    private String startupOwner = "";
    private boolean startupWebReady, startupFallback, startupReleased;
    boolean isBoardUsable() { return startupReleased; }

    void nativeScenePresented(String owner) {
        presentedScenes.add(owner);
        releaseStartup();
    }
    void boardReady(String owner, boolean fallback) {
        if (startupReleased) return;
        startupOwner = owner;
        startupFallback = fallback;
        android.webkit.WebView web = getBridge().getWebView();
        // The DOM signal follows toolbar commit and input configuration. Wait
        // for Chromium's visual state too, so removing the logo exposes that frame.
        web.postVisualStateCallback(0, new android.webkit.WebView.VisualStateCallback() {
            @Override public void onComplete(long requestId) {
                web.postOnAnimation(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    startupWebReady = true;
                    releaseStartup();
                });
            }
        });
    }
    private void releaseStartup() {
        if (!startupReleased && startupWebReady && (startupFallback || presentedScenes.contains(startupOwner))) {
            startupReleased = true;
            startup("board.usable");
        }
        if (startupReleased && startupSplash != null) {
            startupSplash.remove();
            startupSplash = null;
        }
    }
    static void startup(String phase) {
        android.util.Log.i("FcboardStartup",phase+" processMs="+(android.os.SystemClock.uptimeMillis()-android.os.Process.getStartUptimeMillis()));
    }
    private volatile NativeInkPlugin inkInput;
    private LocalInferencePlugin inference;
    void setInference(LocalInferencePlugin plugin){inference=plugin;}
    void inkActivity(){ModelPool.inkActivity();if(inference!=null)inference.inkActivity();}
    private NativeScenePlugin nativeScene;
    void setNativeScene(NativeScenePlugin scene) { nativeScene=scene; }
    NativeSceneView nativeScene(String owner) { return nativeScene==null?null:nativeScene.scene(owner); }
    void setInkSurface(String owner,NativeInkView input,android.widget.FrameLayout.LayoutParams bounds){
        if(nativeScene==null)throw new IllegalStateException("Native scene unavailable");
        nativeScene.setInput(owner,input,bounds);
    }
    void removeInkSurface(String owner,NativeInkView input){if(nativeScene!=null)nativeScene.removeInput(owner,input);}
    void setInkInput(NativeInkPlugin plugin) { inkInput = plugin; }
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        NativeInkPlugin input = inkInput;
        return input != null && input.dispatchKey(event) || super.dispatchKeyEvent(event);
    }
    // DecorView owns a single touch sequence. Keep its DOWN so locking the
    // sideboard mid-drag can cancel only that device's web/widget gesture.
    private MotionEvent windowDown;
    private boolean windowTouch(MotionEvent event) {
        int action = event.getActionMasked();
        if (action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
            if (windowDown != null) { windowDown.recycle(); windowDown = null; }
            if (action == MotionEvent.ACTION_DOWN) windowDown = MotionEvent.obtainNoHistory(event);
        }
        return super.dispatchTouchEvent(event);
    }
    void cancelPanelWindowTouch(int device) {
        if (windowDown == null || windowDown.getDeviceId() != device) return;
        MotionEvent cancel = windowDown;
        windowDown = null;
        cancel.setAction(MotionEvent.ACTION_CANCEL);
        try { super.dispatchTouchEvent(cancel); } finally { cancel.recycle(); }
    }
    @Override public boolean dispatchTouchEvent(MotionEvent event) {
        if (!startupReleased) return true;
        NativeInkPlugin input = inkInput;
        if (input != null && input.dispatchInput(event, this::windowTouch)) return true;
        return windowTouch(event);
    }
    private static volatile boolean foreground;
    static boolean isForeground() { return foreground; }
    @Override public void onResume() { super.onResume(); foreground = true; }
    @Override public void onPause() { foreground = false; super.onPause(); }
    @Override
    public void onCreate(Bundle savedInstanceState) {
        startup("activity.create");
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        registerPlugin(ClassroomPlugin.class);
        registerPlugin(RecordingExportPlugin.class);
        registerPlugin(LocalSpeechPlugin.class);
        registerPlugin(CloudSpeechPlugin.class);
        registerPlugin(DuplexSpeechPlugin.class);
        registerPlugin(OfflineTtsPlugin.class);
        registerPlugin(DigitalInkPlugin.class);
        registerPlugin(TranslationPlugin.class);
        registerPlugin(LocalInferencePlugin.class);
        registerPlugin(NativeInkPlugin.class);
        registerPlugin(NativeScenePlugin.class);
        registerPlugin(NativeEraserPlugin.class);
        registerPlugin(SystemSpeechPlugin.class);
        registerPlugin(NetworkPlugin.class);
        registerPlugin(ProjectionPlugin.class);
        registerPlugin(ProjectionNativePlugin.class);
        registerPlugin(VotingPlugin.class);
        registerPlugin(MediaPlugin.class);
        registerPlugin(BoardFilePlugin.class);
        registerPlugin(MailPlugin.class);
        registerPlugin(SkizzePenPlugin.class);
        super.onCreate(savedInstanceState);
        // Retain the actual launch view while the board renders underneath;
        // a keep-on-screen pre-draw predicate would prevent that rendering.
        splash.setOnExitAnimationListener(view -> { startupSplash = view; releaseStartup(); });
        WebViewRecovery.install(this);
        // Native toolbar labels are 6sp / 6.7dp. WebView defaults to an 8px minimum.
        // https://developer.android.com/reference/android/webkit/WebSettings#setMinimumFontSize(int)
        if (getBridge() != null && getBridge().getWebView() != null) {
            com.getcapacitor.Bridge bridge = getBridge();
            android.net.Uri origin = android.net.Uri.parse(bridge.getLocalUrl());
            bridge.setWebViewClient(new com.getcapacitor.BridgeWebViewClient(bridge) {
                @Override public android.webkit.WebResourceResponse shouldInterceptRequest(
                        android.webkit.WebView view, android.webkit.WebResourceRequest request) {
                    android.webkit.WebResourceResponse courseware =
                        CoursewareSource.intercept(MainActivity.this, origin, request);
                    return courseware != null ? courseware : super.shouldInterceptRequest(view, request);
                }
            });
            getBridge().getWebView().getSettings().setMinimumFontSize(1);
            getBridge().getWebView().getSettings().setMinimumLogicalFontSize(1);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused && getResources().getConfiguration().orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE) {
            androidx.core.view.WindowInsetsControllerCompat bars =
                androidx.core.view.WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            bars.setSystemBarsBehavior(androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            bars.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars());
        }
    }
    @Override public void onDestroy() {
        if (startupSplash != null) { startupSplash.remove(); startupSplash = null; }
        if (windowDown != null) { windowDown.recycle(); windowDown = null; }
        super.onDestroy();
    }
}
