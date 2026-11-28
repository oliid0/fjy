import JSZip from "jszip";

import { editedXlsx } from "./officeXlsx";
import { sheetRows } from "./officeSheets";

it("preserves workbook parts and untouched cells when saving an edited row range", async () => {
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Samples" r:id="rId4"/></sheets></workbook>',
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<Relationships><Relationship Id="rId4" Target="worksheets/custom.xml"/></Relationships>',
  );
  zip.file(
    "xl/worksheets/custom.xml",
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B100"/><sheetData><row r="81"><c r="A81"><v>13</v></c><c r="B81" s="2"><f>A81+5</f><v>18</v></c></row><row r="100"><c r="A100"><v>22</v></c></row></sheetData></worksheet>',
  );
  zip.file("xl/charts/chart1.xml", "<chart>untouched</chart>");
  const original = sheetRows("Samples", 80, 89, [
    {
      row: 80,
      cells: [
        { column: 0, value: "13" },
        { column: 1, value: "18", formula: "A81+5" },
      ],
    },
  ]);
  const data = structuredClone(original.data);
  data.rows![0].cells[0].text = "期末成绩";
  const result = await editedXlsx(await zip.generateAsync({ type: "blob" }), [
    { ...original, data, original: original.data },
  ]);
  const saved = await JSZip.loadAsync(result);
  expect(await saved.file("xl/charts/chart1.xml")!.async("string")).toBe(
    "<chart>untouched</chart>",
  );
  const xml = await saved.file("xl/worksheets/custom.xml")!.async("string");
  expect(xml).toContain('r="A81" t="inlineStr"');
  expect(xml).toContain("期末成绩");
  expect(xml).toContain('<c r="B81" s="2"><f>A81+5</f><v>18</v></c>');
  expect(xml).toContain('<c r="A100"><v>22</v></c>');
});
