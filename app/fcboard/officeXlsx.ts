import JSZip from "jszip";
import { utils } from "xlsx";

import type { CellStyle } from "x-data-spreadsheet";
import type { OfficeSheet } from "./officeSheets";

type Style = CellStyle & {
  font?: { name?: string; size?: number; bold?: boolean; italic?: boolean };
  underline?: boolean;
  strike?: boolean;
};
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const xml = (value: string) =>
  new DOMParser().parseFromString(value, "application/xml");
const list = (part: Document | Element, name: string) =>
  Array.from(part.getElementsByTagNameNS("*", name));
const part = async (zip: JSZip, name: string) => {
  const value = await zip.file(name)?.async("string");
  if (!value) {
    throw new Error(`Missing workbook part ${name}`);
  }
  return xml(value);
};
const write = (zip: JSZip, path: string, doc: Document) =>
  zip.file(path, new XMLSerializer().serializeToString(doc));
const node = (
  doc: Document,
  name: string,
  attributes: Record<string, string | number> = {},
) => {
  const item = doc.createElementNS(ns, name);
  for (const [key, value] of Object.entries(attributes)) {
    item.setAttribute(key, String(value));
  }
  return item;
};
const rgb = (value?: string) =>
  /^#[\da-f]{6}$/i.test(value || "")
    ? `FF${value!.slice(1).toUpperCase()}`
    : undefined;
const add = (group: Element, item: Element) => {
  const index = group.children.length;
  group.append(item);
  group.setAttribute("count", String(group.children.length));
  return index;
};

const styleWriter = (doc: Document) => {
  const fonts = list(doc, "fonts")[0];
  const fills = list(doc, "fills")[0];
  const borders = list(doc, "borders")[0];
  const formats = list(doc, "cellXfs")[0];
  const cache = new Map<string, number>();
  return (style?: Style) => {
    if (!style || !fonts || !fills || !formats) {
      return undefined;
    }
    const key = JSON.stringify(style);
    const existing = cache.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const font = node(doc, "font");
    if (style.font?.bold) {
      font.append(node(doc, "b"));
    }
    if (style.font?.italic) {
      font.append(node(doc, "i"));
    }
    if (style.underline) {
      font.append(node(doc, "u"));
    }
    if (style.strike) {
      font.append(node(doc, "strike"));
    }
    font.append(node(doc, "sz", { val: style.font?.size || 11 }));
    const text = rgb(style.color);
    if (text) {
      font.append(node(doc, "color", { rgb: text }));
    }
    font.append(node(doc, "name", { val: style.font?.name || "Arial" }));
    const fill = node(doc, "fill");
    const background = rgb(style.bgcolor);
    const pattern = node(doc, "patternFill", {
      patternType: background ? "solid" : "none",
    });
    if (background) {
      pattern.append(
        node(doc, "fgColor", { rgb: background }),
        node(doc, "bgColor", { indexed: 64 }),
      );
    }
    fill.append(pattern);
    let borderId = 0;
    if (style.border && borders) {
      const border = node(doc, "border");
      for (const edge of ["left", "right", "top", "bottom"] as const) {
        const [weight, color] = style.border[edge] || [];
        const kind = [
          "thin",
          "medium",
          "thick",
          "dashed",
          "dotted",
          "double",
        ].includes(weight)
          ? weight
          : "thin";
        const side = node(doc, edge, weight ? { style: kind } : {});
        const value = rgb(color);
        if (value) {
          side.append(node(doc, "color", { rgb: value }));
        }
        border.append(side);
      }
      border.append(node(doc, "diagonal"));
      borderId = add(borders, border);
    }
    const format = node(doc, "xf", {
      numFmtId: 0,
      fontId: add(fonts, font),
      fillId: add(fills, fill),
      borderId,
      xfId: 0,
      applyFont: 1,
      applyFill: 1,
      applyBorder: 1,
      applyAlignment: 1,
    });
    format.append(
      node(doc, "alignment", {
        horizontal: style.align || "general",
        vertical:
          style.valign === "middle" ? "center" : style.valign || "bottom",
        wrapText: style.textwrap ? 1 : 0,
      }),
    );
    const index = add(formats, format);
    cache.set(key, index);
    return index;
  };
};

const valueOf = (doc: Document, cell: Element, text: string) => {
  cell.replaceChildren();
  cell.removeAttribute("t");
  if (text.startsWith("=") && text.length > 1) {
    const formula = node(doc, "f");
    formula.textContent = text.slice(1);
    cell.append(formula);
  } else if (
    text === "TRUE" ||
    text === "FALSE" ||
    (/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(text) &&
      Number.isFinite(Number(text)))
  ) {
    const value = node(doc, "v");
    if (text === "TRUE" || text === "FALSE") {
      cell.setAttribute("t", "b");
      value.textContent = text === "TRUE" ? "1" : "0";
    } else {
      value.textContent = text;
    }
    cell.append(value);
  } else if (text) {
    cell.setAttribute("t", "inlineStr");
    const value = node(doc, "t");
    value.setAttributeNS(
      "http://www.w3.org/XML/1998/namespace",
      "xml:space",
      "preserve",
    );
    value.textContent = text;
    const inline = node(doc, "is");
    inline.append(value);
    cell.append(inline);
  }
};

