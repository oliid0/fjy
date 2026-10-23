import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import { t } from "@excalidraw/excalidraw/i18n";
import { factoryBrushWidths } from "@excalidraw/element/factoryBrush";

import { Fonts } from "@excalidraw/excalidraw/fonts";

import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { render } from "./test/render";
import { FilePreview } from "./FilePreview";
import { classroomCommands } from "./commands";
import { documentInkElement } from "./documentInk";
import { documentSourceSignature, loadInk } from "./documents";
import * as ocr from "./ocr";

vi.mock("./documents", async (original) => ({
  ...(await original<typeof import("./documents")>()),
  documentKey: vi.fn().mockResolvedValue("document-key"),
  loadInk: vi.fn().mockResolvedValue({}),
  saveInk: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(loadInk).mockResolvedValue({});
});

const setup = async (
  mode?: AppState["currentItemInkAssist"],
  preferences: Partial<AppState> = {},
) => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:document");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: 1000,
    bottom: 600,
    width: 1000,
    height: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  let state: AppState = {
    ...getDefaultAppState(),
    width: 1000,
    height: 600,
    offsetLeft: 0,
    offsetTop: 0,
    currentItemInkAssist: mode,
    ...preferences,
  };
  const listeners = new Set<(elements: [], state: AppState) => void>();
  const update = vi.fn(({ appState }: { appState?: Partial<AppState> }) => {
    state = { ...state, ...appState };
    listeners.forEach((notify) => notify([], state));
  });
  const api = {
    getAppState: () => state,
    getSceneElements: () => [],
    updateScene: update,
    onChange: (notify: (elements: [], state: AppState) => void) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
  } as unknown as ExcalidrawImperativeAPI;
  const file = new File(["image"], "slide.png");
  const view = render(<FilePreview api={api} file={file} onClose={() => {}} />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: t("fcboard.板书开关") }),
    ).toBeEnabled(),
  );
  const svg = screen.getByLabelText(t("fcboard.课件透明板书"));
  const captures = new Set<number>();
  Object.assign(svg, {
    setPointerCapture: (id: number) => captures.add(id),
    hasPointerCapture: (id: number) => captures.has(id),
    releasePointerCapture: (id: number) => captures.delete(id),
  });
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: 1000,
    bottom: 600,
    width: 1000,
    height: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.板书开关") }));
  const pointer = (
    type: string,
    x: number,
    y: number,
    extra: Record<string, unknown> = {},
  ) =>
    fireEvent(
      svg,
      Object.assign(new Event(type, { bubbles: true }), {
        isPrimary: true,
        pointerId: 1,
        pointerType: "pen",
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        pressure: 0.6,
        width: 1,
        height: 1,
        clientX: x,
        clientY: y,
        ...extra,
      }),
    );
  const draw = () => {
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 180, 140, {
      getCoalescedEvents: () => [
        { clientX: 120, clientY: 110, pressure: 0.2 },
        { clientX: 150, clientY: 120, pressure: 0.8 },
      ],
    });
    pointer("pointerup", 200, 140);
  };
  return { ...view, api, update, svg, pointer, draw };
};

it("retains coalesced pressure samples, renders quadratics and restores a cancelled barrel erasure", async () => {
  const { draw, svg, pointer, update } = await setup();
  draw();
  const before = classroomCommands.read("document") as {
    ink: import("./documents").InkStroke[];
  };
  expect(before.ink[0].points).toEqual([
    [100, 100],
    [120, 110],
    [150, 120],
    [180, 140],
    [200, 140],
  ]);
  expect(before.ink[0].pressures).toEqual([0.6, 0.2, 0.8, 0.6, 0.6]);
  expect(svg.querySelector("path")?.getAttribute("d")).toContain("Q");
  pointer("pointerdown", 150, 120, { button: 2, buttons: 2 });
  pointer("pointercancel", 150, 120);
  expect((classroomCommands.read("document") as typeof before).ink).toEqual(
    before.ink,
  );
  expect(update).not.toHaveBeenCalled();
});

