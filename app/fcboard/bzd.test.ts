import { convertToFcboardElements } from "@fcboard/fcboard";
import { pointFrom } from "@fcboard/math";
import { newFreeDrawElement, newIframeElement } from "@fcboard/element";
import { calculatorResourceId } from "@fcboard/fcboard/interactiveHtml";
import { initialCalculator } from "@fcboard/fcboard/calculatorInput";

import type { DataURL } from "@fcboard/fcboard/types";

import { parseBzd, serializeBzd } from "./bzd";
import {
  changeTableTrack,
  insertionDefaults,
  readInsertions,
  renderInsertion,
} from "./insertObjects";
import { growBoardTableWriting } from "./insertionWritingTables";
import { sceneAPI } from "./test/scene";
import { defaultPlot } from "./math";
import { widgetDefaults } from "./widgets";

import type { Board } from "./boards";

const page = (): Board => ({
  id: "page-1",
  name: '力学 <实验> & "测量"',
  elements: convertToFcboardElements([
    { type: "text", text: "牛顿定律", x: 20, y: 30, fontSize: 32 },
    { type: "rectangle", x: 40, y: 100, width: 120, height: 80 },
  ]),
  files: {},
  view: {
    scrollX: 0,
    scrollY: 0,
    zoom: { value: 1 as Board["view"]["zoom"]["value"] },
    viewBackgroundColor: "#253a35",
  },
  updated: 1,
});
it("preserves editable pen pressure, transforms, control state and function metadata in one scene", async () => {
  const board = page();
  const ink = newFreeDrawElement({
    type: "freedraw",
    x: 30,
    y: 40,
    points: [pointFrom(0, 0), pointFrom(45, 28), pointFrom(90, 60)],
    pressures: [0.2, 0.8, 0.4],
    simulatePressure: false,
    customData: { fcInk: { version: 2, pen: "brush", variation: 35 } },
  });
  const calculator = newIframeElement({
    type: "iframe",
    x: 220,
    y: 70,
    width: 120,
    height: 180,
    angle: 0.3 as Board["elements"][number]["angle"],
    customData: {
      fcInteractiveResource: {
        id: calculatorResourceId,
        title: "Calculator",
        html: "",
        calculator: {
          ...initialCalculator,
          answer: "2",
          phase: "result",
          scientific: true,
        },
      },
    },
  });
  const objects = convertToFcboardElements([
    {
      type: "rectangle",
      x: 400,
      y: 70,
      width: 300,
      height: 220,
      customData: {
        fcPlot: {
          id: "plot",
          plot: { ...defaultPlot, expression: "x", compare: ["x^2"] },
          position: { x: 400, y: 70 },
          origin: { x: 400, y: 70 },
        },
      },
    },
    {
      type: "rectangle",
      x: 200,
      y: 400,
      width: 300,
      height: 70,
      customData: {
        fcWidget: {
          id: "ruler",
          kind: "ruler",
          params: { ...widgetDefaults(), rotation: 15, size: 1.2 },
          position: { x: 200, y: 400 },
          origin: { x: 200, y: 400 },
        },
      },
    },
  ]);
  board.elements = [...board.elements, ink, calculator, ...objects];
  const [loaded] = (await parseBzd(serializeBzd([board]))).pages;
  expect(
    loaded.elements.map((item) => ({
      id: item.id,
      x: item.x,
      y: item.y,
      angle: item.angle,
      customData: item.customData,
    })),
  ).toEqual(
    board.elements.map((item) => ({
      id: item.id,
      x: item.x,
      y: item.y,
      angle: item.angle,
      customData: item.customData,
    })),
  );
  expect(loaded.elements.find((item) => item.id === ink.id)).toMatchObject({
    type: "freedraw",
    points: ink.points,
    pressures: ink.pressures,
    simulatePressure: false,
  });
});
it("writes genuine factory XML and losslessly restores all pages, metadata and editable objects", async () => {
  const first = page();
  const second = { ...page(), id: "second", name: "第二页" };
  first.view.whiteboardBackground = {
    pattern: 14,
    width: 1920,
    height: 1080,
    image: "data:image/png;base64,YQ==" as DataURL,
  };
  first.view.whiteboardCustomBackground =
    first.view.whiteboardBackground!.image;
  second.name = "第二页\u0001\uFFFF";
  const xml = serializeBzd([first, second], { activeId: second.id });
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  expect(doc.querySelector("parsererror")).toBeNull();
  expect(doc.documentElement.tagName).toBe("bzd");
  expect(doc.querySelectorAll("slide")).toHaveLength(2);
  expect(
    doc.querySelector('object[eType="OBJECT_TEXT"]')?.getAttribute("text"),
  ).toBe("牛顿定律");
  const { pages: loaded, activeIndex } = await parseBzd(xml);
  expect(activeIndex).toBe(1);
  expect(loaded.map((p) => p.name)).toEqual([first.name, second.name]);
  const comparable = (elements: Board["elements"]) =>
    JSON.parse(JSON.stringify(elements)).map(
      (element: Record<string, unknown>) => ({
        ...element,
        boundElements: element.boundElements || [],
      }),
    );
  expect(comparable(loaded[0].elements)).toEqual(comparable(first.elements));
  expect(loaded[0].view).toEqual(first.view);
  expect(loaded[0].id).not.toBe(first.id);
});
it("reads native signed colors, original text, paths and table line geometry without the Fcboard extension", async () => {
  const xml =
    '<bzd><slide nSlideId="1" name="原版" zSlideType="SLIDE_PATTERN_2" zSlideColor="-16777216" zSlideColorIndex="0" ObjectCount="3"><object nId="text" eType="OBJECT_TEXT" nRGBA_R="255" nRGBA_G="0" nRGBA_B="0" nRGBA_A="255" width="40" text="标题"><lstPt>100,80,false,</lstPt></object><object nId="ink" eType="OBJECT_STROKE" nRGBA_R="255" nRGBA_G="255" nRGBA_B="255" nRGBA_A="255" width="3"><lstPt>10,10,20,30,40,50,</lstPt></object><object nId="table" eType="OBJECT_TABLE" nRGBA_R="0" nRGBA_G="255" nRGBA_B="0" nRGBA_A="255" width="2" tableVerticalLines="200,200,200,300;300,200,300,300;" tableHorizontalLines="200,200,300,200;200,300,300,300;"><lstPt/></object></slide></bzd>';
  const [loaded] = (await parseBzd(xml)).pages;
  expect(loaded.view.viewBackgroundColor).toBe("#000000");
  expect(loaded.elements.find((e) => e.type === "text")).toMatchObject({
    x: 100,
    y: 80,
    originalText: "标题",
    fontSize: 40,
    strokeColor: "#ff0000",
  });
  expect(loaded.elements.find((e) => e.type === "freedraw")).toMatchObject({
    x: 10,
    y: 10,
    points: [
      [0, 0],
      [10, 20],
      [30, 40],
    ],
  });
  const api = sceneAPI();
  api.updateScene({ elements: loaded.elements });
  expect(readInsertions(api)).toEqual([
    expect.objectContaining({
      kind: "table",
      position: { x: 200, y: 200 },
      width: 100,
      height: 100,
      rows: 1,
      columns: 1,
      color: "#00ff00",
    }),
  ]);
});

