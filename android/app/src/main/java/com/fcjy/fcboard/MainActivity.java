package com.fcjy.fcboard;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
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
