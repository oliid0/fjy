import { useState } from "react";
import { Fcboard, CaptureUpdateAction } from "@fcboard/fcboard";
import { t } from "@fcboard/fcboard/i18n";
import { API } from "@fcboard/fcboard/tests/helpers/api";
import { pointFrom } from "@fcboard/math";
import { getFontString } from "@fcboard/common";
import { exportToSvg } from "@fcboard/fcboard/scene/export";
import { restoreElements } from "@fcboard/fcboard/data/restore";
import { nativeInkGradient } from "@fcboard/element/nativeInkColor";
import { Keyboard } from "@fcboard/fcboard/tests/helpers/ui";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@fcboard/fcboard/tests/test-utils";

import type { FileId } from "@fcboard/element/types";
import type { DataURL } from "@fcboard/fcboard/types";
import type { FcboardElement } from "@fcboard/element/types";
import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { SelectionActions } from "./SelectionActions";
import { registerCanvasCommands } from "./canvasCommands";
import { insertionDefaults, renderInsertion } from "./insertObjects";

let api: FcboardImperativeAPI;
let stop: () => void;
beforeEach(async () => {
  const Harness = () => {
    const [current, setCurrent] = useState<FcboardImperativeAPI>();
    return (
      <Fcboard
        handleKeyboardGlobally
        UIOptions={{ unifiedToolbar: true }}
        onFcboardAPI={(value) => {
          api = value;
          setCurrent(value);
        }}
      >
        {current && (
          <SelectionActions
            api={current}
            onPlot={vi.fn()}
            onRequest={vi.fn()}
          />
        )}
      </Fcboard>
    );
  };
  await render(<Harness />);
  stop = registerCanvasCommands(api);
});
afterEach(() => {
  stop();
  vi.restoreAllMocks();
});
const select = (elements: FcboardElement[]) =>
  act(() =>
    api.updateScene({
      elements,
      appState: {
        selectedElementIds: Object.fromEntries(
          elements.map((element) => [element.id, true]),
        ),
        activeTool: {
          ...api.getAppState().activeTool,
          type: "selection",
          customType: null,
        },
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    }),
  );
const row = () =>
  within(screen.getByRole("toolbar", { name: t("fcboard.selection_actions") }));
const click = (label: string) =>
  fireEvent.click(row().getByRole("button", { name: label }));

it.each(["freedraw", "text", "image", "rectangle"] as const)(
  "shows the native controls for selected %s and no unsupported controls",
  (type) => {
    const element = API.createElement({ type });
    select([element]);
    expect(!!row().queryByRole("button", { name: "AI" })).toBe(
      type === "freedraw" || type === "text",
    );
    expect(
      !!row().queryByRole("button", { name: t("fcboard.selection_border") }),
    ).toBe(type === "freedraw" || type === "rectangle");
    expect(!!row().queryByRole("button", { name: t("labels.opacity") })).toBe(
      type === "freedraw" || type === "rectangle",
    );
    expect(
      !!row().queryByRole("button", {
        name: t(
          type === "text"
            ? "fcboard.selection_text_color"
            : "fcboard.selection_color",
        ),
      }),
    ).toBe(type !== "image");
    expect(
      row().getByRole("button", { name: t("fcboard.selection_layers") }),
    ).toBeEnabled();
  },
);

it("retains a live popup while changing real selected ink color and opacity, then undoes the alpha change once", async () => {
  const ink = API.createElement({
    type: "freedraw",
    strokeColor: "#000000",
    opacity: 100,
  });
  select([ink]);
  act(() =>
    API.setAppState({
      currentItemStrokeColor: "#123456",
      whiteboardShapeStyle: { color: "#ff964f", fill: true },
    }),
  );
  click(t("fcboard.selection_color"));
  fireEvent.click(screen.getByRole("button", { name: "#ff0000" }));
  await waitFor(() =>
    expect(api.getSceneElements()[0].strokeColor).toBe("#ff0000"),
  );
  expect(
    screen.getByRole("dialog", { name: t("fcboard.selection_color") }),
  ).toBeVisible();
  expect(api.getAppState().currentItemStrokeColor).toBe("#123456");
  expect(api.getAppState().whiteboardShapeStyle).toEqual({
    color: "#ff964f",
    fill: true,
  });
  expect(
    row()
      .getByRole("button", { name: t("fcboard.selection_color") })
      .querySelector("svg path"),
  ).not.toBeNull();
  expect(
    row()
      .getByRole("button", { name: t("fcboard.selection_color") })
      .querySelector("img"),
  ).toBeNull();
  click(t("labels.opacity"));
  expect(
    screen.queryByRole("dialog", { name: t("fcboard.selection_color") }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "20%" }));
  await waitFor(() => expect(api.getSceneElements()[0].opacity).toBe(20));
  Keyboard.undo();
  expect(api.getSceneElements()[0].opacity).toBe(100);
  expect(api.getSceneElements()[0].strokeColor).toBe("#ff0000");
});