const nativeTable = (attributes: string, contents = "") =>
  `<bzd><slide zSlideColor="-1"><object nId="native-table" eType="OBJECT_TABLE" nRGBA_R="25" nRGBA_G="90" nRGBA_B="180" nRGBA_A="153" width="5" ${attributes}><lstPt>100,100,400,280,</lstPt></object>${contents}</slide></bzd>`;
const unequalGrid =
  'tableVerLine="2" tableHorLine="2" tableVerticalLines="100,100,100,280;200,100,200,280;400,100,400,280;" tableHorizontalLines="100,100,400,100;100,180,400,180;100,280,400,280;"';
const withoutExtension = (text: string) => {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  doc.querySelectorAll("fcboard").forEach((node) => node.remove());
  return new XMLSerializer().serializeToString(doc);
};

it("restores native unequal tables as editable grids and keeps original cell ink/text when changing tracks and writing", async () => {
  const [board] = (
    await parseBzd(
      nativeTable(
        unequalGrid,
        '<object eType="OBJECT_STROKE" width="2"><lstPt>240,210,260,230,</lstPt></object><object eType="OBJECT_TEXT" width="20" text="原文"><lstPt>245,240,false,</lstPt></object><object eType="OBJECT_STROKE" width="2"><lstPt>450,210,470,230,</lstPt></object>',
      ),
    )
  ).pages;
  const api = sceneAPI();
  api.updateScene({ elements: board.elements });
  const table = readInsertions(api)[0];
  expect(table).toMatchObject({
    rows: 2,
    columns: 2,
    position: { x: 100, y: 100 },
    rowHeights: [80, 100],
    columnWidths: [100, 200],
    strokeWidth: 5,
  });
  expect(table.opacity).toBeCloseTo(60);
  const content = board.elements.filter(
    (element) => element.customData?.fcInsertion?.inkCell !== undefined,
  );
  expect(content).toHaveLength(2);
  expect(
    content.every((element) => element.customData?.fcInsertion.inkCell === 3),
  ).toBe(true);
  const external = board.elements.find((element) => element.x === 450)!;
  expect(external.customData?.fcInsertion).toBeUndefined();
  await renderInsertion(api, changeTableTrack(table, "column.add"), true, {
    exact: true,
  });
  for (const element of content) {
    expect(
      api.getSceneElements().find((candidate) => candidate.id === element.id),
    ).toMatchObject({
      x: element.x,
      y: element.y,
      customData: { fcInsertion: { inkCell: 4 } },
      ...(element.type === "text"
        ? { text: "原文", fontSize: 20 }
        : { points: element.type === "freedraw" ? element.points : undefined }),
    });
  }
  const newWriting = [
    newFreeDrawElement({
      type: "freedraw",
      x: 175,
      y: 155,
      simulatePressure: true,
      points: [pointFrom(0, 0), pointFrom(80, 45)],
    }),
  ];
  const expanded = growBoardTableWriting(
    [...api.getSceneElements(), ...newWriting],
    new Set(newWriting.map((element) => element.id)),
  );
  api.updateScene({ elements: expanded });
  expect(readInsertions(api)[0]).toMatchObject({
    columnWidths: [175, 200, 150],
    rowHeights: [120, 100],
  });
  const movedText = expanded.find(
    (element) =>
      element.id === content.find((element) => element.type === "text")!.id,
  )!;
  expect(movedText).toMatchObject({ x: 320, y: 280, fontSize: 20 });
  expect(expanded.find((element) => element.id === external.id)).toEqual(
    external,
  );
  expect(
    expanded
      .filter(
        (element) =>
          element.customData?.fcInsertion?.inkCell === undefined &&
          element.customData?.fcInsertion?.id === table.id,
      )
      .every(
        (element) =>
          element.strokeWidth === 5 && Math.abs(element.opacity - 60) < 1e-8,
      ),
  ).toBe(true);
});

