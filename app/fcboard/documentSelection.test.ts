import {
  documentSelectionIds,
  reorderDocumentSelection,
} from "./documentSelection";
import { documentSelectionProperties } from "./selectionCapabilities";
import { documentStrokeGeometry } from "./documentInk";
import {
  eraseDocumentInk,
  eraseDocumentObjects,
  eraseDocumentRegion,
  shapeInk,
} from "./documents";

import type { InkStroke } from "./documents";
const ink = (id: string): InkStroke => ({
  id,
  color: "#000000",
  width: 2,
  points: [
    [0, 0],
    [100, 0],
  ],
});
it("moves across a whole composite and keeps all composite parts and selected units in order", () => {
  const widget = { id: "table" } as NonNullable<InkStroke["insertion"]>;
  const rows = [
    ink("a"),
    { ...ink("b"), insertion: widget },
    { ...ink("c"), insertion: widget },
    ink("d"),
    ink("e"),
  ];
  expect(
    reorderDocumentSelection(rows, new Set(["a"]), "bringForward").map(
      (stroke) => stroke.id,
    ),
  ).toEqual(["b", "c", "a", "d", "e"]);
  expect(
    reorderDocumentSelection(rows, new Set(["b"]), "bringForward").map(
      (stroke) => stroke.id,
    ),
  ).toEqual(["a", "d", "b", "c", "e"]);
  expect(
    reorderDocumentSelection(rows, new Set(["b", "d"]), "bringToFront").map(
      (stroke) => stroke.id,
    ),
  ).toEqual(["a", "e", "b", "c", "d"]);
  expect(
    reorderDocumentSelection(rows, new Set(["d"]), "sendBackward").map(
      (stroke) => stroke.id,
    ),
  ).toEqual(["a", "d", "b", "c", "e"]);
  expect(
    reorderDocumentSelection(rows, new Set(["d", "e"]), "sendToBack").map(
      (stroke) => stroke.id,
    ),
  ).toEqual(["d", "e", "a", "b", "c"]);
  expect(reorderDocumentSelection(rows, new Set(["e"]), "bringForward")).toBe(
    rows,
  );
  expect([...documentSelectionIds(rows, new Set(["b"]))]).toEqual(["b", "c"]);
});
it("preserves the real shape type through courseware and hides unsupported text/image style controls", () => {
  const box = shapeInk(
    { id: "box", type: "rectangle", x: 10, y: 10, width: 100, height: 100 },
    "shape",
  );
  expect(documentSelectionProperties([box])).toMatchObject({
    border: true,
    color: true,
    opacity: true,
    fill: true,
    layers: true,
  });
  expect(
    documentSelectionProperties([{ ...ink("t"), text: "word" }]),
  ).toMatchObject({
    text: true,
    border: false,
    opacity: false,
    color: true,
    fill: false,
  });
  expect(
    documentSelectionProperties([
      { ...ink("i"), image: "data:image/png;base64,image" },
    ]),
  ).toMatchObject({ border: false, opacity: false, color: false, fill: false });
  expect(documentSelectionProperties([ink("a"), ink("b")])).toMatchObject({
    border: false,
    opacity: false,
    lock: false,
  });
});
it("lets explicit solid/dashed/dotted styles override the original dashed pen on display and snapshots", () => {
  const stroke = { ...ink("d"), fcInk: { version: 2, pen: "dashed", unit: 1 } };
  expect(documentStrokeGeometry(stroke).dashes).toBeDefined();
  expect(
    documentStrokeGeometry({ ...stroke, strokeStyle: "solid" }).dashes,
  ).toBeUndefined();
  expect(
    documentStrokeGeometry({ ...stroke, strokeStyle: "dotted" }).dashes?.[0],
  ).toBe(0);
});
it("preserves locked ink in all eraser modes while other ink remains erasable", () => {
  const locked = { ...ink("locked"), locked: true };
  const ordinary = ink("ordinary");
  const rows = [locked, ordinary];
  expect(eraseDocumentInk(rows, [50, -20], [50, 20], 20, 20)[0]).toBe(locked);
  expect(eraseDocumentObjects(rows, [50, -20], [50, 20], 20, 20)).toEqual([
    locked,
  ]);
  expect(
    eraseDocumentRegion(rows, [
      [-10, -10],
      [110, -10],
      [110, 10],
      [-10, 10],
    ]),
  ).toEqual([locked]);
});

it("exposes fill for a closed shape-pen triangle and crop only for a single ungrouped image", () => {
  const triangle: InkStroke = {
    ...ink("triangle"),
    shapeType: "line",
    points: [
      [0, 0],
      [100, 0],
      [50, 100],
      [0, 0],
    ],
  };
  expect(documentSelectionProperties([triangle]).fill).toBe(true);
  expect(
    documentSelectionProperties([
      {
        ...triangle,
        points: [
          [0, 0],
          [100, 0],
        ],
      },
    ]).fill,
  ).toBe(false);
  expect(
    documentSelectionProperties([
      { ...ink("img"), image: "data:image/png;base64,a" },
    ]).image,
  ).toBe(true);
  expect(
    documentSelectionProperties([
      { ...ink("img"), image: "data:image/png;base64,a" },
      ink("other"),
    ]).image,
  ).toBe(false);
});