it("toggles border settings and writes actual dashed/solid geometry without losing the selected object", async () => {
  const ink = API.createElement({ type: "freedraw", strokeStyle: "solid" });
  select([ink]);
  click(t("fcboard.selection_border"));
  fireEvent.click(
    screen.getByRole("button", { name: t("labels.strokeStyle_dashed") }),
  );
  await waitFor(() =>
    expect(api.getSceneElements()[0].strokeStyle).toBe("dashed"),
  );
  fireEvent.change(
    screen.getByRole("slider", { name: t("labels.strokeWidth") }),
    { target: { value: "6" } },
  );
  expect(api.getSceneElements()[0].strokeWidth).toBe(6);
  fireEvent.click(
    screen.getByRole("button", { name: t("labels.strokeStyle_solid") }),
  );
  expect(api.getSceneElements()[0].strokeStyle).toBe("solid");
  click(t("fcboard.selection_border"));
  expect(
    screen.queryByRole("dialog", { name: t("fcboard.selection_border") }),
  ).toBeNull();
  expect(api.getAppState().selectedElementIds[ink.id]).toBe(true);
});

it("fills a geometric object with the selected color and removes fill without changing its border", async () => {
  const box = API.createElement({
    type: "rectangle",
    strokeColor: "#000000",
    backgroundColor: "transparent",
    fillStyle: "solid",
  });
  select([box]);
  const penBackground = api.getAppState().currentItemBackgroundColor;
  click(t("fcboard.selection_color"));
  fireEvent.click(screen.getByRole("checkbox", { name: t("labels.fill") }));
  fireEvent.click(screen.getByRole("button", { name: "#ff0000" }));
  await waitFor(() =>
    expect(api.getSceneElements()[0].backgroundColor).toBe("#ff0000"),
  );
  expect(api.getSceneElements()[0].strokeColor).toBe("#000000");
  expect(api.getAppState().currentItemBackgroundColor).toBe(penBackground);
  fireEvent.click(screen.getByRole("checkbox", { name: t("labels.fill") }));
  expect(api.getSceneElements()[0].backgroundColor).toBe("transparent");
});

it("hides single-object border/alpha in a mixed selection and keeps relative order during real layer changes", async () => {
  const first = API.createElement({ type: "rectangle", x: 100 });
  const middle = API.createElement({ type: "ellipse", x: 120 });
  const last = API.createElement({ type: "rectangle", x: 140 });
  select([first, middle, last]);
  act(() =>
    api.updateScene({
      appState: { selectedElementIds: { [first.id]: true, [middle.id]: true } },
    }),
  );
  expect(
    row().queryByRole("button", { name: t("fcboard.selection_border") }),
  ).toBeNull();
  expect(row().queryByRole("button", { name: t("labels.opacity") })).toBeNull();
  click(t("fcboard.selection_layers"));
  expect(
    screen.queryByRole("button", { name: t("labels.elementLock.lock") }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: t("labels.bringToFront") }),
  );
  await waitFor(() =>
    expect(api.getSceneElements().map((element) => element.id)).toEqual([
      last.id,
      first.id,
      middle.id,
    ]),
  );
  Keyboard.undo();
  expect(api.getSceneElements().map((element) => element.id)).toEqual([
    first.id,
    middle.id,
    last.id,
  ]);
});

