package com.fcjy.fcboard;

import static org.junit.Assert.*;
import android.Manifest;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.SdkSuppress;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.InputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real production buttons → WebView MediaRecorder → native Download files. */
@RunWith(AndroidJUnit4.class)
@SdkSuppress(minSdkVersion=29)
public class RecordingFlowTest {
    private android.webkit.WebView web;
    private String evaluate(String script) throws Exception {
        CountDownLatch completed=new CountDownLatch(1); AtomicReference<String> value=new AtomicReference<>();
        new Handler(Looper.getMainLooper()).post(()->web.evaluateJavascript(script,result->{value.set(result);completed.countDown();}));
        assertTrue("Recording UI task must finish",completed.await(5,TimeUnit.SECONDS)); return value.get();
    }
    private void until(String script) throws Exception {
        for(int attempt=0;attempt<100;attempt++) { if("true".equals(evaluate(script)))return; Thread.sleep(200); }
        fail("Recording state missing: "+script+"; "+evaluate("Array.from(document.querySelectorAll('[role=alert],[role=status]')).map(n=>n.textContent).join(' | ')"));
    }
    private void clickText(String text) throws Exception {
        String match="Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==="+JSONObject.quote(text)+")";
        until("!!("+match+")"); evaluate(match+".click();true");
    }
    @Test public void recordingStopAutomaticallyWritesPlayableMediaAndTranscriptWithoutAiOrAnExportClick() throws Exception {
        android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
        android.content.Context context=instrumentation.getTargetContext();
        instrumentation.getUiAutomation().grantRuntimePermission(context.getPackageName(),Manifest.permission.RECORD_AUDIO);
        JSONArray exported=new JSONArray();
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity->web=activity.getBridge().getWebView());
            try {
                until("!!document.querySelector('.fc-unified-toolbar')");
                JSONObject settings=new JSONObject().put("speech","local").put("apiKey","").put("speechKey","").put("autoSummary",false);
                evaluate("window.__fcBeforeReload=true;localStorage.setItem('fcboard-settings',"+JSONObject.quote(settings.toString())+");sessionStorage.removeItem('fcboard-keys');localStorage.setItem('fcboard-language','zh-CN');location.reload();true");
                until("!window.__fcBeforeReload&&!!document.querySelector('[data-teaching-tools]')");
                evaluate("document.querySelector('[data-teaching-tools]').click();true");
                until("!!document.querySelector('.fc-menu-pages button:last-child')");
                evaluate("document.querySelector('.fc-menu-pages button:last-child').click();true");
                clickText("录制"); clickText("仅麦克风"); clickText("开始录制");
                until("!!document.querySelector('.fc-recording-widget:not([hidden])')");
                Thread.sleep(2500); // Record real microphone frames, including emulator silence.
                evaluate("document.querySelector('.fc-recording-widget button[aria-label=\"停止录制\"]').click();true");
                until("document.body.textContent.includes('Download/Fcboard')");
                evaluate("window.__fcRecordedFile=null;(()=>{const r=indexedDB.open('fcboard-recordings');r.onsuccess=()=>{const db=r.result;const q=db.transaction('sessions').objectStore('sessions').get('recordings');q.onsuccess=()=>{const v=q.result.find(r=>r.savedFiles?.length);window.__fcRecordedFile=v?{id:v.id,size:v.blob?.size||v.data?.byteLength,duration:v.duration,files:v.savedFiles,location:v.savedLocation}:false;db.close()}}})();true");
                until("!!window.__fcRecordedFile");
                JSONObject record=new JSONObject(evaluate("window.__fcRecordedFile"));
                assertTrue("MediaRecorder must produce actual bytes",record.getLong("size")>128);
                assertTrue("A real recording duration is required",record.getDouble("duration")>=2);
                assertEquals("Download/Fcboard",record.getString("location"));
                exported=record.getJSONArray("files"); assertTrue(exported.length()>=2);
                try(InputStream media=context.getContentResolver().openInputStream(Uri.parse(exported.getString(0)))) {
                    assertNotNull(media); assertTrue("The saved media must be readable",media.read(new byte[512])>0);
                }
                try(InputStream transcript=context.getContentResolver().openInputStream(Uri.parse(exported.getString(1)))) { assertNotNull("The transcript file must actually exist",transcript); }
                android.media.MediaMetadataRetriever retriever=new android.media.MediaMetadataRetriever();
                try {
                    retriever.setDataSource(context,Uri.parse(exported.getString(0)));
                    assertTrue("Android must recognize the saved media duration",Long.parseLong(retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION))>=1000);
                } finally { retriever.release(); }
            } finally { evaluate("localStorage.removeItem('fcboard-settings');sessionStorage.removeItem('fcboard-keys');true"); }
        } finally { for(int index=0;index<exported.length();index++)context.getContentResolver().delete(Uri.parse(exported.getString(index)),null,null); }
    }
}
