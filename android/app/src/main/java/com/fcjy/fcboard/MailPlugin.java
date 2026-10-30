package com.fcjy.fcboard;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.security.KeyStore;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import javax.mail.*;
import javax.mail.internet.MimeMessage;
import org.json.*;

/** Account secrets stay encrypted in the Android keystore; inspection never returns them. */
@CapacitorPlugin(name="FcboardMail")
public class MailPlugin extends Plugin {
 private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private final LinkedHashMap<String,JSObject> deliveries=new LinkedHashMap<>();
 private static final String ALIAS="fcboard-mail-accounts";
 private javax.crypto.SecretKey key() throws Exception {
  KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
  if(store.containsAlias(ALIAS))return (javax.crypto.SecretKey)store.getKey(ALIAS,null);
  KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());return generator.generateKey();
 }
 private JSONArray accounts() throws Exception {
  String saved=getContext().getSharedPreferences(ALIAS,Context.MODE_PRIVATE).getString("accounts","");if(saved.isEmpty())return new JSONArray();
  String[] parts=saved.split(":",2);if(parts.length!=2)throw new IOException("Invalid stored mail accounts");Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));return new JSONArray(new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),java.nio.charset.StandardCharsets.UTF_8));
 }
 private void persist(JSONArray accounts) throws Exception {
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());String value=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(accounts.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)),Base64.NO_WRAP);
  if(!getContext().getSharedPreferences(ALIAS,Context.MODE_PRIVATE).edit().putString("accounts",value).commit())throw new IOException("Cannot save mail account");
 }
 private JSONObject account(String id) throws Exception {JSONArray all=accounts();for(int i=0;i<all.length();i++)if(id.equals(all.getJSONObject(i).optString("id")))return all.getJSONObject(i);throw new IOException("Mailbox account no longer exists");}
 private JSObject publicAccount(JSONObject account) throws Exception {JSObject result=new JSObject(account.toString());result.remove("secret");result.put("hasSecret",true);return result;}
 @PluginMethod public void list(PluginCall call){worker.execute(()->{try{JSONArray all=accounts();JSArray result=new JSArray();for(int i=0;i<all.length();i++)result.put(publicAccount(all.getJSONObject(i)));call.resolve(new JSObject().put("accounts",result));}catch(Exception e){call.reject(e.getMessage(),e);}});}
 @PluginMethod public void save(PluginCall call){worker.execute(()->{try{
  JSObject input=call.getObject("account");if(input==null)throw new IOException("Enter mailbox settings");JSONObject next=new JSONObject(input.toString());String id=next.optString("id");
  if(id.isEmpty())id=UUID.randomUUID().toString();else if(next.optString("secret").isEmpty())next.put("secret",account(id).getString("secret"));next.put("id",id);
  if(next.optString("username").isEmpty())next.put("username",next.optString("address"));
  try(Transport connection=MailDelivery.connect(next)){if(!connection.isConnected())throw new IOException("SMTP authentication failed");}
  JSONArray all=accounts(),updated=new JSONArray();for(int i=0;i<all.length();i++)if(!id.equals(all.getJSONObject(i).optString("id")))updated.put(all.getJSONObject(i));if(updated.length()>=10)throw new IOException("At most ten mailboxes");updated.put(next);persist(updated);call.resolve(publicAccount(next));
 }catch(Exception e){call.reject(e.getMessage(),e);}});}
 @PluginMethod public void remove(PluginCall call){worker.execute(()->{try{String id=call.getString("id","");JSONArray all=accounts(),updated=new JSONArray();for(int i=0;i<all.length();i++)if(!id.equals(all.getJSONObject(i).optString("id")))updated.put(all.getJSONObject(i));persist(updated);call.resolve();}catch(Exception e){call.reject(e.getMessage(),e);}});}
 @PluginMethod public void send(PluginCall call){worker.execute(()->{try{
  String request=call.getString("request","");if(!request.matches("[a-fA-F0-9-]{36}"))throw new IOException("Invalid mail request");if(deliveries.containsKey(request)){call.resolve(deliveries.get(request));return;}
  JSONObject account=account(call.getString("id",""));List<MailDelivery.Attachment> attachments=new ArrayList<>();
  JSArray pages=call.getArray("pages");if(pages==null || pages.length()<1 || pages.length()>20)throw new IOException("Choose 1–20 board pages");
  android.content.Intent bundle=BoardAttachments.createMail(getContext(),pages,call.getString("format","pdf"),call.getString("title","Meeting Record"));
  ArrayList<android.net.Uri> uris=new ArrayList<>();android.content.ClipData clip=bundle.getClipData();
  if(clip!=null)for(int index=0;index<clip.getItemCount();index++)uris.add(clip.getItemAt(index).getUri());
  if(uris.isEmpty())throw new IOException("No board attachment");
  for(int i=0;i<uris.size();i++){android.net.Uri uri=uris.get(i);ByteArrayOutputStream output=new ByteArrayOutputStream();try(InputStream input=getContext().getContentResolver().openInputStream(uri)){if(input==null)throw new IOException("Cannot read board attachment");byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1){if(output.size()+count>25*1024*1024)throw new IOException("Attachment is too large");output.write(buffer,0,count);}}
   boolean pdf="pdf".equals(call.getString("format","pdf"));attachments.add(new MailDelivery.Attachment(pdf?"meeting.pdf":"Fcboard-"+(i+1)+".png",pdf?"application/pdf":"image/png",output.toByteArray()));}
  MimeMessage message=MailDelivery.message(account,call.getString("to",""),call.getString("subject",""),call.getString("body",""),attachments);
  try(Transport transport=MailDelivery.connect(account)){transport.sendMessage(message,message.getAllRecipients());}
  JSObject result=new JSObject().put("sent",true).put("archived",false).put("messageId",message.getMessageID());deliveries.put(request,result);while(deliveries.size()>100)deliveries.remove(deliveries.keySet().iterator().next());
  if(!account.optString("imapHost").isEmpty()){try{MailDelivery.archive(account,message);result.put("archived",true);}catch(Exception archiveError){result.put("warning",archiveError.getMessage());}}
  call.resolve(result);
 }catch(Exception e){call.reject(e.getMessage(),e);}});}
 @Override protected void handleOnDestroy(){worker.shutdown();}
}