it("locks the actual object through hierarchy and lets the editor's existing unlock control restore it", async () => {
  const ink = API.createElement({ type: "freedraw" });
  select([ink]);
  click(t("fcboard.selection_layers"));
  fireEvent.click(
    screen.getByRole("button", { name: t("labels.elementLock.lock") }),
  );
  await waitFor(() => expect(api.getSceneElements()[0].locked).toBe(true));
  fireEvent.click(screen.getByTitle(t("labels.elementLock.unlock")));
  await waitFor(() => expect(api.getSceneElements()[0].locked).toBe(false));
  expect(api.getAppState().selectedElementIds[ink.id]).toBe(true);
});

it("does not expose table structure controls when the table is selected together with unrelated handwriting", async () => {
  await act(async () => {
    await renderInsertion(api, insertionDefaults("table", { x: 100, y: 100 }));
  });
  const table = [...api.getSceneElements()];
  const ink = API.createElement({ type: "freedraw", x: 700, y: 400 });
  select([...table, ink]);
  expect(
    row().queryByRole("button", { name: t("fcboard.add_row") }),
  ).toBeNull();
  expect(row().queryByRole("button", { name: t("labels.opacity") })).toBeNull();
  expect(row().getByRole("button", { name: "AI" })).toBeEnabled();
});

it("plain selected color removes a previous gradient/rainbow shader instead of showing a misleading swatch", async () => {
  const ink = {
    ...API.createElement({
      type: "freedraw",
      points: [pointFrom(0, 0), pointFrom(200, 40)],
    }),
    customData: {
      fcInk: {
        version: 2,
        pen: "rainbow",
        unit: 1,
        gradient: { palette: "mint", size: 320 },
      },
    },
  };
  expect(nativeInkGradient(ink)).not.toBeNull();
  select([ink]);
  click(t("fcboard.selection_color"));
  fireEvent.click(screen.getByRole("button", { name: "#ff0000" }));
  await waitFor(() =>
    expect(api.getSceneElements()[0].strokeColor).toBe("#ff0000"),
  );
  expect(api.getSceneElements()[0].customData?.fcInk).toMatchObject({
    pen: "hard",
    unit: 1,
  });
  expect(api.getSceneElements()[0].customData?.fcInk.gradient).toBeUndefined();
  expect(nativeInkGradient(api.getSceneElements()[0] as typeof ink)).toBeNull();
  Keyboard.undo();
  expect(api.getSceneElements()[0].customData?.fcInk.pen).toBe("rainbow");
});

