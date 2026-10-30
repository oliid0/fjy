package com.fcjy.fcboard;
import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import org.junit.Test;
import org.junit.runner.RunWith;
@RunWith(AndroidJUnit4.class)
public class BoardFileTest {
 @Test public void svgAssetsBecomeTransparentFactoryPngWithoutLosingTheirAspectRatio() throws Exception {
  String svg="<svg xmlns='http://www.w3.org/2000/svg' width='100' height='60' viewBox='0 0 100 60'><rect x='20' y='10' width='60' height='40' fill='#ff0000'/></svg>";
  for(String data:new String[]{"data:image/svg+xml;base64,"+android.util.Base64.encodeToString(svg.getBytes(StandardCharsets.UTF_8),android.util.Base64.NO_WRAP),"data:image/svg+xml,"+java.net.URLEncoder.encode(svg,"UTF-8").replace("+","%20")}){
   byte[] bytes=BoardFilePlugin.compatibleImage(data);
   android.graphics.Bitmap bitmap=android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.length);
   try{assertEquals(100,bitmap.getWidth());assertEquals(60,bitmap.getHeight());assertEquals(0,android.graphics.Color.alpha(bitmap.getPixel(0,0)));assertEquals(android.graphics.Color.RED,bitmap.getPixel(50,30));}
   finally{bitmap.recycle();}
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
