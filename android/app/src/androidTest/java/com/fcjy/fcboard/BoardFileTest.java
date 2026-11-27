package com.fcjy.fcboard;
import static org.junit.Assert.*;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;
@RunWith(AndroidJUnit4.class)
public class BoardFileTest {
 private JSObject invoke(ActivityScenario<MainActivity> scenario, String method, JSObject args, Uri selected) throws Exception {
  CountDownLatch done = new CountDownLatch(1);
  AtomicReference<JSObject> result = new AtomicReference<>();
  AtomicReference<String> error = new AtomicReference<>();
  // Cross the same JSON parse boundary as WebView: small numbers become Integer.
  JSObject parsed = new JSObject(args.toString());
  PluginCall call = new PluginCall(null, "FcboardBoardFile", "file-test", method, parsed) {
   @Override public void resolve() { resolve(new JSObject()); }
   @Override public void resolve(JSObject value) {
    result.set(value);
    done.countDown();
   }
   @Override public void reject(String message, String code, Exception failure, JSObject data) {
    error.set(message);
    done.countDown();
   }
  };
  scenario.onActivity(activity -> {
   try {
    BoardFilePlugin plugin = (BoardFilePlugin) activity.getBridge().getPlugin("FcboardBoardFile").getInstance();
    if (selected == null) {
     BoardFilePlugin.class.getMethod(method, PluginCall.class).invoke(plugin, call);
    } else {
     Method callback = BoardFilePlugin.class.getDeclaredMethod(method, PluginCall.class, ActivityResult.class);
     callback.setAccessible(true);
     callback.invoke(plugin, call, new ActivityResult(Activity.RESULT_OK, new Intent().setData(selected)));
    }
   } catch (Exception failure) {
    error.set(failure.toString());
    done.countDown();
   }
  });
  assertTrue("Native file operation must settle: " + method, done.await(20, TimeUnit.SECONDS));
  assertNull(error.get(), error.get());
  return result.get();
 }
 @Test public void javascriptIntegerSizesAndOffsetsTransferEveryBzdByte() throws Exception {
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  StringBuilder text = new StringBuilder("<bzd><slide><fcboard version=\"2\">{\"text\":\"");
  for (int index = 0; index < 45000; index++) text.append("笔迹对象");
  byte[] bytes = text.append("\"}</fcboard></slide></bzd>").toString().getBytes(StandardCharsets.UTF_8);
  File file = File.createTempFile("bzd-numbers-", ".bzd", context.getCacheDir());
  try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
   Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
   JSObject session = invoke(scenario, "begin", new JSObject().put("size", bytes.length), null);
   String writeId = session.getString("id");
   assertNotNull(writeId);
   try {
    for (int offset = 0; offset < bytes.length; offset += 262144) {
     int count = Math.min(262144, bytes.length - offset);
     String data = Base64.encodeToString(bytes, offset, count, Base64.NO_WRAP);
     invoke(scenario, "append", new JSObject().put("id", writeId).put("offset", offset).put("data", data), null);
    }
    // Provide the storage access framework result without a device picker.
    JSObject saved = invoke(scenario, "saved", new JSObject().put("id", writeId), uri);
    assertTrue(saved.getBool("saved"));
   } finally {
    invoke(scenario, "close", new JSObject().put("id", writeId), null);
   }
   JSObject chosen = invoke(scenario, "chosen", new JSObject().put("requestId", "bzd-numbers"), uri);
   String readId = chosen.getString("id");
   assertNotNull(readId);
   assertEquals(bytes.length, chosen.getLong("size"));
   ByteArrayOutputStream restored = new ByteArrayOutputStream();
   try {
    for (long offset = 0; offset < bytes.length;) {
     JSObject chunk = invoke(scenario, "read", new JSObject().put("id", readId).put("offset", offset), null);
     byte[] part = Base64.decode(chunk.getString("data"), Base64.DEFAULT);
     assertTrue(part.length > 0);
     assertEquals(offset + part.length, chunk.getLong("next"));
     restored.write(part);
     offset += part.length;
    }
    assertArrayEquals(bytes, restored.toByteArray());
    assertEquals("bzd", BoardFilePlugin.readXml(file).getDocumentElement().getTagName());
   } finally {
    invoke(scenario, "close", new JSObject().put("id", readId), null);
    InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> scenario.onActivity(MainActivity::finish));
   }
  } finally {
   file.delete();
  }
 }
 @Test public void androidParserReadsFactoryBzdAndRejectsExternalEntities() throws Exception {
  File file=File.createTempFile("bzd-test-",".bzd",InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir());
  try {
   try(FileOutputStream out=new FileOutputStream(file)){out.write("<?xml version=\"1.0\" encoding=\"UTF-8\"?><bzd><slide name=\"牛顿力学\" zSlideColor=\"-16777216\"><object eType=\"OBJECT_TEXT\" text=\"标题\"><lstPt>10,20,false,</lstPt></object><fcboard version=\"1\">{\"files\":{}}</fcboard></slide></bzd>".getBytes(StandardCharsets.UTF_8));}
   org.w3c.dom.Document xml=BoardFilePlugin.readXml(file);
   assertEquals("bzd",xml.getDocumentElement().getTagName());assertEquals("牛顿力学",((org.w3c.dom.Element)xml.getElementsByTagName("slide").item(0)).getAttribute("name"));
   try(FileOutputStream out=new FileOutputStream(file)){out.write("<!DOCTYPE bzd [<!ENTITY x SYSTEM 'file:///private'>]><bzd>&x;</bzd>".getBytes(StandardCharsets.UTF_8));}
   try{BoardFilePlugin.readXml(file);fail("External entities must fail");}catch(java.io.IOException expected){assertTrue(expected.getMessage().contains("DTD"));}
  }finally{file.delete();}
 }
}
