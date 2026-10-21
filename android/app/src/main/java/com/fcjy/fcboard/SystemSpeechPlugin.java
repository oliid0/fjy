package com.fcjy.fcboard;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.ArrayList;
import java.util.Locale;

/** One final-result session, owned and released entirely on Android's main thread. */
@CapacitorPlugin(name = "FcboardSystemSpeech", permissions = {
    @Permission(strings = {Manifest.permission.RECORD_AUDIO}, alias = "speechRecognition")
})
public class SystemSpeechPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private PluginCall pending;
    private Runnable timeout;

    @PluginMethod
    public void available(PluginCall call) {
        main.post(() -> {
            JSObject result = new JSObject();
            result.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()) || onDeviceAvailable());
            call.resolve(result);
        });
    }

    private boolean onDeviceAvailable() {
        return Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext());
    }

    @PluginMethod
    public void start(PluginCall call) {
        main.post(() -> {
            if (getPermissionState("speechRecognition") != PermissionState.GRANTED) {
                call.reject("Microphone permission denied", "permission"); return;
            }
            if (pending != null) { call.reject("Recognition already running", "busy"); return; }
            pending = call;
            try {
                recognizer = Build.VERSION.SDK_INT >= 31 && !SpeechRecognizer.isRecognitionAvailable(getContext()) && onDeviceAvailable() ? SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext()) : SpeechRecognizer.createSpeechRecognizer(getContext());
                recognizer.setRecognitionListener(new RecognitionListener() {
                    public void onReadyForSpeech(Bundle params) {}
                    public void onBeginningOfSpeech() {}
                    public void onRmsChanged(float value) {}
                    public void onBufferReceived(byte[] buffer) {}
                    public void onEndOfSpeech() {}
                    public void onPartialResults(Bundle results) {}
                    public void onEvent(int type, Bundle params) {}
                    public void onError(int code) {
                        if (pending != call) return;
                        release();
                        call.reject("Android speech error " + code, "speech-" + code);
                    }
                    public void onResults(Bundle results) {
                        if (pending != call) return;
                        ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        JSArray values = new JSArray();
                        if (matches != null) for (String text : matches) if (text != null && !text.trim().isEmpty()) values.put(text.trim());
                        release();
                        JSObject result = new JSObject(); result.put("matches", values); call.resolve(result);
                    }
                });
                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("language", Locale.getDefault().toLanguageTag()));
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
                timeout = () -> {
                    if (pending == call) { release(); call.reject("Speech timed out", "speech-6"); }
                };
                main.postDelayed(timeout, 30000);
                recognizer.startListening(intent);
            } catch (Exception error) { release(); call.reject("Android speech unavailable", "unavailable", error); }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            PluginCall previous = pending;
            release();
            if (previous != null) previous.reject("Speech cancelled", "cancelled");
            call.resolve();
        });
    }

    private void release() {
        pending = null;
        if (timeout != null) main.removeCallbacks(timeout);
        timeout = null;
        SpeechRecognizer previous = recognizer;
        recognizer = null;
        if (previous != null) {
            try { previous.cancel(); } catch (Exception ignored) {}
            try { previous.destroy(); } catch (Exception ignored) {}
        }
    }
    @Override
    protected void handleOnPause() {
        main.post(() -> {
            PluginCall previous = pending;
            release();
            if (previous != null) previous.reject("Speech interrupted", "cancelled");
        });
    }
    @Override
    protected void handleOnDestroy() { handleOnPause(); }
}
