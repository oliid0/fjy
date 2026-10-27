package com.fcjy.fcboard;

import static org.junit.Assert.*;
import java.io.IOException;
import org.junit.Test;

public class BoardAttachmentsPolicyTest {
    @Test public void boundsTheWholePdfRasterBudgetAndUsesSampledDecoding() throws Exception {
        for (int pages = 1; pages <= 20; pages++) {
            for (int[] source : new int[][]{{4096, 4096}, {3840, 2160}, {2160, 3840}, {1200, 800}}) {
                BoardAttachments.PdfPageSpec spec = new BoardAttachments.PdfPageSpec(source[0], source[1], pages);
                assertTrue((long) spec.width * spec.height * pages <= BoardAttachments.PdfPageSpec.TOTAL_PIXELS);
                assertTrue(spec.width <= 1440 && spec.height <= 1440);
                assertTrue(spec.width <= source[0] && spec.height <= source[1]);
                assertEquals(0, spec.sampleSize & (spec.sampleSize - 1));
                assertTrue(source[0] / spec.sampleSize >= spec.width);
                assertTrue(source[1] / spec.sampleSize >= spec.height);
            }
        }
        assertTrue(new BoardAttachments.PdfPageSpec(4096, 4096, 20).sampleSize > 1);
    }

    @Test public void preservesPageGeometryAndAspectWhenMorePagesReduceRasterQuality() throws Exception {
        BoardAttachments.PdfPageSpec one = new BoardAttachments.PdfPageSpec(3840, 2160, 1);
        BoardAttachments.PdfPageSpec twenty = new BoardAttachments.PdfPageSpec(3840, 2160, 20);
        assertEquals(1440, one.pageWidth);
        assertEquals(810, one.pageHeight);
        assertEquals(one.pageWidth, twenty.pageWidth);
        assertEquals(one.pageHeight, twenty.pageHeight);
        assertTrue(twenty.width < one.width);
        assertTrue(Math.abs((double) twenty.width / twenty.height - 16.0 / 9) < 0.01);
        BoardAttachments.PdfPageSpec thin = new BoardAttachments.PdfPageSpec(1, 4096, 20);
        assertEquals(1, thin.pageWidth);
        assertEquals(4096, thin.pageHeight);
    }

    @Test public void neverUpscalesSmallPagesAndRejectsInvalidDimensionsBeforeAllocation() throws Exception {
        BoardAttachments.PdfPageSpec small = new BoardAttachments.PdfPageSpec(12, 8, 20);
        assertEquals(12, small.width);
        assertEquals(8, small.height);
        assertEquals(1, small.sampleSize);
        assertThrows(IOException.class, () -> new BoardAttachments.PdfPageSpec(0, 100, 1));
        assertThrows(IOException.class, () -> new BoardAttachments.PdfPageSpec(4097, 100, 1));
        assertThrows(IOException.class, () -> new BoardAttachments.PdfPageSpec(100, 100, 21));
    }
}
