package com.fcjy.fcboard;

import android.util.Xml;
import java.io.File;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import org.xmlpull.v1.XmlPullParser;
import org.xmlpull.v1.XmlSerializer;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NamedNodeMap;
import org.w3c.dom.Node;

/** Supply the browser reader a Word segment containing only the requested page's body and assets. */
final class CoursewareWord {
    private static final String MAIN = "word/document.xml";
    private static final int MAX_BLOCKS = 24;
    private static final int MAX_PAGE_XML = 16 * 1024 * 1024;
    private static final Map<String, List<Segment>> indexes = new LinkedHashMap<>();

    private static final class Segment {
        final int first, last;
        Segment(int first, int last) { this.first = first; this.last = last; }
        boolean contains(int index) { return index >= first && index < last; }
    }

    private CoursewareWord() {}

    static int pageCount(File file) throws Exception {
        try (ZipFile zip = new ZipFile(file)) {
            return pages(file, zip).size();
        }
    }

    private static InputStream main(ZipFile zip) throws IOException {
        ZipEntry entry = zip.getEntry(MAIN);
        if (entry == null) throw new IOException("Word document missing");
        return zip.getInputStream(entry);
    }

    private static XmlPullParser parser(InputStream input) throws Exception {
        XmlPullParser parser = Xml.newPullParser();
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true);
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_DOCDECL, false);
        parser.setInput(input, null);
        return parser;
    }

    private static boolean hardBreak(XmlPullParser parser) {
        if ("lastRenderedPageBreak".equals(parser.getName())) return true;
        if (!"br".equals(parser.getName())) return false;
        for (int index = 0; index < parser.getAttributeCount(); index++) {
            if ("type".equals(parser.getAttributeName(index)) && "page".equals(parser.getAttributeValue(index))) return true;
        }
        return false;
    }

    private static synchronized List<Segment> pages(File file, ZipFile zip) throws Exception {
        String key = file.getAbsolutePath();
        List<Segment> cached = indexes.get(key);
        if (cached != null) return cached;
        List<Segment> segments = new ArrayList<>();
        int body = 0, index = 0, start = 0;
        boolean block = false, before = false, after = false;
        try (InputStream input = main(zip)) {
            XmlPullParser parser = parser(input);
            for (int event = parser.next(); event != XmlPullParser.END_DOCUMENT; event = parser.next()) {
                int depth = parser.getDepth();
                if (event == XmlPullParser.START_TAG) {
                    if (body == 0 && "body".equals(parser.getName())) body = depth;
                    else if (body > 0 && depth == body + 1) {
                        block = !"sectPr".equals(parser.getName());
                        before = after = false;
                    } else if (block) {
                        before |= "pageBreakBefore".equals(parser.getName());
                        after |= hardBreak(parser);
                    }
                } else if (event == XmlPullParser.END_TAG && body > 0 && depth == body + 1 && block) {
                    if (index > start && (before || index - start >= MAX_BLOCKS)) {
                        segments.add(new Segment(start, index));
                        start = index;
                    }
                    index++;
                    if (after) {
                        segments.add(new Segment(start, index));
                        start = index;
                    }
                    block = false;
                }
            }
        }
        if (body == 0) throw new IOException("Word body missing");
        if (start < index || segments.isEmpty()) segments.add(new Segment(start, index));
        if (indexes.size() == 4) indexes.remove(indexes.keySet().iterator().next());
        indexes.put(key, segments);
        return segments;
    }

    private static Document readSegment(ZipFile zip, Segment segment) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        XmlSerializer output = Xml.newSerializer();
        output.setOutput(bytes, "UTF-8");
        output.startDocument("UTF-8", true);
        int body = 0, index = 0, skippedDepth = 0;
        try (InputStream input = main(zip)) {
            XmlPullParser parser = parser(input);
            for (int event = parser.next(); event != XmlPullParser.END_DOCUMENT; event = parser.next()) {
                int depth = parser.getDepth();
                if (skippedDepth != 0) {
                    if (event == XmlPullParser.END_TAG && depth == skippedDepth) skippedDepth = 0;
                    continue;
                }
                if (event == XmlPullParser.START_TAG) {
                    if (body == 0 && "body".equals(parser.getName())) body = depth;
                    if (body > 0 && depth == body + 1 && !"sectPr".equals(parser.getName()) && !segment.contains(index++)) {
                        skippedDepth = depth;
                        continue;
                    }
                    if (body > 0 && depth > body + 1 &&
                            ("pageBreakBefore".equals(parser.getName()) || hardBreak(parser))) {
                        skippedDepth = depth;
                        continue;
                    }
                    int namespaceCount = parser.getNamespaceCount(depth);
                    for (int namespace = parser.getNamespaceCount(depth - 1); namespace < namespaceCount; namespace++) {
                        String prefix = parser.getNamespacePrefix(namespace);
                        output.setPrefix(prefix == null ? "" : prefix, parser.getNamespaceUri(namespace));
                    }
                    output.startTag(parser.getNamespace(), parser.getName());
                    for (int attribute = 0; attribute < parser.getAttributeCount(); attribute++) {
                        output.attribute(parser.getAttributeNamespace(attribute), parser.getAttributeName(attribute), parser.getAttributeValue(attribute));
                    }
                } else if (event == XmlPullParser.END_TAG) {
                    output.endTag(parser.getNamespace(), parser.getName());
                } else if (event == XmlPullParser.TEXT) {
                    output.text(parser.getText());
                }
                if (bytes.size() > MAX_PAGE_XML) throw new IOException("Oversized Word page");
            }
        }
        output.endDocument();
        if (bytes.size() > MAX_PAGE_XML) throw new IOException("Oversized Word page");
        return CoursewarePptx.parseXml(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
    }

    static void page(File file, int index, OutputStream output) throws Exception {
        try (ZipFile zip = new ZipFile(file); ZipOutputStream result = new ZipOutputStream(output)) {
            List<Segment> segments = pages(file, zip);
            if (index < 0 || index >= segments.size()) throw new IOException("Word page out of range");
            Document source = readSegment(zip, segments.get(index));
            Element body = body(source);
            Set<String> references = new HashSet<>();
            collectReferences(body, references);
            CoursewarePptx.Writer writer = new CoursewarePptx.Writer(zip, result, null);
            writer.copy("[Content_Types].xml");
            writer.copy("_rels/.rels");
            writer.copy("docProps/core.xml");
            writer.copy("docProps/app.xml");
            writer.write(MAIN, source);
            String rels = CoursewarePptx.relationshipsPath(MAIN);
            if (zip.getEntry(rels) != null) {
                Document relationships = CoursewarePptx.xml(zip, rels);
                for (Element relationship : CoursewarePptx.elements(relationships, "Relationship")) {
                    String type = relationship.getAttribute("Type");
                    if ((type.endsWith("/image") || type.endsWith("/header") ||
                            type.endsWith("/footer") || type.endsWith("/hyperlink") ||
                            type.endsWith("/aFChunk")) && !references.contains(relationship.getAttribute("Id"))) {
                        relationship.getParentNode().removeChild(relationship);
                    }
                }
                writer.relationships(MAIN, relationships);
            }
        }
    }

    private static Element body(Document source) throws IOException {
        List<Element> nodes = CoursewarePptx.elements(source, "body");
        if (nodes.isEmpty()) throw new IOException("Word body missing");
        return nodes.get(0);
    }

    private static void collectReferences(Node node, Set<String> ids) {
        NamedNodeMap attributes = node.getAttributes();
        for (int index = 0; attributes != null && index < attributes.getLength(); index++) {
            Node attribute = attributes.item(index);
            String namespace = attribute.getNamespaceURI();
            if (namespace != null && namespace.endsWith("/relationships")) ids.add(attribute.getNodeValue());
        }
        for (Node child = node.getFirstChild(); child != null; child = child.getNextSibling()) {
            collectReferences(child, ids);
        }
    }
}