it("changes real selected text size and weight, preserves bold in save/SVG/Canvas, and undoes it once", async () => {
  const text = API.createElement({
    type: "text",
    text: "Handwritten",
    fontSize: 24,
    width: 160,
    height: 30,
  });
  select([text]);
  click(t("labels.fontSize"));
  const choices = screen.getByRole("listbox", { name: t("labels.fontSize") });
  expect(
    within(choices)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual([
    "12",
    "14",
    "18",
    "24",
    "36",
    "48",
    "64",
    "80",
    "96",
    "112",
    "128",
  ]);
  fireEvent.click(within(choices).getByRole("option", { name: "48" }));
  await waitFor(() =>
    expect(api.getSceneElements()[0]).toMatchObject({ fontSize: 48 }),
  );
  click(t("labels.bold"));
  await waitFor(() =>
    expect(api.getSceneElements()[0]).toMatchObject({
      fontSize: 48,
      fontWeight: 700,
    }),
  );
  const current = api.getSceneElements()[0];
  if (current.type !== "text") {
    throw Error("Missing text");
  }
  expect(getFontString(current)).toMatch(/^bold 48px /);
  expect(current.height).toBeGreaterThan(0);
  expect(Number.isFinite(current.height)).toBe(true);
  const saved = restoreElements(
    JSON.parse(JSON.stringify(api.getSceneElements())),
    null,
  );
  expect(saved[0]).toMatchObject({ fontSize: 48, fontWeight: 700 });
  const svg = await exportToSvg(api.getSceneElements(), api.getAppState(), {});
  expect(svg.querySelector("text")).toHaveAttribute("font-weight", "700");
  expect(svg.querySelector("text")).toHaveAttribute("font-size", "48px");
  Keyboard.undo();
  expect(api.getSceneElements()[0]).toMatchObject({ fontSize: 48 });
  expect((api.getSceneElements()[0] as typeof current).fontWeight).not.toBe(
    700,
  );
});

it("opens the actual selected text editor and commits its edited content with one undo", async () => {
  const text = {
    ...API.createElement({
      type: "text",
      text: "Original",
      fontSize: 24,
      width: 150,
      height: 30,
    }),
    fontWeight: 700 as const,
  };
  select([text]);
  click(t("buttons.edit"));
  const editor = await screen.findByRole("textbox");
  expect(editor).toHaveValue("Original");
  expect((editor as HTMLTextAreaElement).style.fontWeight).toBe("700");
  fireEvent.change(editor, { target: { value: "Edited\nSecond line" } });
  fireEvent.blur(editor);
  await waitFor(() =>
    expect(api.getSceneElements()[0]).toMatchObject({
      text: "Edited\nSecond line",
      fontWeight: 700,
    }),
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  Keyboard.undo();
  expect(api.getSceneElements()[0]).toMatchObject({
    text: "Original",
    fontWeight: 700,
  });
});

it("crops the actual selected original image using eight handles and commits only on confirmation with one undo", async () => {
  const id = "crop-image-file" as FileId;
  const dataURL = "data:image/png;base64,source" as DataURL;
  act(() =>
    api.addFiles([
      { id, dataURL, mimeType: "image/png", created: 1, lastRetrieved: 1 },
    ]),
  );
  const image = {
    ...API.createElement({
      type: "image",
      fileId: id,
      x: 100,
      y: 100,
      width: 400,
      height: 200,
    }),
    crop: {
      x: 0,
      y: 0,
      width: 1600,
      height: 800,
      naturalWidth: 1600,
      naturalHeight: 800,
    },
  };
  select([image]);
  click(t("helpDialog.cropStart"));
  const overlay = screen.getByRole("group", {
    name: t("helpDialog.cropStart"),
  });
  vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 100,
    right: 500,
    bottom: 300,
    width: 400,
    height: 200,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  });
  const send = (type: string, target: Element, x: number, y: number) =>
    fireEvent(
      target,
      Object.assign(new Event(type, { bubbles: true }), {
        button: 0,
        pointerId: 1,
        clientX: x,
        clientY: y,
      }),
    );
  const captured = new Set<number>();
  Object.defineProperties(overlay, {
    setPointerCapture: {
      configurable: true,
      value: (id: number) => captured.add(id),
    },
    hasPointerCapture: {
      configurable: true,
      value: (id: number) => captured.has(id),
    },
    releasePointerCapture: {
      configurable: true,
      value: (id: number) => captured.delete(id),
    },
  });
  const handle = overlay.querySelector('[data-crop-handle="w"]')!;
  send("pointerdown", handle, 100, 200);
  send("pointermove", overlay, 200, 200);
  send("pointerup", overlay, 200, 200);
  expect(api.getSceneElements()[0]).toMatchObject({ x: 100, width: 400 });
  fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
  await waitFor(() =>
    expect(api.getSceneElements()[0]).toMatchObject({
      x: 200,
      width: 300,
      crop: { x: 400, width: 1200, naturalWidth: 1600 },
    }),
  );
  expect(api.getFiles()[id].dataURL).toBe(dataURL);
  Keyboard.undo();
  expect(api.getSceneElements()[0]).toMatchObject({
    x: 100,
    width: 400,
    crop: image.crop,
  });
  click(t("helpDialog.cropStart"));
  fireEvent.click(screen.getByRole("button", { name: t("buttons.cancel") }));
  expect(api.getSceneElements()[0]).toMatchObject({
    x: 100,
    width: 400,
    crop: image.crop,
  });
});
