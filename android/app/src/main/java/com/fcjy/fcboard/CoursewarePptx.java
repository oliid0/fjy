package com.fcjy.fcboard;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.HashSet;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

/** Package one slide with its own layouts, themes, fonts, images, and other local relationships. */
final class CoursewarePptx {
    private static final String PRESENTATION = "ppt/presentation.xml";
    private static final String CONTENT_TYPES = "[Content_Types].xml";
    private static final String OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private static final int XML_LIMIT = 8 * 1024 * 1024;
    private static final long PAGE_BUDGET = 128L * 1024 * 1024;

    private CoursewarePptx() {}

    static org.json.JSONObject metadata(File file) throws Exception {
        try (ZipFile zip = new ZipFile(file)) {
            Document presentation = xml(zip, PRESENTATION);
            List<Element> sizes = elements(presentation, "sldSz");
            double ratio = 16d / 9;
            if (!sizes.isEmpty()) {
                double width = Double.parseDouble(sizes.get(0).getAttribute("cx"));
                double height = Double.parseDouble(sizes.get(0).getAttribute("cy"));
                if (width > 0 && height > 0) ratio = width / height;
            }
            return new org.json.JSONObject().put("count", slides(presentation).size()).put("ratio", ratio);
        }
    }

    static void page(File file, int index, OutputStream output) throws Exception {
        try (ZipFile zip = new ZipFile(file); ZipOutputStream page = new ZipOutputStream(output)) {
            Document presentation = xml(zip, PRESENTATION);
            List<Element> slides = slides(presentation);
            if (index < 0 || index >= slides.size()) throw new IOException("Slide out of range");
            Element selected = slides.get(index);
            String id = selected.getAttributeNS(OFFICE_REL, "id");
            if (id.isEmpty()) id = selected.getAttribute("r:id");
            if (id.isEmpty()) throw new IOException("Slide relationship missing");
            for (Element slide : slides) {
                if (slide != selected) slide.getParentNode().removeChild(slide);
            }
            Document relationships = xml(zip, relationshipsPath(PRESENTATION));
            String slidePath = "";
            for (Element relationship : elements(relationships, "Relationship")) {
                if (relationship.getAttribute("Type").endsWith("/slide")) {
                    if (relationship.getAttribute("Id").equals(id)) {
                        slidePath = resolve(PRESENTATION, relationship.getAttribute("Target"));
                    } else {
                        relationship.getParentNode().removeChild(relationship);
                    }
                }
            }
            if (slidePath.isEmpty() || zip.getEntry(slidePath) == null) {
                throw new IOException("Slide data missing");
            }
            Writer writer = new Writer(zip, page, slidePath);
            writer.copy(CONTENT_TYPES);
            writer.copy("_rels/.rels");
            writer.copy("docProps/core.xml");
            writer.copy("docProps/app.xml");
            writer.write(PRESENTATION, presentation);
            writer.relationships(PRESENTATION, relationships);
        }
    }

    static List<Element> elements(Document document, String name) {
        NodeList nodes = document.getElementsByTagNameNS("*", name);
        List<Element> result = new ArrayList<>();
        for (int index = 0; index < nodes.getLength(); index++) result.add((Element) nodes.item(index));
        return result;
    }

    private static List<Element> slides(Document document) {
        return elements(document, "sldId");
    }

    static Document xml(ZipFile zip, String name) throws Exception {
        ZipEntry entry = zip.getEntry(name);
        if (entry == null || entry.getSize() > XML_LIMIT) throw new IOException("Missing or oversized Office metadata");
        try (InputStream input = zip.getInputStream(entry); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > XML_LIMIT) throw new IOException("Oversized Office metadata");
                output.write(buffer, 0, count);
            }
            String source = new String(output.toByteArray(), StandardCharsets.UTF_8);
            return parseXml(source);
        }
    }

    static Document parseXml(String source) throws Exception {
        if (source.toUpperCase(Locale.ROOT).contains("<!DOCTYPE")) throw new IOException("Office DTD is not supported");
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setExpandEntityReferences(false);
        javax.xml.parsers.DocumentBuilder parser = factory.newDocumentBuilder();
        parser.setEntityResolver((publicId, systemId) -> { throw new IOException("External Office entity"); });
        return parser.parse(new InputSource(new java.io.StringReader(source)));
    }

    static String relationshipsPath(String name) {
        int separator = name.lastIndexOf('/');
        return name.substring(0, separator + 1) + "_rels/" + name.substring(separator + 1) + ".rels";
    }

    static String resolve(String part, String target) throws IOException {
        if (target.isEmpty() || target.indexOf('\\') != -1 || target.contains(":")) {
            throw new IOException("Invalid Office relationship");
        }
        Path folder = Paths.get(part).getParent();
        Path path = target.startsWith("/") ? Paths.get(target.substring(1))
            : folder == null ? Paths.get(target) : folder.resolve(target);
        path = path.normalize();
        if (path.isAbsolute() || path.startsWith("..")) throw new IOException("Invalid Office relationship");
        return path.toString();
    }

    static final class Writer {
        final ZipFile source;
        final ZipOutputStream output;
        final String slide;
        final Set<String> copied = new HashSet<>();
        long bytes;

        Writer(ZipFile source, ZipOutputStream output, String slide) {
            this.source = source;
            this.output = output;
            this.slide = slide;
        }

        void copy(String part) throws IOException {
            ZipEntry entry = source.getEntry(part);
            if (entry == null || entry.isDirectory() || !copied.add(part)) return;
            output.putNextEntry(new ZipEntry(part));
            try (InputStream input = source.getInputStream(entry)) {
                byte[] buffer = new byte[32768];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    bytes += count;
                    if (bytes > PAGE_BUDGET) throw new IOException("Slide resources are too large");
                    output.write(buffer, 0, count);
                }
            }
            output.closeEntry();
        }

        void write(String name, Document document) throws Exception {
            if (!copied.add(name)) return;
            output.putNextEntry(new ZipEntry(name));
            TransformerFactory.newInstance().newTransformer().transform(new DOMSource(document), new StreamResult(output));
            output.closeEntry();
        }

        void relationships(String part, Document relationships) throws Exception {
            List<String> children = new ArrayList<>();
            for (Element link : elements(relationships, "Relationship")) {
                String type = link.getAttribute("Type");
                if ("External".equalsIgnoreCase(link.getAttribute("TargetMode")) ||
                        type.endsWith("/notesSlide") || type.endsWith("/notesMaster")) {
                    link.getParentNode().removeChild(link);
                    continue;
                }
                String child = resolve(part, link.getAttribute("Target"));
                if (slide != null && type.endsWith("/slide") && !child.equals(slide)) {
                    link.getParentNode().removeChild(link);
                } else {
                    children.add(child);
                }
            }
            write(relationshipsPath(part), relationships);
            for (String child : children) {
                if (copied.contains(child)) continue;
                copy(child);
                String links = relationshipsPath(child);
                if (source.getEntry(links) != null) relationships(child, xml(source, links));
            }
        }
    }
}