it.each(["calculation", "function", "text"] as const)(
  "executes the %s pen on the visible courseware and preserves the hidden canvas",
  async (mode) => {
    const recognize = vi
      .spyOn(ocr, "recognizeHandwriting")
      .mockResolvedValue(
        mode === "calculation"
          ? "0.1+0.2="
          : mode === "function"
          ? "y=x^2"
          : "课堂笔记",
      );
    const { draw, update } = await setup(mode);
    vi.useFakeTimers();
    draw();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    const { ink } = classroomCommands.read("document") as {
      ink: import("./documents").InkStroke[];
    };
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(recognize.mock.calls[0][5]).toEqual([
      [
        [100, 100],
        [120, 110],
        [150, 120],
        [180, 140],
        [200, 140],
      ],
    ]);
    if (mode === "function") {
      expect(ink.some((stroke) => stroke.plot?.plot.expression === "x^2")).toBe(
        true,
      );
    } else {
      expect(ink.find((stroke) => stroke.text)?.text).toBe(
        mode === "text" ? "课堂笔记" : "0.3",
      );
      expect(ink.filter((stroke) => stroke.fcInk)).toHaveLength(
        mode === "text" ? 0 : 1,
      );
    }
    expect(update).not.toHaveBeenCalled();
  },
);

it("discards recognition after its source is erased", async () => {
  let finish!: (text: string) => void;
  vi.spyOn(ocr, "recognizeHandwriting").mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { draw, update } = await setup("text");
  vi.useFakeTimers();
  draw();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700);
  });
  const source = (
    classroomCommands.read("document") as {
      ink: import("./documents").InkStroke[];
    }
  ).ink;
  expect(documentSourceSignature(source)).toContain(source[0].id);
  await act(async () => {
    await classroomCommands.execute({
      name: "document.erase",
      args: { ids: source.map((stroke) => stroke.id) },
    });
    finish("迟到结果");
  });
  expect(
    (classroomCommands.read("document") as { ink: unknown[] }).ink,
  ).toHaveLength(0);
  expect(update).not.toHaveBeenCalled();
});