it("writes one original OBJECT_TABLE per grid and preserves unequal geometry and content through a factory-only round trip", async () => {
  const api = sceneAPI();
  api.updateScene({ elements: [] });
  await renderInsertion(
    api,
    {
      ...insertionDefaults("table", { x: 80, y: 90 }),
      rows: 2,
      columns: 2,
      width: 300,
      height: 180,
      columnWidths: [100, 200],
      rowHeights: [80, 100],
      cells: ["A", "B", "C", "D"],
      color: "#123456",
      strokeWidth: 5,
      opacity: 60,
    },
    true,
    { exact: true },
  );
  const original = { ...page(), elements: [...api.getSceneElements()] };
  const saved = serializeBzd([original, page()]);
  const xml = new DOMParser().parseFromString(saved, "application/xml");
  const slide = xml.querySelector("slide")!;
  expect(slide.getAttribute("ObjectCount")).toBe("5");
  const table = slide.querySelector('object[eType="OBJECT_TABLE"]')!;
  expect(table.getAttribute("tableVerticalLines")).toBe(
    "80,90,80,270;180,90,180,270;380,90,380,270;",
  );
  expect(table.getAttribute("tableHorizontalLines")).toBe(
    "80,90,380,90;80,170,380,170;80,270,380,270;",
  );
  expect(table.getAttribute("tableVerLine")).toBe("2");
  expect(table.getAttribute("width")).toBe("5");
  expect(slide.querySelectorAll('object[eType="OBJECT_TEXT"]')).toHaveLength(4);
  expect(slide.querySelectorAll('object[eType="OBJECT_STROKE"]')).toHaveLength(
    0,
  );
  const [restored, other] = (await parseBzd(withoutExtension(saved))).pages;
  api.updateScene({ elements: restored.elements });
  expect(readInsertions(api)[0]).toMatchObject({
    position: { x: 80, y: 90 },
    columnWidths: [100, 200],
    rowHeights: [80, 100],
    color: "#123456",
  });
  expect(
    restored.elements
      .filter((element) => element.type === "text")
      .map((element) => element.type === "text" && element.text),
  ).toEqual(["A", "B", "C", "D"]);
  expect(other.elements).toHaveLength(page().elements.length);
});

it("restores the source's old two-corner table format with its stored row/column counts", async () => {
  const [restored] = (
    await parseBzd(nativeTable('tableVerLine="3" tableHorLine="2"'))
  ).pages;
  const api = sceneAPI();
  api.updateScene({ elements: restored.elements });
  expect(readInsertions(api)[0]).toMatchObject({
    position: { x: 100, y: 100 },
    width: 300,
    height: 180,
    columns: 3,
    rows: 2,
  });
});

it("rejects incomplete, duplicate, nonrectangular and over-budget native grids without a partial page", async () => {
  for (const attributes of [
    'tableVerticalLines="100,100,100,280;400,100,400,280;"',
    unequalGrid.replace("200,100,200,280", "100,100,100,280"),
    unequalGrid.replace("200,100,200,280", "200,100,220,280"),
    'tableVerLine="50000" tableHorLine="2"',
  ]) {
    await expect(parseBzd(nativeTable(attributes))).rejects.toThrow();
  }
});
it("rejects malformed XML and external entities without returning a partial board", async () => {
  for (const xml of [
    "{}",
    "<bzd><slide></bzd>",
    '<!DOCTYPE bzd [<!ENTITY private SYSTEM "file:///private">]><bzd><slide/></bzd>',
  ]) {
    await expect(parseBzd(xml)).rejects.toThrow();
  }
});
