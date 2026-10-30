import { convertToFcboardElements } from "@fcboard/fcboard";

import { parseBzd, serializeBzd } from "./bzd";
import {
  readInsertions,
  renderInsertion,
  mindMapNodes,
  insertionShapes,
} from "./insertObjects";
import { changeMindMapNode } from "./mindMap";
import {
  boardWritingParts,
  insertionWritingTargets,
  insertionWritingText,
} from "./insertionWriting";
import { insertionLabelParts } from "./insertionLabels";
import { sceneAPI } from "./test/scene";

const node = (
  id: string,
  parent: string,
  rect: number[],
  columns = 1,
  direction = "right",
) =>
  `<object nId="${id}" eType="OBJECT_Note" nRGBA_R="14" nRGBA_G="212" nRGBA_B="159" nRGBA_A="204" width="2" nodeAddDirections="${direction}" nodeColumns="${columns}" nodeLeftId="${parent}" nodeRectLeft="${rect[0]}" nodeRectTop="${rect[1]}" nodeRectRight="${rect[2]}" nodeRectBottom="${rect[3]}"><lstPt/></object>`;
const text = (
  id: string,
  key: string,
  owner: string,
  value: string,
  r = 255,
  b = 0,
) =>
  `<object nId="${id}" eType="OBJECT_TEXT" nRGBA_R="${r}" nRGBA_G="0" nRGBA_B="${b}" nRGBA_A="255" width="1" text="${value}" ${key}="${owner}"><lstPt>-10,-10,false,</lstPt></object>`;
const xml = (objects: string) =>
  `<bzd><slide name="原节点" zSlideType="SLIDE_PATTERN_0" zSlideColor="-1">${objects}</slide></bzd>`;
const original = () =>
  xml(
    [
      node("child", "root", [600, 400, 990, 550], 4),
      text("word-1", "mNoteId", "root", "Root"),
      node("root", "", [200, 600, 500, 750]),
      text("word-2", "mNoteId", "root", "words", 0, 255),
      node("leaf", "child", [1100, 430, 1400, 610], 5, "bottom"),
      text("word-3", "mNoteId", "child", "Child"),
      text("word-4", "mNoteId", "leaf", "Leaf"),
    ].join(""),
  );
const nativeOnly = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  doc.querySelectorAll("fcboard").forEach((element) => element.remove());
  return new XMLSerializer().serializeToString(doc);
};

it("restores real node rectangles, parents, colors and owned labels regardless of XML order, without drawing off-board text markers", async () => {
  const [board] = await parseBzd(original());
  const api = sceneAPI();
  api.updateScene({ elements: board.elements });
  const map = readInsertions(api)[0];
  expect(map.outline).toBe("Root words\n  Child\n    Leaf");
  expect(map.position).toEqual({ x: 200, y: 600 });
  const nodes = mindMapNodes(map);
  expect(nodes.map(({ parent }) => parent)).toEqual([-1, 0, 1]);
  expect(nodes.map(({ width, height }) => [width, height])).toEqual([
    [300, 150],
    [390, 150],
    [300, 180],
  ]);
  expect(map.nodeStyles?.map(({ columns }) => columns)).toEqual([1, 4, 5]);
  expect(map.nodeStyles?.[2].direction).toBe("bottom");
  expect(board.elements.some((element) => element.x === -10)).toBe(false);
  const labels = board.elements.filter(
    (element) =>
      element.type === "text" &&
      element.customData?.fcInsertion?.textIndex === 0,
  );
  expect(new Set(labels.map((element) => element.strokeColor))).toEqual(
    new Set(["#ff0000", "#0000ff"]),
  );
  expect(labels[0].x).toBeGreaterThanOrEqual(230);
  expect(
    board.elements
      .filter((element) => element.type === "rectangle")
      .map((element) => [element.x, element.y, element.width, element.height]),
  ).toEqual([
    [200, 600, 300, 150],
    [600, 400, 390, 150],
    [1100, 430, 300, 180],
  ]);
  const link = board.elements.find((element) => element.type === "line")!;
  expect(link.type === "line" && link.points).toHaveLength(17);
  expect(link.strokeWidth).toBe(6);
});

