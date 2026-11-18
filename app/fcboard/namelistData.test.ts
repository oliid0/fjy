import { strToU8, zipSync } from "fflate";

import { namelistText, parseNamelist } from "./namelist";
import { parseNamelistFile } from "./namelistData";

const spreadsheet = (
  cells = `<c r="A1" t="inlineStr"><is><t>序号</t></is></c><c r="B1" t="s"><v>0</v></c>`,
  second = `<c r="B2" t="s"><v>1</v></c>`,
) =>
  zipSync({
    "xl/workbook.xml": strToU8(
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="一班" sheetId="2" r:id="names"/><sheet name="二班" sheetId="1" r:id="other"/><sheet name="隐藏" sheetId="3" r:id="hidden" state="hidden"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="other" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/other.xml"/><Relationship Id="names" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/names.xml"/><Relationship Id="hidden" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/hidden.xml"/></Relationships>`,
    ),
    "xl/sharedStrings.xml": strToU8(
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>姓名</t></si><si><r><t>张</t></r><r><t>三</t></r><rPh><t>zhangsan</t></rPh></si></sst>`,
    ),
    "xl/worksheets/names.xml": strToU8(
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cells}</row><row r="2">${second}</row><row r="3"><c r="B3" t="inlineStr"><is><r><t>李</t></r><r><t>四 &amp; 同学</t></r></is></c></row></sheetData></worksheet>`,
    ),
    "xl/worksheets/other.xml": strToU8(
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>王五</t></is></c></row></sheetData></worksheet>`,
    ),
  });

it("roundtrips quoted punctuation and original simple lists without splitting a personal name", () => {
  expect(parseNamelist("张三，李四\n王五")).toEqual(["张三", "李四", "王五"]);
  const names = ["Doe, Jane", 'Jack "Jay" Brown', "欧阳；同学", "李四"];
  expect(parseNamelist(namelistText(names))).toEqual(names);
  expect(() => parseNamelist('"unfinished')).toThrow();
});
it("reads quoted CSV fields, escaped quotes, empty columns and CRLF without treating surnames as separate people", () => {
  expect(
    parseNamelistFile(
      strToU8(
        '\uFEFFId,Name,Group\r\n1,"Doe, Jane",A\r\n2,"Jack ""Jay"" Brown",B\r\n3,,C',
      ),
      "names.csv",
    )[0].rows,
  ).toEqual([
    ["Id", "Name", "Group"],
    ["1", "Doe, Jane", "A"],
    ["2", 'Jack "Jay" Brown', "B"],
    ["3", "", "C"],
  ]);
  expect(
    parseNamelistFile(strToU8("姓名;班级\n张三;一班"), "names.csv")[0].rows,
  ).toEqual([
    ["姓名", "班级"],
    ["张三", "一班"],
  ]);
});
it("imports text lists, Markdown bullets/numbering and Markdown tables", () => {
  expect(
    parseNamelistFile(strToU8("张三\n李四"), "names.text")[0].rows,
  ).toEqual([["张三"], ["李四"]]);
  expect(
    parseNamelistFile(strToU8("# 名单\n- 张三\n2. 李四\n* 王五"), "names.md")[0]
      .rows,
  ).toEqual([["张三"], ["李四"], ["王五"]]);
  expect(
    parseNamelistFile(
      strToU8("| 姓名 | 班级 |\n| --- | :---: |\n| 张三 | 一班 |"),
      "names.md",
    )[0].rows,
  ).toEqual([
    ["姓名", "班级"],
    ["张三", "一班"],
  ]);
});
it("reads a real XLSX ZIP using workbook order/relationships, sparse cells and rich/inline/shared strings", () => {
  expect(parseNamelistFile(spreadsheet(), "names.xlsx")).toEqual([
    {
      name: "一班",
      rows: [
        ["序号", "姓名"],
        ["", "张三"],
        ["", "李四 & 同学"],
      ],
    },
    { name: "二班", rows: [["王五"]] },
  ]);
});
it("rejects malformed or missing shared-string references rather than inventing the first name", () => {
  expect(() =>
    parseNamelistFile(
      spreadsheet(undefined, '<c r="B2" t="s"><v>99</v></c>'),
      "names.xlsx",
    ),
  ).toThrow();
  expect(() =>
    parseNamelistFile(
      spreadsheet(undefined, '<c r="B2" t="s"/>'),
      "names.xlsx",
    ),
  ).toThrow();
});
it("rejects corrupt/empty/unsupported inputs and excessive name-table dimensions", () => {
  expect(() =>
    parseNamelistFile(strToU8("invalid zip"), "names.xlsx"),
  ).toThrow();
  expect(() => parseNamelistFile(strToU8("old binary"), "names.xls")).toThrow(
    "namelist_format",
  );
  expect(() => parseNamelistFile(strToU8("\n"), "names.txt")).toThrow();
  expect(() =>
    parseNamelistFile(
      strToU8(Array(5003).fill("名字").join("\n")),
      "names.txt",
    ),
  ).toThrow();
  expect(() =>
    parseNamelistFile(
      spreadsheet('<c r="IW1" t="s"><v>0</v></c>'),
      "names.xlsx",
    ),
  ).toThrow();
});
