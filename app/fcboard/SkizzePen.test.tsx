import { act, screen } from "@testing-library/react";
import { Capacitor } from "@capacitor/core";
import { Fcboard, exportToCanvas } from "@fcboard/fcboard";
import { newElement } from "@fcboard/element";

import { t } from "@fcboard/fcboard/i18n";

import { render as renderEditor } from "@fcboard/fcboard/tests/test-utils";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { SkizzePen } from "./SkizzePen";
import { SkizzePen as nativePen } from "./skizze";
import { PageNavigation } from "./PageNavigation";
import { classroomCommands } from "./commands";
import { render } from "./test/render";

import type { SkizzeInput, SkizzeState } from "./skizze";

vi.mock("./skizze", () => ({
  SkizzePen: { addListener: vi.fn(), connect: vi.fn() },
}));
vi.mock("@fcboard/fcboard", async (original) => ({
  ...(await original<typeof import("@fcboard/fcboard")>()),
  exportToCanvas: vi.fn(),
}));
let api: FcboardImperativeAPI;
let editor: Awaited<ReturnType<typeof renderEditor>>;
let view: ReturnType<typeof render> | undefined;
let receive: (event: SkizzeInput) => void;
const remove = vi.fn();
const emit = (event: SkizzeInput) => act(() => receive(event));
const state = () =>
  classroomCommands.read("skizze") as {
    connected: boolean;
    visible: boolean;
    mode: string;
    radii: Record<string, number>;
    battery?: number;
  };
const advance = (milliseconds: number) =>
  act(() => vi.advanceTimersByTime(milliseconds));
const hover = (x = 120, y = 140) =>
  act(() => {
    const event = new Event("pointermove", { bubbles: true });
    Object.assign(event, {
      buttons: 0,
      pointerType: "pen",
      clientX: x,
      clientY: y,
    });
    window.dispatchEvent(event);
  });
const mount = async () => {
  view = render(
    <>
      <SkizzePen api={api} />
      <PageNavigation />
    </>,
  );
  await act(async () => {});
};
beforeEach(async () => {
  editor = await renderEditor(
    <Fcboard
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.mocked(nativePen.addListener).mockImplementation(
    async (_event, listener) => {
      receive = listener;
      return { remove };
    },
  );
  vi.mocked(nativePen.connect).mockResolvedValue({
    kind: "state",
    connected: false,
    error: "",
  });
  vi.mocked(exportToCanvas).mockResolvedValue(document.createElement("canvas"));
  vi.useFakeTimers();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
    window.setTimeout(() => callback(performance.now()), 16),
  );
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) =>
    clearTimeout(id),
  );
});
afterEach(async () => {
  view?.unmount();
  view = undefined;
  await act(async () => {});
  vi.useRealTimers();
  editor.unmount();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("does not mount hardware UI or commands on a browser", async () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  await mount();
  expect(nativePen.addListener).not.toHaveBeenCalled();
  expect(classroomCommands.read("skizze")).toBeUndefined();
  expect(view!.container.querySelector(".fc-skizze-overlay")).toBeNull();
});

it("cycles the original five pen colors without changing selected objects, tool or undoable scene", async () => {
  const rectangle = newElement({
    type: "rectangle",
    x: 10,
    y: 10,
    width: 80,
    height: 90,
    strokeColor: "#0f00ff",
  });
  act(() =>
    api.updateScene({
      elements: [rectangle],
      appState: { selectedElementIds: { [rectangle.id]: true } },
    }),
  );
  await mount();
  emit({ kind: "state", connected: true, battery: 72, error: "" });
  const tool = api.getAppState().activeTool;
  for (const color of [
    "#ffffff",
    "#ff0000",
    "#00ff00",
    "#ffff00",
    "#000000",
    "#ffffff",
  ]) {
    emit({ kind: "color" });
    expect(api.getAppState().currentItemStrokeColor).toBe(color);
  }
  expect(api.getAppState().activeTool).toEqual(tool);
  expect(api.getSceneElements()[0]).toEqual(rectangle);
  expect(
    view!.container.querySelectorAll(".fc-skizze-colors img"),
  ).toHaveLength(5);
  advance(2999);
  expect(view!.container.querySelector(".fc-skizze-colors")).not.toBeNull();
  advance(1);
  expect(view!.container.querySelector(".fc-skizze-colors")).toBeNull();
  expect(state().battery).toBe(72);
});

it("draws at actual hover coordinates and uses the separate 3s / 200ms visibility timings", async () => {
  await mount();
  emit({ kind: "state", connected: true, error: "" });
  const canvas = view!.container.querySelector("canvas")!;
  const arc = vi.spyOn(canvas.getContext("2d")!, "arc");
  emit({ kind: "mode" });
  expect(state()).toMatchObject({ mode: "laser", visible: true });
  advance(2999);
  expect(state().visible).toBe(true);
  advance(1);
  expect(state().visible).toBe(false);
  hover(215, 192);
  advance(16);
  expect(arc).toHaveBeenLastCalledWith(
    215 * devicePixelRatio,
    192 * devicePixelRatio,
    20,
    0,
    2 * Math.PI,
  );
  advance(183);
  expect(state().visible).toBe(true);
  advance(1);
  expect(state().visible).toBe(false);
  expect(exportToCanvas).not.toHaveBeenCalled();
});

it("gives the visible layer page-key priority, preserves original radius limits and resumes board paging after hiding", async () => {
  await mount();
  const next = vi.fn();
  const stops = [
    classroomCommands.context("boards", () => ({
      active: "one",
      boards: [{ id: "one" }, { id: "two" }],
    })),
    classroomCommands.register("board.switch", "@internal", next),
  ];
  try {
    emit({ kind: "state", connected: true, error: "" });
    emit({ kind: "mode" });
    for (let i = 0; i < 8; i++) {
      emit({ kind: "previous" });
    }
    expect(state().radii.laser).toBe(60);
    expect(next).not.toHaveBeenCalled();
    emit({ kind: "mode" });
    expect(state().mode).toBe("mouse");
    emit({ kind: "mode" });
    expect(state().mode).toBe("spotlight");
    emit({ kind: "next" });
    expect(state().radii.spotlight).toBe(260);
    for (let i = 0; i < 10; i++) {
      emit({ kind: "previous" });
    }
    expect(state().radii.spotlight).toBe(420);
    advance(1999);
    expect(state().visible).toBe(true);
    advance(1);
    expect(state().visible).toBe(false);
    emit({ kind: "next" });
    await act(async () => {});
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ id: "two" });
  } finally {
    stops.forEach((stop) => stop());
  }
});

