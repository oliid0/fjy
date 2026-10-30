package com.fcjy.fcboard;

import java.util.Date;
import java.util.List;
import java.util.Properties;
import javax.activation.DataHandler;
import javax.mail.*;
import javax.mail.internet.*;
import javax.mail.util.ByteArrayDataSource;
import org.json.JSONObject;

/** SMTP and optional IMAP sent-copy use the same authenticated account and real MIME attachments. */
final class MailDelivery {
    static final class Attachment {
        final String name,mime; final byte[] bytes;
        Attachment(String name,String mime,byte[] bytes){this.name=name;this.mime=mime;this.bytes=bytes;}
    }
    static void validate(JSONObject account) throws Exception {
        new InternetAddress(account.getString("address"),true).validate();
        String host=account.getString("host"),security=account.optString("security","tls");
        int port=account.optInt("port",465);
        if(host.isEmpty() || host.length()>253 || host.matches(".*[\\s/\\\\].*") || port<1 || port>65535 || !java.util.Arrays.asList("tls","starttls","none").contains(security))throw new IllegalArgumentException("Invalid SMTP server settings");
        if(account.optString("secret").isEmpty())throw new IllegalArgumentException("Enter the mailbox authorization code");
    }
    static Properties properties(JSONObject account,String protocol) {
        Properties props=new Properties();String prefix="mail."+protocol+".";
        props.setProperty(prefix+"host",account.optString(protocol.equals("smtp")?"host":"imapHost"));
        props.setProperty(prefix+"port",Integer.toString(account.optInt(protocol.equals("smtp")?"port":"imapPort",protocol.equals("smtp")?465:993)));
        props.setProperty(prefix+"connectiontimeout","10000");props.setProperty(prefix+"timeout","15000");props.setProperty(prefix+"writetimeout","15000");
        props.setProperty(prefix+"ssl.checkserveridentity","true");
        String security=account.optString(protocol.equals("smtp")?"security":"imapSecurity","tls");
        props.setProperty(prefix+"ssl.enable",Boolean.toString("tls".equals(security)));
        props.setProperty(prefix+"starttls.enable",Boolean.toString("starttls".equals(security)));
        props.setProperty(prefix+"starttls.required",Boolean.toString("starttls".equals(security)));
        if(protocol.equals("smtp"))props.setProperty(prefix+"auth","true");
        return props;
    }
    static Transport connect(JSONObject account) throws Exception {
        validate(account);Session session=Session.getInstance(properties(account,"smtp"));Transport transport=session.getTransport("smtp");
        try{transport.connect(account.getString("host"),account.optInt("port",465),account.optString("username",account.getString("address")),account.getString("secret"));return transport;}
        catch(Exception error){try{transport.close();}catch(Exception ignored){}throw error;}
    }
    static MimeMessage message(JSONObject account,String to,String subject,String body,List<Attachment> attachments) throws Exception {
        validate(account);if(to.length()>4000 || subject.length()>1000 || body.length()>100000)throw new IllegalArgumentException("Mail content is too long");
        InternetAddress[] recipients=InternetAddress.parse(to.replace(';',','),true);if(recipients.length<1 || recipients.length>100)throw new IllegalArgumentException("Enter valid recipients");for(InternetAddress recipient:recipients)recipient.validate();
        MimeMessage message=new MimeMessage(Session.getInstance(properties(account,"smtp")));
        message.setFrom(new InternetAddress(account.getString("address")));message.setRecipients(Message.RecipientType.TO,recipients);message.setSubject(subject,"UTF-8");message.setSentDate(new Date());
        MimeMultipart content=new MimeMultipart("mixed");MimeBodyPart text=new MimeBodyPart();text.setText(body,"UTF-8");content.addBodyPart(text);
        long total=0;for(Attachment file:attachments){total+=file.bytes.length;if(total>25*1024*1024)throw new IllegalArgumentException("Email attachments exceed 25 MB");MimeBodyPart part=new MimeBodyPart();part.setDataHandler(new DataHandler(new ByteArrayDataSource(file.bytes,file.mime)));part.setFileName(MimeUtility.encodeText(file.name,"UTF-8",null));part.setDisposition(Part.ATTACHMENT);content.addBodyPart(part);}
        message.setContent(content);message.saveChanges();return message;
    }
    static void archive(JSONObject account,MimeMessage message) throws Exception {
        String host=account.optString("imapHost");if(host.isEmpty())return;
        Session session=Session.getInstance(properties(account,"imap"));Store store=session.getStore("imap");
        try{store.connect(host,account.optInt("imapPort",993),account.optString("username",account.getString("address")),account.getString("secret"));Folder sent=store.getFolder(account.optString("sentFolder","Sent"));if(!sent.exists() && !sent.create(Folder.HOLDS_MESSAGES))throw new MessagingException("Cannot create Sent folder");message.setFlag(Flags.Flag.SEEN,true);sent.appendMessages(new Message[]{message});}
        finally{if(store.isConnected())store.close();}
    }
}