it("preserves per-node native geometry and colored words through move, clear, add, delete and native-only save/read", async () => {
  const [board] = await parseBzd(original());
  const api = sceneAPI();
  api.updateScene({ elements: board.elements });
  let map = readInsertions(api)[0];
  const moved = changeMindMapNode(map, 1, "move", { x: 480, y: -180 })!;
  await renderInsertion(api, moved, true, { exact: true });
  map = readInsertions(api)[0];
  expect(mindMapNodes(map)[1]).toMatchObject({
    x: 480,
    y: -180,
    width: 390,
    height: 150,
  });
  expect(mindMapNodes(map)[2]).toMatchObject({
    x: 900,
    y: -170,
    width: 300,
    height: 180,
  });
  const added = changeMindMapNode(map, 1, "add")!;
  expect(mindMapNodes(added)[3]).toMatchObject({
    parent: 1,
    x: 970,
    y: 50,
    width: 300,
    height: 150,
  });
  expect(added.nodeStyles?.[3].columns).toBe(5);
  expect(changeMindMapNode(added, 1, "clear")?.outline).toBe(
    "Root words\n  \n    Leaf\n    ",
  );
  expect(changeMindMapNode(added, 1, "delete")?.nodeStyles).toHaveLength(1);
  const saved = nativeOnly(
    serializeBzd([{ ...board, elements: api.getSceneElements() }]),
  );
  const doc = new DOMParser().parseFromString(saved, "application/xml");
  expect(doc.querySelectorAll('object[eType="OBJECT_Note"]')).toHaveLength(3);
  expect(doc.querySelectorAll('object[eType="OBJECT_STROKE"]')).toHaveLength(0);
  const [reopened] = await parseBzd(saved);
  api.updateScene({ elements: reopened.elements });
  const actual = readInsertions(api)[0];
  expect(actual.outline).toBe(map.outline);
  expect(actual.nodeStyles).toEqual(map.nodeStyles);
  expect(
    mindMapNodes(actual).map(({ x, y, width, height }) => ({
      x,
      y,
      width,
      height,
    })),
  ).toEqual(
    mindMapNodes(map).map(({ x, y, width, height }) => ({
      x,
      y,
      width,
      height,
    })),
  );
  expect(
    new Set(
      reopened.elements
        .filter(
          (element) =>
            element.type === "text" &&
            element.customData?.fcInsertion?.textIndex === 0,
        )
        .map((element) => element.strokeColor),
    ),
  ).toEqual(new Set(["#ff0000", "#0000ff"]));
});

it("keeps original word colors when recognition appends to a restored node and clears erased labels before a later rebuild", async () => {
  const [board] = await parseBzd(original());
  const api = sceneAPI();
  api.updateScene({ elements: board.elements });
  const target = insertionWritingTargets(boardWritingParts(board.elements))[0];
  const shape = insertionWritingText(target, "again", "#00ff00", ["ink"])!;
  const parts = insertionLabelParts(
    shape,
    shape.customData?.fcInsertion.textRuns[0],
  );
  expect(new Set(parts.map((part) => part.strokeColor))).toEqual(
    new Set(["#ff0000", "#0000ff", "#00ff00"]),
  );
  const remaining = board.elements.filter(
    (element) =>
      element.type !== "text" ||
      element.customData?.fcInsertion?.textIndex !== 0,
  );
  api.updateScene({
    elements: [...remaining, ...convertToFcboardElements(parts)],
  });
  expect(readInsertions(api)[0].outline.split("\n")[0]).toBe(
    "Root words again",
  );
  api.updateScene({ elements: remaining });
  const cleared = readInsertions(api)[0];
  expect(cleared.outline.split("\n")[0]).toBe("");
  expect(
    insertionShapes(cleared).filter(
      (shape) => shape.type === "text" && shape.insertionText === 0,
    ),
  ).toEqual([]);
});

it.each([
  ["1,0,100,0,1,200,0,0,1", 100, 200, 384, 216],
  ["0,-1,500,1,0,100,0,0,1", 284, 100, 216, 384],
  ["0.1,0,100,0,0.1,200,0,0,1", 100, 200, 38.4, 21.6],
])(
  "restores an original four-line matrix %s and keeps alphabet-owned words editable",
  async (matrix, x, y, width, height) => {
    const [board] = await parseBzd(
      xml(
        `<object nId="alphabet" eType="OBJECT_ALPHABET" nRGBA_R="14" nRGBA_G="212" nRGBA_B="159" nRGBA_A="255" width="2" matrix="${matrix}"><lstPt/></object>${text(
          "word",
          "alphabetId",
          "alphabet",
          "Hello",
        )}`,
      ),
    );
    const api = sceneAPI();
    api.updateScene({ elements: board.elements });
    const paper = readInsertions(api)[0];
    expect(paper.kind).toBe("fourline");
    expect(paper.position.x).toBeCloseTo(x);
    expect(paper.position.y).toBeCloseTo(y);
    expect(paper.width).toBeCloseTo(width);
    expect(paper.height).toBeCloseTo(height);
    expect(paper.text).toBe("Hello");
    const native = nativeOnly(serializeBzd([board]));
    expect(native).toContain('eType="OBJECT_ALPHABET"');
    expect(native).toContain('alphabetId="');
    const [restored] = await parseBzd(native);
    api.updateScene({ elements: restored.elements });
    expect(readInsertions(api)[0].text).toBe("Hello");
  },
);

it("rejects invalid node graphs and singular alphabet transforms while keeping orphan labels hidden as in HSmaTextObject", async () => {
  await expect(
    parseBzd(
      xml(
        node("same", "", [0, 0, 300, 150]) +
          node("same", "", [500, 0, 800, 150]),
      ),
    ),
  ).rejects.toThrow("node ID");
  await expect(
    parseBzd(
      xml(
        node("a", "b", [0, 0, 300, 150]) + node("b", "a", [500, 0, 800, 150]),
      ),
    ),
  ).rejects.toThrow("Cyclic");
  await expect(
    parseBzd(
      xml(
        '<object nId="a" eType="OBJECT_ALPHABET" matrix="1,0,0,0,1,0,0,0,0"/>',
      ),
    ),
  ).rejects.toThrow("matrix");
  const [board] = await parseBzd(
    xml(text("orphan", "mNoteId", "missing", "hidden")),
  );
  expect(board.elements).toEqual([]);
});
