package com.fcjy.fcboard;

import static org.junit.Assert.*;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipFile;
import org.junit.Test;

public class RecordingPackageTest {
    @Test public void savesExactlyThreeFilesWithRealMediaAndUnicodeText() throws Exception {
        File cache = Files.createTempDirectory("fcboard-recording-test").toFile();
        RecordingPackage item = new RecordingPackage(cache, 4, "video/webm;codecs=vp8,opus", "[00:01] Newton: F=ma", "# Summary\nAcceleration changes with force.");
        try {
            item.append(0, new byte[]{1,2});item.append(2, new byte[]{3,4});item.finish();
            try (ZipFile zip = new ZipFile(item.archive)) {
                assertEquals(3, zip.size());
                assertArrayEquals(new byte[]{1,2,3,4}, zip.getInputStream(zip.getEntry("recording.webm")).readAllBytes());
                assertEquals(item.transcript, new String(zip.getInputStream(zip.getEntry("transcript.txt")).readAllBytes(), StandardCharsets.UTF_8));
                assertEquals(item.summary, new String(zip.getInputStream(zip.getEntry("summary.md")).readAllBytes(), StandardCharsets.UTF_8));
            }
        } finally { item.close();assertFalse(item.directory.exists());cache.delete(); }
    }
    @Test public void rejectsReorderedOverflowAndIncompleteChunksWithoutPublishingPartialFiles() throws Exception {
        File cache = Files.createTempDirectory("fcboard-recording-test").toFile();
        RecordingPackage item = new RecordingPackage(cache, 2, "audio/webm", "Words", "Summary");
        try {
            assertThrows(java.io.IOException.class, () -> item.append(1, new byte[]{1}));
            assertThrows(java.io.IOException.class, () -> item.append(0, new byte[]{1,2,3}));
            item.append(0, new byte[]{1});
            assertThrows(java.io.IOException.class, item::finish);
            assertFalse(item.isComplete());
            item.append(1, new byte[]{2});item.finish();
            assertThrows(java.io.IOException.class, () -> item.append(2, new byte[]{3}));
        } finally { item.close();cache.delete(); }
    }
}
