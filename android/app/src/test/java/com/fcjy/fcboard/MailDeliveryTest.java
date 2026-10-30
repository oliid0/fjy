package com.fcjy.fcboard;
import static org.junit.Assert.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import javax.mail.*;
import javax.mail.internet.MimeMessage;
import org.json.JSONObject;
import org.junit.Test;
public class MailDeliveryTest {
 private JSONObject account(int port)throws Exception{return new JSONObject().put("address","teacher@example.test").put("username","teacher@example.test").put("secret","test-authorization").put("host","127.0.0.1").put("port",port).put("security","none");}
 @Test public void sendsRealUtf8MultipartAttachmentsThroughAnAuthenticatedLoopbackSmtpServer()throws Exception{
  ExecutorService executor=Executors.newSingleThreadExecutor();
  try(ServerSocket listener=new ServerSocket(0,1,InetAddress.getLoopbackAddress())){
   listener.setSoTimeout(10000);
   Future<String> received=executor.submit(()->{
    try(Socket client=listener.accept();BufferedReader input=new BufferedReader(new InputStreamReader(client.getInputStream(),StandardCharsets.UTF_8));PrintWriter output=new PrintWriter(new OutputStreamWriter(client.getOutputStream(),StandardCharsets.UTF_8),true)){
     client.setSoTimeout(10000);output.println("220 local-test ESMTP");StringBuilder mime=new StringBuilder();String line;int auth=0;boolean data=false;
     while((line=input.readLine())!=null){
      if(data){if(line.equals(".")){data=false;output.println("250 message accepted");}else mime.append(line).append("\r\n");continue;}
      if(auth==1){assertEquals("teacher@example.test",new String(Base64.getDecoder().decode(line),StandardCharsets.UTF_8));auth=2;output.println("334 UGFzc3dvcmQ6");continue;}
      if(auth==2){assertEquals("test-authorization",new String(Base64.getDecoder().decode(line),StandardCharsets.UTF_8));auth=3;output.println("235 authenticated");continue;}
      if(line.startsWith("EHLO")){output.println("250-local-test");output.println("250 AUTH LOGIN");}
      else if(line.startsWith("AUTH LOGIN")){String[] command=line.split(" ");if(command.length>2){assertEquals("teacher@example.test",new String(Base64.getDecoder().decode(command[2]),StandardCharsets.UTF_8));auth=2;output.println("334 UGFzc3dvcmQ6");}else{auth=1;output.println("334 VXNlcm5hbWU6");}}
      else if(line.startsWith("MAIL FROM:")||line.startsWith("RCPT TO:")){assertEquals(3,auth);output.println("250 ok");}
      else if(line.equals("DATA")){data=true;output.println("354 send message");}
      else if(line.equals("QUIT")){output.println("221 bye");break;}
      else output.println("250 ok");
     }return mime.toString();
    }
   });
   JSONObject account=account(listener.getLocalPort());
   MimeMessage message=MailDelivery.message(account,"student@example.test","牛顿定律","本节板书",Collections.singletonList(new MailDelivery.Attachment("board.pdf","application/pdf",new byte[]{1,2,3,4})));
   try(Transport transport=MailDelivery.connect(account)){transport.sendMessage(message,message.getAllRecipients());}
   String raw=received.get(10,TimeUnit.SECONDS);assertTrue(raw.contains("multipart/mixed"));
   MimeMessage decoded=new MimeMessage(Session.getInstance(new Properties()),new ByteArrayInputStream(raw.getBytes(StandardCharsets.UTF_8)));
   assertEquals("牛顿定律",decoded.getSubject());Multipart parts=(Multipart)decoded.getContent();assertEquals(2,parts.getCount());
   assertEquals("本节板书",parts.getBodyPart(0).getContent().toString().trim());assertEquals("board.pdf",parts.getBodyPart(1).getFileName());
   try(InputStream input=parts.getBodyPart(1).getInputStream()){assertArrayEquals(new byte[]{1,2,3,4},input.readAllBytes());}
  }finally{executor.shutdownNow();}
 }
 @Test public void validatesRecipientsAndEnforcesTlsWithoutTrustingArbitraryServers()throws Exception{
  JSONObject account=account(465).put("security","tls");Properties props=MailDelivery.properties(account,"smtp");
  assertEquals("true",props.getProperty("mail.smtp.ssl.enable"));assertEquals("true",props.getProperty("mail.smtp.ssl.checkserveridentity"));assertNull(props.getProperty("mail.smtp.ssl.trust"));
  account.put("security","starttls");assertEquals("true",MailDelivery.properties(account,"smtp").getProperty("mail.smtp.starttls.required"));
  try{MailDelivery.message(account,"not an address","topic","body",Collections.emptyList());fail();}catch(javax.mail.internet.AddressException expected){}
 }
}