const updateSheet = (
  doc: Document,
  { data, original, start, end }: OfficeSheet,
  applyStyle: (style: Style | undefined) => number | undefined,
) => {
  if (!original) {
    return;
  }
  const body = list(doc, "sheetData")[0];
  if (!body) {
    throw new Error("Missing worksheet data");
  }
  const rows = new Map(
    Array.from(body.children, (row) => [
      Number(row.getAttribute("r")) - 1,
      row,
    ]),
  );
  const dimension = list(doc, "dimension")[0];
  const range = utils.decode_range(dimension?.getAttribute("ref") || "A1");
  const positions = new Set([
    ...Object.keys(original.rows || {}),
    ...Object.keys(data.rows || {}),
  ]);
  for (const index of positions) {
    const relative = Number(index);
    const rowIndex = relative + start;
    const previous = original.rows?.[relative]?.cells || {};
    const current = data.rows?.[relative]?.cells || {};
    let row = rows.get(rowIndex);
    const cells = new Map(
      Array.from(row?.children || [], (cell) => [cell.getAttribute("r"), cell]),
    );
    for (const column of new Set([
      ...Object.keys(previous),
      ...Object.keys(current),
    ])) {
      const col = Number(column);
      const before = previous[col];
      const after = current[col];
      const format =
        after?.style === undefined ? undefined : data.styles?.[after.style];
      const oldFormat =
        before?.style === undefined
          ? undefined
          : original.styles?.[before.style];
      const styleChanged = JSON.stringify(oldFormat) !== JSON.stringify(format);
      if (before?.text === after?.text && !styleChanged) {
        continue;
      }
      const address = utils.encode_cell({ r: rowIndex, c: col });
      let cell = cells.get(address);
      if (!after?.text && !format) {
        cell?.remove();
        continue;
      }
      if (!row) {
        row = node(doc, "row", { r: rowIndex + 1 });
        const following = Array.from(body.children).find(
          (item) => Number(item.getAttribute("r")) > rowIndex + 1,
        );
        body.insertBefore(row, following || null);
        rows.set(rowIndex, row);
      }
      if (!cell) {
        cell = node(doc, "c", { r: address });
        const following = Array.from(row.children).find(
          (item) => utils.decode_cell(item.getAttribute("r") || "A1").c > col,
        );
        row.insertBefore(cell, following || null);
      }
      if (before?.text !== after?.text) {
        valueOf(doc, cell, after?.text || "");
      }
      if (styleChanged) {
        const formatIndex = applyStyle(format);
        if (formatIndex === undefined) {
          cell.removeAttribute("s");
        } else {
          cell.setAttribute("s", String(formatIndex));
        }
      }
      range.s.r = Math.min(range.s.r, rowIndex);
      range.e.r = Math.max(range.e.r, rowIndex);
      range.s.c = Math.min(range.s.c, col);
      range.e.c = Math.max(range.e.c, col);
    }
  }
  dimension?.setAttribute("ref", utils.encode_range(range));
  if (JSON.stringify(data.merges) === JSON.stringify(original.merges)) {
    return;
  }
  let ranges = list(doc, "mergeCells")[0];
  if (!ranges) {
    ranges = node(doc, "mergeCells");
    body.after(ranges);
  }
  if (original.merges) {
    for (const value of Array.from(ranges.children)) {
      const range = utils.decode_range(value.getAttribute("ref") || "A1");
      if (range.s.r >= start && range.e.r <= end) {
        value.remove();
      }
    }
  }
  for (const value of data.merges || []) {
    const range = utils.decode_range(value);
    range.s.r += start;
    range.e.r += start;
    const reference = utils.encode_range(range);
    if (
      !Array.from(ranges.children).some(
        (item) => item.getAttribute("ref") === reference,
      )
    ) {
      ranges.append(node(doc, "mergeCell", { ref: reference }));
    }
  }
  if (ranges.children.length) {
    ranges.setAttribute("count", String(ranges.children.length));
  } else {
    ranges.remove();
  }
};

export const editedXlsx = async (source: Blob, edits: OfficeSheet[]) => {
  const zip = await JSZip.loadAsync(source);
  const [book, relationships, styles] = await Promise.all([
    part(zip, "xl/workbook.xml"),
    part(zip, "xl/_rels/workbook.xml.rels"),
    zip.file("xl/styles.xml") ? part(zip, "xl/styles.xml") : undefined,
  ]);
  const applyStyle = styles ? styleWriter(styles) : () => undefined;
  const documents = new Map<string, Document>();
  for (const edit of edits) {
    const sheet = list(book, "sheet").find(
      (item) => item.getAttribute("name") === edit.name,
    );
    const id = sheet?.getAttribute("r:id");
    const relation = list(relationships, "Relationship").find(
      (item) => item.getAttribute("Id") === id,
    );
    const target = relation?.getAttribute("Target");
    if (!target || relation?.getAttribute("TargetMode") === "External") {
      throw new Error(`Missing sheet ${edit.name}`);
    }
    const path = decodeURIComponent(
      new URL(target, "https://sheet.local/xl/workbook.xml").pathname,
    ).slice(1);
    const doc = documents.get(path) || (await part(zip, path));
    updateSheet(doc, edit, applyStyle);
    documents.set(path, doc);
  }
  for (const [path, doc] of documents) {
    write(zip, path, doc);
  }
  if (styles) {
    write(zip, "xl/styles.xml", styles);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
};
