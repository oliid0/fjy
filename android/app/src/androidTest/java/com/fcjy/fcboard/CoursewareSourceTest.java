package com.fcjy.fcboard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.webkit.WebResourceResponse;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class CoursewareSourceTest {
    private static String text(WebResourceResponse response) throws Exception {
        try (InputStream input = response.getData()) {
            java.io.ByteArrayOutputStream result = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[64];
            int count;
            while ((count = input.read(chunk)) != -1) result.write(chunk, 0, count);
            return result.toString("UTF-8");
        }
    }

    @Test public void servesExactByteRangesAndHeadWithoutReadingTheRest() throws Exception {
        File file = File.createTempFile("courseware-test-", ".pdf",
            InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir());
        try {
            Files.write(file.toPath(), "%PDF-abcdefghij".getBytes(StandardCharsets.UTF_8));
            WebResourceResponse partial = CoursewareSource.serve(file, "bytes=5-7", false);
            assertEquals(206, partial.getStatusCode());
            assertEquals("bytes 5-7/15", partial.getResponseHeaders().get("Content-Range"));
            assertEquals("3", partial.getResponseHeaders().get("Content-Length"));
            assertEquals("abc", text(partial));
            WebResourceResponse suffix = CoursewareSource.serve(file, "bytes=-2", false);
            assertEquals("ij", text(suffix));
            WebResourceResponse head = CoursewareSource.serve(file, null, true);
            assertEquals(200, head.getStatusCode());
            assertEquals("15", head.getResponseHeaders().get("Content-Length"));
            assertEquals("", text(head));
            WebResourceResponse missing = CoursewareSource.serve(file, "bytes=20-", false);
            assertEquals(416, missing.getStatusCode());
            assertEquals("bytes */15", missing.getResponseHeaders().get("Content-Range"));
            assertNotNull(missing.getData());
            assertEquals("", text(missing));
        } finally {
            assertTrue(file.delete());
        }
    }
}
