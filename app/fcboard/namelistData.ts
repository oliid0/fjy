import { SaxesParser } from "saxes";
import { strFromU8, unzipSync } from "fflate";

import { delimitedRows, namelistFileLimit, parseNamelist } from "./namelist";

export type NamelistTable = { name: string; rows: string[][] };

const invalid = () => new Error("namelist_invalid");

type XmlItem = {
  name: string;
  attrs: Record<string, string>;
  text: string;
  children: XmlItem[];
};
/** Retain only one matching record at a time; no DOM APIs exist in a Worker. */
const xmlRecords = (
  source: string,
  record: string,
  visit: (item: XmlItem) => void,
) => {
  const parser = new SaxesParser({ xmlns: true });
  const stack: XmlItem[] = [];
  parser.on("doctype", () => {
    throw invalid();
  });
  parser.on("opentag", (tag) => {
    if (!stack.length && tag.local !== record) {
      return;
    }
    if (stack.length > 32) {
      throw invalid();
    }
    const item: XmlItem = {
      name: tag.local,
      attrs: Object.fromEntries(
        Object.values(tag.attributes).map((attribute) => [
          attribute.local,
          attribute.value,
        ]),
      ),
      text: "",
      children: [],
    };
    stack.at(-1)?.children.push(item);
    stack.push(item);
  });
  const append = (text: string) => {
    const item = stack.at(-1);
    if (item) {
      item.text += text;
    }
  };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", () => {
    if (!stack.length) {
      return;
    }
    const item = stack.pop()!;
    if (!stack.length) {
      visit(item);
    }
  });
  parser.write(source).close();
};
const inlineText = (item: XmlItem): string =>
  item.name === "rPh"
    ? ""
    : item.name === "t"
    ? item.text
    : item.children.map(inlineText).join("");
const columnIndex = (reference: string) => {
  const letters = reference.match(/^([A-Z]+)\d+$/)?.[1];
  if (!letters) {
    throw invalid();
  }
  const index =
    [...letters].reduce(
      (value, character) => value * 26 + character.charCodeAt(0) - 64,
      0,
    ) - 1;
  if (index > 255) {
    throw invalid();
  }
  return index;
};

/** Parse only package metadata, shared strings and worksheet XML. Images,
 * macros and formula evaluation never participate in a name import. */
const workbookTables = (bytes: Uint8Array): NamelistTable[] => {
  let size = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      const include =
        /^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(
          file.name,
        );
      if (include && (size += file.originalSize) > 16 * 1024 * 1024) {
        throw invalid();
      }
      return include;
    },
  });
  const read = (path: string) => {
    if (!files[path]) {
      throw invalid();
    }
    return strFromU8(files[path]);
  };
  const relations = new Map<string, string>();
  xmlRecords(
    read("xl/_rels/workbook.xml.rels"),
    "Relationship",
    ({ attrs }) => {
      if (
        attrs.TargetMode === "External" ||
        !attrs.Type?.endsWith("/worksheet")
      ) {
        return;
      }
      const target = new URL(
        attrs.Target,
        "https://xlsx.invalid/xl/workbook.xml",
      );
      if (target.origin === "https://xlsx.invalid") {
        relations.set(attrs.Id, target.pathname.slice(1));
      }
    },
  );
  const sheets: { name: string; path: string }[] = [];
  xmlRecords(read("xl/workbook.xml"), "sheet", ({ attrs }) => {
    const path = relations.get(attrs.id);
    if (path && attrs.state !== "hidden" && attrs.state !== "veryHidden") {
      sheets.push({ name: attrs.name, path });
    }
    if (sheets.length > 32) {
      throw invalid();
    }
  });
  const shared: string[] = [];
  if (files["xl/sharedStrings.xml"]) {
    xmlRecords(read("xl/sharedStrings.xml"), "si", (item) => {
      shared.push(inlineText(item));
      if (shared.length > 100000) {
        throw invalid();
      }
    });
  }
  return sheets
    .map(({ name, path }) => {
      const rows: string[][] = [];
      xmlRecords(read(path), "row", (item) => {
        const row: string[] = [];
        for (const cell of item.children.filter(
          (child) => child.name === "c",
        )) {
          const index = cell.attrs.r ? columnIndex(cell.attrs.r) : row.length;
          if (index > 255) {
            throw invalid();
          }
          const value =
            cell.children.find((child) => child.name === "v")?.text || "";
          if (cell.attrs.t === "s" && !/^\d+$/.test(value)) {
            throw invalid();
          }
          const text =
            cell.attrs.t === "s"
              ? shared[Number(value)]
              : cell.attrs.t === "inlineStr"
              ? inlineText(cell)
              : value;
          if (text === undefined) {
            throw invalid();
          }
          while (row.length <= index) {
            row.push("");
          }
          row[index] = text.trim();
        }
        if (row.some(Boolean)) {
          rows.push(row);
        }
        if (rows.length > 5001) {
          throw invalid();
        }
      });
      return { name, rows };
    })
    .filter((table) => table.rows.length);
};

export const parseNamelistFile = (
  bytes: Uint8Array,
  name: string,
): NamelistTable[] => {
  if (bytes.length > namelistFileLimit) {
    throw invalid();
  }
  const extension = name.split(".").at(-1)?.toLowerCase();
  let tables: NamelistTable[];
  if (extension === "xlsx") {
    tables = workbookTables(bytes);
  } else {
    if (
      !["csv", "tsv", "txt", "text", "md", "markdown"].includes(extension || "")
    ) {
      throw new Error("namelist_format");
    }
    let text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (extension === "md" || extension === "markdown") {
      const lines = text
        .split(/\r?\n/)
        .filter((line) => !/^\s*(?:#|```|~~~)/.test(line));
      if (lines.some((line) => line.includes("|"))) {
        text = lines
          .filter((line) => !/^\s*\|?\s*:?-{3,}/.test(line))
          .map((line) => line.trim().replace(/^\||\|$/g, ""))
          .join("\n");
        tables = [{ name, rows: delimitedRows(text, "|") }];
      } else {
        tables = [
          {
            name,
            rows: lines.flatMap((line) =>
              parseNamelist(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")).map(
                (entry) => [entry],
              ),
            ),
          },
        ];
      }
    } else {
      const separators =
        extension === "csv"
          ? text.split(/\r?\n/, 1)[0].includes(";") &&
            !text.split(/\r?\n/, 1)[0].includes(",")
            ? ";"
            : ","
          : extension === "tsv"
          ? "\t"
          : ",，;；\t";
      tables = [{ name, rows: delimitedRows(text, separators) }];
    }
  }
  if (!tables.some((table) => table.rows.length)) {
    throw invalid();
  }
  return tables;
};
