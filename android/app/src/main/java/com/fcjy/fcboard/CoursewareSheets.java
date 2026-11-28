package com.fcjy.fcboard;

import android.util.Xml;
import java.io.File;
import java.io.InputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import org.json.JSONArray;
import org.json.JSONObject;
import org.w3c.dom.Element;
import org.xmlpull.v1.XmlPullParser;

/** Index worksheets by row batches and read only the requested batch into JSON. */
final class CoursewareSheets {
    private static final String WORKBOOK = "xl/workbook.xml";
    private static final int ROWS_PER_PAGE = 80;
    private static final Map<String, List<Page>> indexes = new LinkedHashMap<>();

    private static final class Page {
        final String sheet, name, title;
        final int start, end;
        Page(String sheet, String name, String title, int start, int end) {
            this.sheet = sheet;
            this.name = name;
            this.title = title;
            this.start = start;
            this.end = end;
        }
    }

    private static final class Cell {
        final int column, style;
        final String kind, value, formula;
        Cell(int column, String kind, String value, String formula, int style) {
            this.column = column;
            this.kind = kind;
            this.value = value;
            this.formula = formula;
            this.style = style;
        }
    }

    private CoursewareSheets() {}

    static JSONArray pages(File file) throws Exception {
        List<Page> pages = index(file);
        JSONArray result = new JSONArray();
        for (int id = 0; id < pages.size(); id++) {
            Page page = pages.get(id);
            result.put(new JSONObject().put("index", id).put("name", page.title)
                .put("sheet", new JSONObject().put("name", page.name)
                    .put("start", page.start - 1).put("end", page.end - 1)));
        }
        return result;
    }

    private static synchronized List<Page> index(File file) throws Exception {
        String key = file.getAbsolutePath();
        List<Page> cached = indexes.get(key);
        if (cached != null) return cached;
        List<Page> pages = new ArrayList<>();
        try (ZipFile zip = new ZipFile(file)) {
            Map<String, String> relationships = new HashMap<>();
            String rels = CoursewarePptx.relationshipsPath(WORKBOOK);
            for (Element relation : CoursewarePptx.elements(CoursewarePptx.xml(zip, rels), "Relationship")) {
                if (relation.getAttribute("Type").endsWith("/worksheet") &&
                        !"External".equalsIgnoreCase(relation.getAttribute("TargetMode"))) {
                    relationships.put(relation.getAttribute("Id"),
                        CoursewarePptx.resolve(WORKBOOK, relation.getAttribute("Target")));
                }
            }
            for (Element sheet : CoursewarePptx.elements(CoursewarePptx.xml(zip, WORKBOOK), "sheet")) {
                String path = relationships.get(sheet.getAttribute("r:id"));
                if (path == null) continue;
                String name = sheet.getAttribute("name");
                try (InputStream input = entry(zip, path)) {
                    XmlPullParser xml = parser(input);
                    int first = 1, last = 0;
                    for (int event = xml.next(); event != XmlPullParser.END_DOCUMENT; event = xml.next()) {
                        if (event != XmlPullParser.START_TAG) continue;
                        if ("dimension".equals(xml.getName())) {
                            String range = xml.getAttributeValue(null, "ref");
                            if (range != null && range.matches("[A-Z]{1,3}[0-9]{1,7}(?::[A-Z]{1,3}[0-9]{1,7})?")) {
                                String[] limits = range.split(":");
                                first = number(limits[0].replaceFirst("^[A-Z]+", ""), 1);
                                last = number(limits[limits.length - 1].replaceFirst("^[A-Z]+", ""), 0);
                                if (last >= first && last <= 1048576) break;
                                first = 1;
                                last = 0;
                            }
                        } else if ("row".equals(xml.getName())) {
                            last = Math.max(last, number(xml.getAttributeValue(null, "r"), last + 1));
                        }
                    }
                    last = Math.min(1048576, Math.max(first, last));
                    for (int start = first; start <= last; start += ROWS_PER_PAGE) {
                        int end = Math.min(last, start + ROWS_PER_PAGE - 1);
                        String title = last - first < ROWS_PER_PAGE ? name : name + " · " + start + "–" + end;
                        pages.add(new Page(path, name, title, start, end));
                    }
                }
            }
        }
        if (indexes.size() >= 4) indexes.remove(indexes.keySet().iterator().next());
        indexes.put(key, pages);
        return pages;
    }

