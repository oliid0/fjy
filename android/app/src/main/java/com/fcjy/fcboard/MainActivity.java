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
    void nativeSceneCommitted(String owner) { if(inkInput!=null)inkInput.sceneCommitted(owner); }
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
    @Override public boolean dispatchTouchEvent(MotionEvent event) {
        if (!startupReleased) return true;
        NativeInkPlugin input = inkInput;
        if (input != null && input.dispatchInput(event, super::dispatchTouchEvent)) return true;
        return super.dispatchTouchEvent(event);
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
        registerPlugin(NativeWidgetsPlugin.class);
        registerPlugin(NativeInkPlugin.class);
        registerPlugin(NativeScenePlugin.class);
        registerPlugin(NativeEraserPlugin.class);
        registerPlugin(SystemSpeechPlugin.class);
        registerPlugin(NetworkPlugin.class);
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
            getBridge().getWebView().getSettings().setMinimumFontSize(1);
            getBridge().getWebView().getSettings().setMinimumLogicalFontSize(1);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    @Override public void onDestroy() {
        if (startupSplash != null) { startupSplash.remove(); startupSplash = null; }
        super.onDestroy();
    }
}
