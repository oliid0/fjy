package com.fcjy.fcboard;

import android.os.Bundle;
import android.view.WindowManager;
import android.view.MotionEvent;
import android.view.KeyEvent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private volatile NativeInkPlugin inkInput;
    private NativeScenePlugin nativeScene;
    void setNativeScene(NativeScenePlugin scene) { nativeScene=scene; }
    NativeSceneView nativeScene(String owner) { return nativeScene==null?null:nativeScene.scene(owner); }
    void nativeSceneCommitted(String owner) { if(inkInput!=null)inkInput.sceneCommitted(owner); }
    void setInkInput(NativeInkPlugin plugin) { inkInput = plugin; }
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        NativeInkPlugin input = inkInput;
        return input != null && input.dispatchKey(event) || super.dispatchKeyEvent(event);
    }
    @Override public boolean dispatchTouchEvent(MotionEvent event) {
        NativeInkPlugin input = inkInput;
        if (input != null && input.dispatchInput(event)) return true;
        return super.dispatchTouchEvent(event);
    }
    private static volatile boolean foreground;
    static boolean isForeground() { return foreground; }
    @Override public void onResume() { super.onResume(); foreground = true; }
    @Override public void onPause() { foreground = false; super.onPause(); }
    @Override
    public void onCreate(Bundle savedInstanceState) {
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
        WebViewRecovery.install(this);
        // Native toolbar labels are 6sp / 6.7dp. WebView defaults to an 8px minimum.
        // https://developer.android.com/reference/android/webkit/WebSettings#setMinimumFontSize(int)
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().getSettings().setMinimumFontSize(1);
            getBridge().getWebView().getSettings().setMinimumLogicalFontSize(1);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