it("rejects a replacement if its source is deleted while loading the font", async () => {
  const { draw, update } = await setup();
  draw();
  const { ink } = classroomCommands.read("document") as {
    ink: import("./documents").InkStroke[];
  };
  let ready!: () => void;
  vi.spyOn(Fonts, "loadElementsFonts").mockReturnValue(
    new Promise((resolve) => {
      ready = () => resolve([]);
    }),
  );
  const pending = classroomCommands.execute({
    name: "document.text",
    args: {
      text: "课堂笔记",
      sourceIds: ink.map((stroke) => stroke.id),
      sourceSignature: documentSourceSignature(ink),
      presentation: "text",
      placement: "replace",
    },
  });
  await act(async () => {
    await classroomCommands.execute({ name: "document.clearInk" });
    ready();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  expect(
    (classroomCommands.read("document") as { ink: unknown[] }).ink,
  ).toHaveLength(0);
  expect(update).not.toHaveBeenCalled();
});

const currentInk = () =>
  (
    classroomCommands.read("document") as {
      ink: import("./documents").InkStroke[];
    }
  ).ink;

it("keeps release coalesced samples and completes fountain geometry on the visible layer", async () => {
  const { pointer, svg } = await setup(undefined, {
    currentItemPenMode: "brush",
  });
  pointer("pointerdown", 100, 100);
  pointer("pointermove", 150, 130);
  pointer("pointerup", 200, 140, {
    pressure: 0,
    getCoalescedEvents: () => [{ clientX: 175, clientY: 135, pressure: 0.4 }],
  });
  const [stroke] = currentInk();
  expect(stroke.points).toEqual([
    [100, 100],
    [150, 130],
    [175, 135],
    [200, 140],
  ]);
  expect(stroke.pressures).toEqual([0.6, 0.6, 0.4, 0]);
  expect(stroke.fcInk?.finished).toBe(true);
  expect(factoryBrushWidths(documentInkElement(stroke)).at(-1)).toBe(0);
  expect(svg.querySelector("path")?.getAttribute("d")).not.toMatch(
    /NaN|Infinity|a0,0/,
  );
});

it.each(["pointercancel", "lostpointercapture", "blur"])(
  "rolls back a growing palm on %s and rejects late pointer events",
  async (cancel) => {
    const { draw, pointer, svg } = await setup();
    draw();
    const before = currentInk();
    pointer("pointerdown", 150, 120, {
      pointerType: "touch",
      width: 8,
      height: 8,
    });
    pointer("pointermove", 170, 130, {
      pointerType: "touch",
      width: 70,
      height: 80,
    });
    expect(currentInk()).not.toEqual(before);
    expect(svg.querySelector("image[aria-hidden='true']")).toBeInTheDocument();
    if (cancel === "blur") {
      fireEvent.blur(window);
    } else {
      pointer(cancel, 170, 130);
    }
    expect(currentInk()).toEqual(before);
    expect(svg.hasPointerCapture(1)).toBe(false);
    expect(
      svg.querySelector("image[aria-hidden='true']"),
    ).not.toBeInTheDocument();
    pointer("pointermove", 250, 180);
    pointer("pointerup", 250, 180);
    expect(currentInk()).toEqual(before);
    await act(async () => {
      await classroomCommands.execute({ name: "document.undo" });
    });
    expect(currentInk()).toHaveLength(0);
  },
);

it("commits growing-palm erasure as one undo step and uses the shared eraser size", async () => {
  const { draw, pointer, svg } = await setup(undefined, { eraserSize: 120 });
  draw();
  const before = currentInk();
  pointer("pointerdown", 150, 120, {
    pointerType: "touch",
    width: 8,
    height: 8,
  });
  pointer("pointermove", 160, 125, {
    pointerType: "touch",
    width: 50,
    height: 60,
  });
  expect(svg.querySelector("image[aria-hidden='true']")).toHaveAttribute(
    "width",
    "120",
  );
  pointer("pointerup", 170, 130, {
    pointerType: "touch",
    width: 50,
    height: 60,
  });
  const erased = currentInk();
  expect(erased).not.toEqual(before);
  expect(
    erased.every(
      (stroke) =>
        stroke.id !== before[0].id ||
        stroke.points.length !== before[0].points.length,
    ),
  ).toBe(true);
  await act(async () => {
    await classroomCommands.execute({ name: "document.undo" });
  });
  expect(currentInk()).toEqual(before);
  await act(async () => {
    await classroomCommands.execute({ name: "document.redo" });
  });
  expect(currentInk()).toEqual(erased);
});

it("keeps writing when palm erasure is disabled and promotes an in-stroke barrel button", async () => {
  const { pointer, svg } = await setup(undefined, { palmEraser: false });
  pointer("pointerdown", 100, 100, {
    pointerType: "touch",
    width: 80,
    height: 80,
  });
  pointer("pointermove", 200, 100, {
    pointerType: "touch",
    width: 80,
    height: 80,
  });
  pointer("pointerup", 200, 100, {
    pointerType: "touch",
    width: 80,
    height: 80,
  });
  const before = currentInk();
  expect(before).toHaveLength(1);
  pointer("pointerdown", 150, 100);
  pointer("pointermove", 150, 100, { button: 2, buttons: 2 });
  expect(svg.querySelector("image[aria-hidden='true']")).toBeInTheDocument();
  expect(currentInk()).not.toEqual(before);
  pointer("pointercancel", 150, 100);
  expect(currentInk()).toEqual(before);
});

it("duplicates selected courseware ink as one undoable action with independent IDs", async () => {
  const { draw, update } = await setup();
  draw();
  const before = currentInk();
  await act(async () => {
    await classroomCommands.execute({
      name: "document.select",
      args: { ids: before.map((stroke) => stroke.id) },
    });
    await classroomCommands.execute({ name: "document.duplicate" });
  });
  const after = currentInk();
  expect(after).toHaveLength(2);
  expect(after[0]).toBe(before[0]);
  expect(after[1].id).not.toBe(before[0].id);
  expect(after[1].pressures).toEqual(before[0].pressures);
  expect(after[1].fcInk).toEqual(before[0].fcInk);
  expect(after[1].points[0][0]).toBeGreaterThan(before[0].points[0][0]);
  await act(async () => {
    await classroomCommands.execute({ name: "document.undo" });
  });
  expect(currentInk()).toEqual(before);
  await act(async () => {
    await classroomCommands.execute({ name: "document.redo" });
  });
  expect(currentInk()).toEqual(after);
  expect(update).not.toHaveBeenCalled();
});