it("magnifies only a real whiteboard snapshot at 2x and discards a late snapshot after mode change", async () => {
  const rectangle = newElement({
    type: "rectangle",
    x: 25,
    y: 35,
    width: 70,
    height: 50,
  });
  act(() => api.updateScene({ elements: [rectangle] }));
  await mount();
  emit({ kind: "state", connected: true, error: "" });
  let finish!: (canvas: HTMLCanvasElement) => void;
  vi.mocked(exportToCanvas).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    await classroomCommands.execute({
      name: "skizze.mode",
      args: { mode: "magnifier" },
    });
  });
  const output = view!.container.querySelector("canvas")!;
  const context = output.getContext("2d")!;
  const draw = vi.spyOn(context, "drawImage");
  await act(async () => {
    await classroomCommands.execute({
      name: "skizze.mode",
      args: { mode: "laser" },
    });
  });
  const stale = document.createElement("canvas");
  await act(async () => finish(stale));
  advance(16);
  expect(draw).not.toHaveBeenCalled();
  const snapshot = document.createElement("canvas");
  vi.mocked(exportToCanvas).mockResolvedValueOnce(snapshot);
  const scale = vi.spyOn(context, "scale");
  await act(async () => {
    await classroomCommands.execute({
      name: "skizze.mode",
      args: { mode: "magnifier" },
    });
  });
  advance(16);
  expect(draw).toHaveBeenCalledWith(
    snapshot,
    0,
    0,
    expect.any(Number),
    expect.any(Number),
  );
  expect(scale).toHaveBeenCalledWith(2, 2);
  expect(vi.mocked(exportToCanvas).mock.calls.at(-1)![0].elements).toEqual([
    rectangle,
  ]);
  expect(
    vi.mocked(exportToCanvas).mock.calls.at(-1)![0].exportingFrame,
  ).toBeDefined();
  emit({ kind: "next" });
  expect(state().radii.magnifier).toBe(180);
  emit({ kind: "state", connected: false, error: "" });
  expect(state().visible).toBe(false);
  await expect(
    classroomCommands.execute({ name: "skizze.mode", args: { mode: "laser" } }),
  ).rejects.toThrow();
});

it("keeps newer hardware state over a late connect reply and removes the owned listener on unmount", async () => {
  let complete!: (state: SkizzeState) => void;
  vi.mocked(nativePen.connect).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await mount();
  emit({ kind: "state", connected: true, battery: 80, error: "" });
  await act(async () =>
    complete({ kind: "state", connected: false, error: "" }),
  );
  expect(state().connected).toBe(true);
  emit({ kind: "mode" });
  emit({ kind: "state", connected: false, error: "USB permission lost" });
  expect(state()).toMatchObject({ connected: false, visible: false });
  expect(screen.getByRole("alert")).toHaveTextContent(
    t("fcboard.smart_pen_error"),
  );
  view!.unmount();
  view = undefined;
  await act(async () => {});
  expect(remove).toHaveBeenCalledTimes(1);
  expect(classroomCommands.read("skizze")).toBeUndefined();
  expect(classroomCommands.has("skizze.resize")).toBe(false);
});

it("does not retry a failed magnifier capture on every hover and allows an explicit mode retry", async () => {
  await mount();
  emit({ kind: "state", connected: true, error: "" });
  vi.mocked(exportToCanvas).mockRejectedValueOnce(
    new Error("Canvas unavailable"),
  );
  await act(async () => {
    await classroomCommands.execute({
      name: "skizze.mode",
      args: { mode: "magnifier" },
    });
  });
  expect(state().visible).toBe(false);
  expect(screen.getByRole("alert")).toHaveTextContent("Canvas unavailable");
  for (let i = 0; i < 40; i++) {
    hover(i, i);
  }
  advance(1000);
  expect(exportToCanvas).toHaveBeenCalledTimes(1);
  await act(async () => {
    await classroomCommands.execute({
      name: "skizze.mode",
      args: { mode: "magnifier" },
    });
  });
  expect(exportToCanvas).toHaveBeenCalledTimes(2);
  expect(state().visible).toBe(true);
});

it("handles listener setup failure without pretending the pen connected or leaving an unhandled promise", async () => {
  vi.mocked(nativePen.addListener).mockRejectedValueOnce(
    new Error("USB bridge unavailable"),
  );
  await mount();
  expect(screen.getByRole("alert")).toHaveTextContent("USB bridge unavailable");
  expect(state().connected).toBe(false);
  expect(nativePen.connect).not.toHaveBeenCalled();
  await expect(
    classroomCommands.execute({ name: "skizze.mode", args: { mode: "laser" } }),
  ).rejects.toThrow();
});
