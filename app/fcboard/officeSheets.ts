import { documentBlob } from "./documentReader";

import type { CellObject } from "xlsx";
import type { CellStyle, SheetData } from "x-data-spreadsheet";
import type { DocumentInput } from "./documentInput";

export type OfficeSheet = {
  name: string;
  start: number;
  end: number;
  data: SheetData;
  original?: SheetData;
};

type NativeRow = {
  row: number;
  cells: { column: number; value: string; formula?: string; style?: number }[];
};

export const sheetRows = (
  name: string,
  start: number,
  end: number,
  rows: NativeRow[],
  styles: CellStyle[] = [],
): OfficeSheet => ({
  name,
  start,
  end,
  data: {
    name,
    styles,
    rows: Object.fromEntries(
      rows.map(({ row, cells }) => [
        row - start,
        {
          cells: Object.fromEntries(
            cells.map((cell) => [
              cell.column,
              {
                text: cell.formula ? `=${cell.formula}` : cell.value,
                style: cell.style,
              },
            ]),
          ),
        },
      ]),
    ),
  },
});

const markup = (input: string) =>
  new DOMParser().parseFromString(input, "application/xml");
const element = (node: Element | Document, name: string) =>
  Array.from(node.getElementsByTagNameNS("*", name))[0];
const list = (node?: Element) => Array.from(node?.children || []);
const color = (node?: Element) => {
  const value = node?.getAttribute("rgb");
  return value && /^[0-9a-f]{8}$/i.test(value)
    ? `#${value.slice(2)}`
    : undefined;
};
export const sheetStyles = (text: string): CellStyle[] => {
  const doc = markup(text);
  const fonts = list(element(doc, "fonts"));
  const fills = list(element(doc, "fills"));
  return list(element(doc, "cellXfs")).map((style) => {
    const font = fonts[Number(style.getAttribute("fontId"))];
    const fill = fills[Number(style.getAttribute("fillId"))];
    const alignment = element(style, "alignment");
    const align = alignment?.getAttribute("horizontal");
    const valign = alignment?.getAttribute("vertical");
    const foreground = font && color(element(font, "color"));
    const background = fill && color(element(fill, "fgColor"));
    return {
      ...(foreground ? { color: foreground } : {}),
      ...(background ? { bgcolor: background } : {}),
      ...(align === "left" || align === "center" || align === "right"
        ? { align }
        : {}),
      ...(valign === "top" || valign === "center" || valign === "bottom"
        ? { valign: valign === "center" ? "middle" : valign }
        : {}),
      textwrap: alignment?.getAttribute("wrapText") === "1",
      font: font
        ? {
            name: element(font, "name")?.getAttribute("val") || "Arial",
            size: Number(element(font, "sz")?.getAttribute("val")) || 11,
            bold: !!element(font, "b"),
            italic: !!element(font, "i"),
          }
        : undefined,
      underline: font ? !!element(font, "u") : undefined,
      strike: font ? !!element(font, "strike") : undefined,
    };
  });
};

const cellValue = (
  old: CellObject | undefined,
  text: string,
): CellObject | undefined => {
  if (!text) {
    return undefined;
  }
  if (
    (old?.f && text === `=${old.f}`) ||
    (old?.v !== undefined && text === String(old.v))
  ) {
    return old;
  }
  if (text.startsWith("=")) {
    return { t: "n", f: text.slice(1) };
  }
  if (
    /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(text) &&
    Number.isFinite(Number(text))
  ) {
    return { t: "n", v: Number(text) };
  }
  return { t: "s", v: text };
};

/** Apply edited visible row ranges to the original workbook only on explicit save. */
export const editedWorkbook = async (
  source: DocumentInput,
  edits: OfficeSheet[],
) => {
  const blob = await documentBlob(source);
  if (/\.xlsx$/i.test(source.name)) {
    const { editedXlsx } = await import("./officeXlsx");
    return editedXlsx(blob, edits);
  }
  const { read, utils, write } = await import("xlsx");
  const book = read(await blob.arrayBuffer(), { cellStyles: true });
  for (const { name, data, start, end } of edits) {
    const sheet = book.Sheets[name];
    if (!sheet) {
      throw new Error(`Missing sheet ${name}`);
    }
    for (const address of Object.keys(sheet)) {
      if (address.startsWith("!")) {
        continue;
      }
      const { r, c } = utils.decode_cell(address);
      if (r >= start && r <= end && !data.rows?.[r - start]?.cells[c]?.text) {
        delete sheet[address];
      }
    }
    const range = utils.decode_range(sheet["!ref"] || "A1:A1");
    for (const [row, { cells }] of Object.entries(data.rows || {})) {
      for (const [column, cell] of Object.entries(cells)) {
        const r = Number(row) + start;
        const c = Number(column);
        const address = utils.encode_cell({ r, c });
        const value = cellValue(sheet[address], cell.text);
        if (!value) {
          continue;
        }
        sheet[address] = value;
        range.e.r = Math.max(range.e.r, r);
        range.e.c = Math.max(range.e.c, c);
      }
    }
    sheet["!ref"] = utils.encode_range(range);
    const merges = (sheet["!merges"] || []).filter(
      (range) => range.s.r < start || range.e.r > end,
    );
    for (const value of data.merges || []) {
      const merge = utils.decode_range(value);
      merge.s.r += start;
      merge.e.r += start;
      merges.push(merge);
    }
    sheet["!merges"] = merges;
  }
  return new Blob([write(book, { bookType: "xlsx", type: "array" })]);
};
