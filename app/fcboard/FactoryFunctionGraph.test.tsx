import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { t } from "@fcboard/fcboard/i18n";
import { Fcboard } from "@fcboard/fcboard";

import { render as renderEditor } from "@fcboard/fcboard/tests/test-utils";
import { Keyboard } from "@fcboard/fcboard/tests/helpers/ui";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { render } from "./test/render";
import { FactoryFunctionGraph } from "./FactoryFunctionGraph";
import { TeachingResources, teachingResources } from "./TeachingResources";
import { classroomCommands } from "./commands";

const pointer = (
  target: Element,
  type: string,
  id: number,
  x: number,
  y: number,
) =>
  fireEvent(
    target,
    Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      pointerId: id,
      pointerType: "touch",
      clientX: x,
      clientY: y,
      button: 0,
    }),
  );
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("adds unique presets and custom functions, applies only generated expressions, preserves the last valid graph, and reuses released colors", () => {
  render(<FactoryFunctionGraph onClose={vi.fn()} onInsert={vi.fn()} />);
  const linear = t("fcboard.functionGraph.linear");
  const addLinear = () =>
    fireEvent.click(screen.getByRole("button", { name: linear }));
  addLinear();
  addLinear();
  expect(screen.getAllByRole("region", { name: linear })).toHaveLength(1);
  const row = within(screen.getByRole("region", { name: linear }));
  const input = row.getByRole("textbox");
  const svg = screen.getByRole("img", {
    name: t("fcboard.functionGraph.preview"),
  });
  const curve = () =>
    svg.querySelector('path[stroke="#0b5fff"]')!.getAttribute("d");
  const initial = curve();
  fireEvent.change(input, { target: { value: "2*x+1" } });
  expect(curve()).toBe(initial);
  fireEvent.click(
    row.getByRole("button", { name: t("fcboard.functionGraph.generate") }),
  );
  const updated = curve();
  expect(updated).not.toBe(initial);
  fireEvent.change(input, { target: { value: "sqrt(-5)" } });
  fireEvent.click(
    row.getByRole("button", { name: t("fcboard.functionGraph.generate") }),
  );
  expect(row.getByRole("alert")).toHaveTextContent(
    t("fcboard.functionGraph.invalidExpression"),
  );
  expect(curve()).toBe(updated);
  fireEvent.click(
    row.getByRole("button", {
      name: t("fcboard.functionGraph.deleteNamed", { name: linear }),
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.functionGraph.addCustom") }),
  );
  expect(svg.querySelector('path[stroke="#0b5fff"]')).not.toBeNull();
  expect(
    screen.getByRole("region", {
      name: t("fcboard.functionGraph.customName", { number: 1 }),
    }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.functionGraph.clear") }),
  );
  expect(svg.querySelector("path")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.functionGraph.addCustom") }),
  );
  expect(
    screen.getByRole("region", {
      name: t("fcboard.functionGraph.customName", { number: 2 }),
    }),
  ).toBeVisible();
});

it("pans and pinches the actual preview, resets on double click, and keeps a failed insertion available for retry", async () => {
  const close = vi.fn();
  const insert = vi
    .fn()
    .mockRejectedValueOnce(new Error("Storage unavailable"))
    .mockResolvedValue(undefined);
  render(<FactoryFunctionGraph onClose={close} onInsert={insert} />);
  const svg = screen.getByRole("img", {
    name: t("fcboard.functionGraph.preview"),
  });
  const origin = () => Number(svg.querySelector("circle")!.getAttribute("cx"));
  vi.spyOn(svg, "setPointerCapture").mockImplementation(() => {});
  vi.spyOn(svg, "releasePointerCapture").mockImplementation(() => {});
  const initial = origin();
  pointer(svg, "pointerdown", 1, 100, 100);
  pointer(svg, "pointermove", 1, 140, 120);
  pointer(svg, "pointerup", 1, 140, 120);
  expect(origin()).toBe(initial + 40);
  fireEvent.doubleClick(svg);
  expect(origin()).toBe(initial);
  pointer(svg, "pointerdown", 1, 200, 200);
  pointer(svg, "pointerdown", 2, 300, 200);
  pointer(svg, "pointermove", 2, 400, 200);
  pointer(svg, "pointerup", 2, 400, 200);
  pointer(svg, "pointerup", 1, 200, 200);
  const button = screen.getByRole("button", {
    name: t("fcboard.functionGraph.insert"),
  });
  fireEvent.click(button);
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Storage unavailable"),
  );
  expect(insert.mock.calls[0][0]).toMatchObject({ unit: 84, functions: [] });
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
});

it("inserts the displayed coordinate image through the real resource command with one undo and rejects late or invalid graph requests", async () => {
  vi.stubGlobal(
    "Image",
    vi.fn(() => {
      const image = document.createElement("img");
      Object.defineProperties(image, {
        naturalWidth: { value: 558 },
        naturalHeight: { value: 581 },
      });
      Object.defineProperty(image, "src", {
        set: (value: string) => {
          image.setAttribute("src", value);
          queueMicrotask(() => image.dispatchEvent(new Event("load")));
        },
        get: () => image.getAttribute("src") || "",
      });
      return image;
    }),
  );
  let api!: FcboardImperativeAPI;
  const editor = await renderEditor(
    <Fcboard
      handleKeyboardGlobally
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const panel = render(<TeachingResources api={api} />);
  const resource = teachingResources.find(
    (item) => item.action === "function-graph",
  )!;
  try {
    await act(async () => {
      await classroomCommands.execute({
        name: "resources.use",
        args: { id: resource.id },
      });
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: t("fcboard.functionGraph.quadratic"),
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.functionGraph.insert") }),
    );
    await waitFor(() => expect(api.getSceneElements()).toHaveLength(1));
    const element = api.getSceneElements()[0];
    if (element.type !== "image" || !element.fileId) {
      throw new Error("Missing function graph image");
    }
    expect(element).toMatchObject({ width: 558, height: 581 });
    expect(api.getFiles()[element.fileId].mimeType).toBe("image/svg+xml");
    const svg = new DOMParser().parseFromString(
      atob(api.getFiles()[element.fileId].dataURL.split(",")[1]),
      "image/svg+xml",
    );
    expect(svg.querySelector('path[stroke="#0b5fff"]')).not.toBeNull();
    Keyboard.undo();
    expect(api.getSceneElements()).toHaveLength(0);
    Keyboard.redo();
    expect(api.getSceneElements()[0].id).toBe(element.id);
    await expect(
      classroomCommands.execute({
        name: "resources.use",
        args: { id: resource.id, graph: { unit: NaN } },
      }),
    ).rejects.toThrow("Invalid function graph data");
    await act(async () => {
      await classroomCommands.execute({
        name: "resources.use",
        args: { id: resource.id },
      });
    });
    act(() => classroomCommands.invalidate());
    expect(
      screen.queryByRole("dialog", { name: t("fcboard.functionGraph.title") }),
    ).toBeNull();
  } finally {
    panel.unmount();
    editor.unmount();
  }
});