    static JSONArray page(File file, int index) throws Exception {
        Page page = index(file).get(index);
        Map<Integer, List<Cell>> rows = new LinkedHashMap<>();
        Set<Integer> strings = new HashSet<>();
        try (ZipFile zip = new ZipFile(file)) {
            try (InputStream input = entry(zip, page.sheet)) {
                XmlPullParser xml = parser(input);
                int row = 0;
                for (int event = xml.next(); event != XmlPullParser.END_DOCUMENT; event = xml.next()) {
                    if (event == XmlPullParser.START_TAG && "row".equals(xml.getName())) {
                        row = number(xml.getAttributeValue(null, "r"), row + 1);
                        if (row > page.end) break;
                    } else if (event == XmlPullParser.START_TAG && "c".equals(xml.getName()) && row >= page.start) {
                        List<Cell> cells = rows.computeIfAbsent(row, ignored -> new ArrayList<>());
                        Cell cell = cell(xml, cells.isEmpty() ? 0 : cells.get(cells.size() - 1).column + 1);
                        cells.add(cell);
                        if ("s".equals(cell.kind)) strings.add(number(cell.value, -1));
                    }
                }
            }
            Map<Integer, String> shared = sharedStrings(zip, strings);
            JSONArray output = new JSONArray();
            for (Map.Entry<Integer, List<Cell>> entry : rows.entrySet()) {
                JSONArray values = new JSONArray();
                for (Cell cell : entry.getValue()) {
                    String value = "s".equals(cell.kind)
                        ? shared.getOrDefault(number(cell.value, -1), "")
                        : "b".equals(cell.kind) ? "1".equals(cell.value) ? "TRUE" : "FALSE" : cell.value;
                    values.put(new JSONObject().put("column", cell.column).put("value", value)
                        .put("formula", cell.formula).put("style", cell.style));
                }
                output.put(new JSONObject().put("row", entry.getKey() - 1).put("cells", values));
            }
            return output;
        }
    }

    private static Cell cell(XmlPullParser xml, int fallback) throws Exception {
        String reference = xml.getAttributeValue(null, "r");
        int column = 0;
        if (reference != null) {
            for (int index = 0; index < reference.length(); index++) {
                char value = reference.charAt(index);
                if (value < 'A' || value > 'Z') break;
                column = column * 26 + value - 'A' + 1;
            }
        }
        String kind = xml.getAttributeValue(null, "t");
        int style = number(xml.getAttributeValue(null, "s"), 0);
        String formula = "";
        StringBuilder text = new StringBuilder();
        int depth = xml.getDepth();
        for (int event = xml.next(); event != XmlPullParser.END_DOCUMENT; event = xml.next()) {
            if (event == XmlPullParser.END_TAG && xml.getDepth() == depth) break;
            if (event == XmlPullParser.START_TAG && ("v".equals(xml.getName()) ||
                    "inlineStr".equals(kind) && "t".equals(xml.getName()))) {
                text.append(xml.nextText());
            } else if (event == XmlPullParser.START_TAG && "f".equals(xml.getName())) {
                formula = xml.nextText();
            }
        }
        return new Cell(column > 0 ? column - 1 : fallback, kind, text.toString(), formula, style);
    }

    private static Map<Integer, String> sharedStrings(ZipFile zip, Set<Integer> needed) throws Exception {
        Map<Integer, String> result = new HashMap<>();
        needed.remove(-1);
        if (needed.isEmpty() || zip.getEntry("xl/sharedStrings.xml") == null) return result;
        try (InputStream input = entry(zip, "xl/sharedStrings.xml")) {
            XmlPullParser xml = parser(input);
            int index = -1;
            StringBuilder text = null;
            for (int event = xml.next(); event != XmlPullParser.END_DOCUMENT && !needed.isEmpty(); event = xml.next()) {
                if (event == XmlPullParser.START_TAG && "si".equals(xml.getName())) {
                    text = needed.contains(++index) ? new StringBuilder() : null;
                } else if (text != null && event == XmlPullParser.START_TAG && "t".equals(xml.getName())) {
                    text.append(xml.nextText());
                } else if (text != null && event == XmlPullParser.END_TAG && "si".equals(xml.getName())) {
                    result.put(index, text.toString());
                    needed.remove(index);
                    text = null;
                }
            }
        }
        return result;
    }

    private static InputStream entry(ZipFile zip, String name) throws IOException {
        ZipEntry entry = zip.getEntry(name);
        if (entry == null) throw new IOException("Worksheet part missing");
        return zip.getInputStream(entry);
    }

    private static XmlPullParser parser(InputStream input) throws Exception {
        XmlPullParser xml = Xml.newPullParser();
        xml.setFeature(XmlPullParser.FEATURE_PROCESS_DOCDECL, false);
        xml.setInput(input, null);
        return xml;
    }

    private static int number(String value, int fallback) {
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException missing) {
            return fallback;
        }
    }
}
