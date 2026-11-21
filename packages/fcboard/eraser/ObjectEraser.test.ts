import * as elements from "@fcboard/element";
import { Scene, newElementWith, syncInvalidIndices } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";

import type { FcboardElement } from "@fcboard/element/types";
import type { LocalPoint } from "@fcboard/math";

import { API } from "../tests/helpers/api";

import { ObjectEraser } from "./ObjectEraser";
import * as strokeGeometry from "./stroke";

const eraseSceneObjects = (
  input: readonly FcboardElement[],
  samples: readonly { x: number; y: number }[],
  width: number,
  height: number,
) => {
  const scene = new Scene(syncInvalidIndices(input));
  const eraser = new ObjectEraser(scene);
  try {
    return eraser.erase(samples, width, height);
  } finally {
    eraser.dispose();
    scene.destroy();
  }
};
afterEach(() => vi.restoreAllMocks());

describe("indexed object erasure", () => {
  it("reuses unchanged ink geometry across local misses, invalidates a move and allocates only the deleted object on a hit", () => {
    const ink = {
      ...API.createElement({
        type: "freedraw",
        x: 0,
        y: 0,
        points: [
          pointFrom(0, 0),
          pointFrom(100, 0),
          pointFrom(100, 100),
          pointFrom(0, 100),
        ],
        strokeWidth: 2,
      }),
      customData: { fcInk: { version: 2, pen: "hard", unit: 1 } },
    };
    const scene = new Scene(syncInvalidIndices([ink]));
    const eraser = new ObjectEraser(scene);
    const prepare = vi.spyOn(strokeGeometry, "prepareNativeEraseStroke");
    const create = vi.spyOn(elements, "newElementWith");
    try {
      for (let index = 0; index < 20; index++) {
        expect(eraser.erase([{ x: 50, y: 50 }], 4, 4)).toBe(
          scene.getElementsIncludingDeleted(),
        );
      }
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(create).not.toHaveBeenCalled();
      scene.mutateElement(ink, { x: 300 });
      expect(eraser.erase([{ x: 350, y: 50 }], 4, 4)).toBe(
        scene.getElementsIncludingDeleted(),
      );
      expect(prepare).toHaveBeenCalledTimes(2);
      expect(eraser.erase([{ x: 350, y: 0 }], 4, 4)[0].isDeleted).toBe(true);
      expect(create).toHaveBeenCalledTimes(1);
      expect(prepare).toHaveBeenCalledTimes(2);
    } finally {
      eraser.dispose();
      scene.destroy();
    }
  });
  it("deletes a fully covered dense stroke without preparing its centerline", () => {
    const ink = API.createElement({
      type: "freedraw",
      x: 20,
      y: 20,
      width: 19,
      height: 19,
      points: Array.from({ length: 10000 }, (_, index) =>
        pointFrom<LocalPoint>(index % 20, Math.floor(index / 20) % 20),
      ),
      strokeWidth: 2,
    });
    const prepare = vi.spyOn(strokeGeometry, "prepareNativeEraseStroke");
    const result = eraseSceneObjects([ink], [{ x: 30, y: 30 }], 100, 100);
    expect(result[0].isDeleted).toBe(true);
    expect(prepare).not.toHaveBeenCalled();
  });
  it.each(["fcInsertion", "fcWidget", "fcPlot", "fcLanguage"])(
    "erases every part of one semantic %s object while preserving other kinds, missing identities and locks",
    (kind) => {
      const meta = (key: string, id?: string) => ({
        [key]: { ...(key === "fcLanguage" ? { group: id } : { id }) },
      });
      const shape = (
        x: number,
        data: Record<string, unknown>,
        locked = false,
      ) => ({
        ...API.createElement({
          type: "rectangle",
          x,
          y: 20,
          width: 20,
          height: 20,
          backgroundColor: "#ff0000",
          locked,
        }),
        customData: data,
      });
      const target = shape(20, meta(kind, "same"));
      const part = shape(500, meta(kind, "same"));
      const locked = shape(700, meta(kind, "same"), true);
      const otherKind = shape(
        900,
        meta(kind === "fcWidget" ? "fcInsertion" : "fcWidget", "same"),
      );
      const noId = shape(1100, meta(kind));
      const result = eraseSceneObjects(
        [target, part, locked, otherKind, noId],
        [{ x: 30, y: 30 }],
        10,
        10,
      );
      expect(result.map((element) => element.isDeleted)).toEqual([
        true,
        true,
        false,
        false,
        false,
      ]);
    },
  );
  it("hits the smoothed painted curve without deleting the empty control-point position", () => {
    const ink = {
      ...API.createElement({
        type: "freedraw",
        x: 0,
        y: 0,
        points: [pointFrom(0, 0), pointFrom(100, 200), pointFrom(200, 0)],
        strokeWidth: 4,
      }),
      customData: { fcInk: { version: 2, pen: "hard", unit: 1 } },
    };
    expect(eraseSceneObjects([ink], [{ x: 100, y: 200 }], 6, 6)[0]).toBe(ink);
    expect(
      eraseSceneObjects([ink], [{ x: 100, y: 150 }], 6, 6)[0].isDeleted,
    ).toBe(true);
  });
  it("refreshes an active writer whose new points have not emitted a committed mutation", () => {
    const ink = API.createElement({
      type: "freedraw",
      x: 100,
      y: 100,
      points: [pointFrom(0, 0), pointFrom(10, 0)],
      strokeWidth: 4,
    });
    const scene = new Scene(syncInvalidIndices([ink]));
    const eraser = new ObjectEraser(scene);
    try {
      scene.mutateElement(
        ink,
        {
          points: [
            pointFrom<import("@fcboard/math").LocalPoint>(0, 0),
            pointFrom<import("@fcboard/math").LocalPoint>(600, 0),
          ],
          width: 600,
        },
        { informMutation: false, isDragging: false },
      );
      expect(
        eraser.erase([{ x: 650, y: 100 }], 20, 20, new Set([ink.id]))[0]
          .isDeleted,
      ).toBe(true);
    } finally {
      eraser.dispose();
      scene.destroy();
    }
  });
  it("uses every bend of a coalesced object sweep without joining its endpoints across empty space", () => {
    const touched = API.createElement({
      type: "rectangle",
      x: 95,
      y: 95,
      width: 10,
      height: 10,
    });
    const gap = API.createElement({
      type: "rectangle",
      x: 45,
      y: 45,
      width: 10,
      height: 10,
    });
    const samples = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const output = eraseSceneObjects([touched, gap], samples, 12, 12);
    expect(output[0].isDeleted).toBe(true);
    expect(output[1]).toBe(gap);
    expect(eraseSceneObjects([gap], [], 12, 12)).toEqual([gap]);
  });
  it("sweeps the complete object footprint between fast samples and removes its group without touching locked contents", () => {
    const line = API.createElement({
      type: "line",
      x: 100,
      y: 100,
      points: [pointFrom(0, 0), pointFrom(200, 0)],
      groupIds: ["one-object"],
    });
    const part = API.createElement({
      type: "line",
      x: 100,
      y: 400,
      points: [pointFrom(0, 0), pointFrom(200, 0)],
      groupIds: ["one-object"],
    });
    const locked = API.createElement({
      type: "rectangle",
      x: 200,
      y: 100,
      locked: true,
      groupIds: ["one-object"],
    });
    const outside = API.createElement({ type: "line", x: 100, y: 500 });
    const result = eraseSceneObjects(
      [line, part, locked, outside],
      [
        { x: 0, y: 110 },
        { x: 500, y: 110 },
      ],
      20,
      30,
    );
    expect(
      result
        .filter((element) => element.isDeleted)
        .map((element) => element.id),
    ).toEqual([line.id, part.id]);
    expect(result.find((element) => element.id === locked.id)).toBe(locked);
    expect(result.find((element) => element.id === outside.id)).toBe(outside);
  });

  it("does not erase the empty interior of an outline shape but erases a filled shape at the same position", () => {
    const outline = API.createElement({
      type: "rectangle",
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      backgroundColor: "transparent",
    });
    const elements = [outline];
    expect(
      eraseSceneObjects(
        elements,
        [
          { x: 180, y: 180 },
          { x: 220, y: 220 },
        ],
        10,
        10,
      ),
    ).toBe(elements);
    const filled = { ...outline, backgroundColor: "#ff0000" };
    expect(
      eraseSceneObjects(
        [filled],
        [
          { x: 180, y: 180 },
          { x: 220, y: 220 },
        ],
        10,
        10,
      )[0].isDeleted,
    ).toBe(true);
  });

  it("does not recompute distant bounds for repeated local or empty sweeps on a dense scene", () => {
    const target = API.createElement({
      type: "rectangle",
      x: 100,
      y: 100,
      width: 20,
      height: 20,
      backgroundColor: "#ff0000",
    });
    const distant = Array.from({ length: 3000 }, (_, index) =>
      API.createElement({
        type: "rectangle",
        x: 5000 + index * 300,
        y: 5000,
        width: 20,
        height: 20,
      }),
    );
    const scene = new Scene(syncInvalidIndices([target, ...distant]));
    const eraser = new ObjectEraser(scene);
    const bounds = vi.spyOn(elements, "getElementBounds");
    try {
      for (let index = 0; index < 20; index++) {
        expect(eraser.erase([{ x: -500, y: -500 }], 20, 20)).toBe(
          scene.getElementsIncludingDeleted(),
        );
      }
      expect(bounds).not.toHaveBeenCalled();
      expect(eraser.erase([{ x: 110, y: 110 }], 20, 20)[0].isDeleted).toBe(
        true,
      );
      expect(
        bounds.mock.calls.every(([element]) => element.id === target.id),
      ).toBe(true);
    } finally {
      eraser.dispose();
      scene.destroy();
    }
  });
  it("tracks in-place moves, lock changes, deletion and undo without stale occupied cells", () => {
    const target = API.createElement({
      type: "rectangle",
      x: 100,
      y: 100,
      width: 20,
      height: 20,
      backgroundColor: "#ff0000",
    });
    const scene = new Scene(syncInvalidIndices([target]));
    const eraser = new ObjectEraser(scene);
    try {
      scene.mutateElement(target, { x: 900 });
      expect(eraser.erase([{ x: 110, y: 110 }], 10, 10)).toBe(
        scene.getElementsIncludingDeleted(),
      );
      expect(eraser.erase([{ x: 910, y: 110 }], 10, 10)[0].isDeleted).toBe(
        true,
      );
      scene.mutateElement(target, { locked: true });
      expect(eraser.erase([{ x: 910, y: 110 }], 10, 10)).toBe(
        scene.getElementsIncludingDeleted(),
      );
      const unlocked = newElementWith(target, { locked: false });
      scene.replaceAllElements([unlocked]);
      const deleted = eraser.erase([{ x: 910, y: 110 }], 10, 10);
      scene.replaceAllElements(deleted);
      expect(eraser.erase([{ x: 910, y: 110 }], 10, 10)).toBe(
        scene.getElementsIncludingDeleted(),
      );
      scene.replaceAllElements([unlocked]);
      expect(eraser.erase([{ x: 910, y: 110 }], 10, 10)[0].isDeleted).toBe(
        true,
      );
      scene.replaceAllElements([]);
      expect(eraser.erase([{ x: 910, y: 110 }], 10, 10)).toBe(
        scene.getElementsIncludingDeleted(),
      );
    } finally {
      eraser.dispose();
      scene.destroy();
    }
  });
  it("indexes rendered brush width beyond its raw zero-height point bounds", () => {
    const brush = {
      ...API.createElement({
        type: "freedraw",
        x: 100,
        y: 100,
        points: [pointFrom(0, 0), pointFrom(100, 0)],
        strokeWidth: 4,
      }),
      customData: {
        fcInk: {
          version: 3,
          pen: "brush",
          unit: 1,
          variation: 45,
          brushWidths: [10, 10],
          finished: true,
        },
      },
    };
    expect(
      eraseSceneObjects([brush], [{ x: 150, y: 109 }], 4, 4)[0].isDeleted,
    ).toBe(true);
    expect(eraseSceneObjects([brush], [{ x: 150, y: 113 }], 4, 4)[0]).toBe(
      brush,
    );
  });
  it("removes bound labels with their container, keeps unrelated nearby objects, and handles very large objects", () => {
    const container = API.createElement({
      type: "rectangle",
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      backgroundColor: "#ff0000",
    });
    const text = API.createElement({
      type: "text",
      x: 500,
      y: 500,
      text: "label",
      containerId: container.id,
    });
    const bound = newElementWith(container, {
      boundElements: [{ id: text.id, type: "text" }],
    });
    const unrelated = API.createElement({
      type: "rectangle",
      x: 300,
      y: 300,
      width: 10,
      height: 10,
    });
    const result = eraseSceneObjects(
      [bound, text, unrelated],
      [{ x: 110, y: 110 }],
      10,
      10,
    );
    expect(result.map((element) => element.isDeleted)).toEqual([
      true,
      true,
      false,
    ]);
    const huge = API.createElement({
      type: "rectangle",
      x: -10000,
      y: -10000,
      width: 20000,
      height: 20000,
      backgroundColor: "#ff0000",
    });
    expect(
      eraseSceneObjects([huge], [{ x: 0, y: 0 }], 10, 10)[0].isDeleted,
    ).toBe(true);
  });
});
