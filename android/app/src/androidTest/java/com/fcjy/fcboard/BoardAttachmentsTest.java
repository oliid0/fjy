package com.fcjy.fcboard;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.JSArray;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class BoardAttachmentsTest {
    @Test public void sharesReadablePngAttachmentsWithTemporaryUriGrants() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        Bitmap source = Bitmap.createBitmap(12, 8, Bitmap.Config.ARGB_8888);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        source.compress(Bitmap.CompressFormat.PNG, 100, bytes);
        source.recycle();
        String image = "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
        JSArray pages = new JSArray(); pages.put(image); pages.put(image);
        Intent intent = BoardAttachments.create(context, pages);
        assertEquals(Intent.ACTION_SEND_MULTIPLE, intent.getAction());
        assertEquals("image/png", intent.getType());
        assertTrue((intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0);
        assertEquals(2, intent.getClipData().getItemCount());
        assertEquals(2, intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM).size());
        for (int index = 0; index < 2; index++) {
            android.net.Uri uri = intent.getClipData().getItemAt(index).getUri();
            assertEquals("content", uri.getScheme());
            assertEquals(context.getPackageName() + ".fileprovider", uri.getAuthority());
            try (InputStream input = context.getContentResolver().openInputStream(uri)) {
                Bitmap restored = BitmapFactory.decodeStream(input);
                assertNotNull(restored);
                assertEquals(12, restored.getWidth()); assertEquals(8, restored.getHeight());
                restored.recycle();
            }
        }
        JSArray single = new JSArray(); single.put(image);
        assertEquals(Intent.ACTION_SEND, BoardAttachments.create(context, single).getAction());
    }

    @Test public void rejectsEmptyAndInvalidAttachmentsBeforeOpeningAComposer() {
        Context context = ApplicationProvider.getApplicationContext();
        assertThrows(Exception.class, () -> BoardAttachments.create(context, new JSArray()));
        JSArray invalid = new JSArray(); invalid.put("data:image/png;base64,bm90LXB uZw==");
        assertThrows(Exception.class, () -> BoardAttachments.create(context, invalid));
    }
}
