import { Capacitor } from "@capacitor/core";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { getLanguage, t } from "@excalidraw/excalidraw/i18n";

import { render } from "./test/render";
import { sceneAPI } from "./test/scene";
import { InsertMenu } from "./InsertMenu";
import { classroomCommands } from "./commands";
import { Classroom } from "./native";
import * as insertions from "./insertObjects";
import { shapeInk } from "./documents";

import type { InkStroke } from "./documents";

vi.mock("@excalidraw/excalidraw", async (original) => ({
  ...(await original<typeof import("@excalidraw/excalidraw")>()),
  ToolbarExtras: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("./native", () => ({
  Classroom: {
    getFactoryInsertions: vi.fn(),
    openFactoryInsertion: vi.fn(),
    signalAction: vi.fn(),
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const setup = (tool: "freedraw" | "selection" | "custom" = "freedraw") => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.mocked(Classroom.getFactoryInsertions).mockResolvedValue({
    available: ["document", "media", "signal"],
  });
  const api = sceneAPI();
  api.onChange = vi.fn(() => () => {});
  api.setActiveTool = vi.fn();
  const original = api.getAppState;
  api.getAppState = () =>
    ({ ...original(), activeTool: { type: tool } } as ReturnType<
      typeof original
    >);
  return { api, view: render(<InsertMenu api={api} />) };
};

const placeTable = (x: number, y: number) => {
  const layer = document.querySelector("[data-insertion-placement=table]")!;
  for (const type of ["pointerdown", "pointerup"]) {
    fireEvent(
      layer,
      Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
        pointerId: 2,
        pointerType: "touch",
        button: 0,
        clientX: x,
        clientY: y,
      }),
    );
  }
};

it("previews table dimensions until confirmation and inserts once with the chosen cells", async () => {
  const insert = vi
    .spyOn(insertions, "renderInsertion")
    .mockResolvedValue(undefined);
  const { api } = setup();
  await act(async () => {
    await classroomCommands.execute({
      name: "insert.open",
      args: { kind: "table" },
    });
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: t("fcboard.rows_rows_columns_columns", { rows: 4, columns: 6 }),
    }),
  );
  expect(insert).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
  expect(insert).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(
      document.querySelector("[data-insertion-placement=table]"),
    ).not.toBeNull(),
  );
  placeTable(320, 180);
  await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
  expect(insert).toHaveBeenCalledWith(
    api,
    expect.objectContaining({
      kind: "table",
      rows: 4,
      columns: 6,
      position: { x: 320, y: 180 },
    }),
    true,
    { exact: true, select: false },
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("opens documents and media in the internal viewer even when OEM apps exist", async () => {
  const open = vi.fn();
  const stop = classroomCommands.register("files.open", "@internal", open);
  const { view } = setup();
  try {
    await act(async () => {
      await classroomCommands.execute({
        name: "insert.open",
        args: { kind: "document" },
      });
      await classroomCommands.execute({
        name: "insert.open",
        args: { kind: "media" },
      });
    });
    expect(open).toHaveBeenCalledTimes(2);
    expect(Classroom.openFactoryInsertion).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    stop();
  }
});

it("keeps ordinary document insertion selections free of property popups even when the covered board retains selection mode", async () => {
  const insert = vi
    .spyOn(insertions, "renderInsertion")
    .mockResolvedValue(undefined);
  const { view } = setup("selection");
  const objects = (["table", "mindmap", "fourline"] as const).map((kind) =>
    insertions.insertionDefaults(kind, { x: 100, y: 100 }),
  );
  const ink: InkStroke[] = objects.map((object) => ({
    id: `${object.id}-0`,
    points: [
      [100, 100],
      [200, 100],
    ],
    color: "#000000",
    width: 2,
    insertion: { ...object, origin: { x: 100, y: 100 } },
  }));
  let selected: string[] = [];
  let release = () => {};
  await act(async () => {
    release = classroomCommands.context("document", () => ({
      id: "visible",
      page: 1,
      ink,
      selection: selected,
    }));
  });
  try {
    for (let index = 0; index < objects.length; index++) {
      selected = [ink[index].id];
      await act(async () => {
        classroomCommands.changed("document");
      });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(classroomCommands.read("insertions")).toMatchObject({
        selected: objects[index].id,
      });
      await act(async () => {
        await classroomCommands.execute({
          name: "insert.configure",
          args: { width: 480 },
        });
      });
      expect(insert).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ id: objects[index].id, width: 480 }),
      );
    }
  } finally {
    view.unmount();
    release();
  }
});

it("places new document insertions in the actual scrolled viewport and sizes four-line paper independently of the covered board", async () => {
  const insert = vi
    .spyOn(insertions, "renderInsertion")
    .mockResolvedValue(undefined);
  const { api, view } = setup();
  const original = api.getAppState;
  api.getAppState = () => ({ ...original(), width: 9000, height: 7000 });
  const stops = [
    classroomCommands.context("document", () => ({
      id: "scrolled",
      page: 2,
      ink: [],
      selection: [],
    })),
    classroomCommands.context("document.layout", () => ({
      viewport: { left: 200, top: 900, right: 700, bottom: 1300 },
    })),
    classroomCommands.register("document.draw", "@internal", () => {}),
    classroomCommands.register("document.tool", "@internal", () => {}),
  ];
  try {
    for (const kind of ["table", "mindmap", "fourline"]) {
      await act(async () => {
        await classroomCommands.execute({
          name: "insert.object",
          args: { kind },
        });
      });
      expect(insert).toHaveBeenLastCalledWith(
        api,
        expect.objectContaining({
          kind,
          position: { x: 260, y: 960 },
          ...(kind === "fourline" ? { width: 100, height: 80 } : {}),
        }),
      );
    }
    await act(async () => {
      await classroomCommands.execute({
        name: "insert.open",
        args: { kind: "table" },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
    await waitFor(() =>
      expect(
        document.querySelector("[data-insertion-placement=table]"),
      ).not.toBeNull(),
    );
    expect(insert).toHaveBeenCalledTimes(3);
    placeTable(260, 960);
    await waitFor(() => expect(insert).toHaveBeenCalledTimes(4));
    expect(insert).toHaveBeenLastCalledWith(
      api,
      expect.objectContaining({ kind: "table", position: { x: 260, y: 960 } }),
      true,
      { exact: true, select: false },
    );
  } finally {
    view.unmount();
    stops.reverse().forEach((stop) => stop());
  }
});

it("commits a real table to the visible document without reading the covered board", async () => {
  const { api, view } = setup("selection");
  let ink: InkStroke[] = [];
  const hidden = vi.spyOn(api, "getSceneElements").mockImplementation(() => {
    throw new Error("covered board");
  });
  const stops: (() => void)[] = [];
  await act(async () => {
    stops.push(
      classroomCommands.context("document", () => ({
        id: "visible",
        page: 1,
        ink,
        selection: ink.map((stroke) => stroke.id),
      })),
      classroomCommands.context("document.layout", () => ({
        viewport: { left: 100, top: 800, right: 900, bottom: 1300 },
      })),
      classroomCommands.register("document.draw", "@internal", () => {}),
      classroomCommands.register("document.insertion", "@internal", (args) => {
        ink = (args.shapes as Parameters<typeof shapeInk>[0][]).map((shape) =>
          shapeInk(shape, "insertion"),
        );
        classroomCommands.changed("document");
      }),
    );
  });
  try {
    await act(async () => {
      await classroomCommands.execute({
        name: "insert.object",
        args: { kind: "table" },
      });
    });
    expect(ink.length).toBeGreaterThan(3);
    expect(
      ink.every(
        (stroke) =>
          stroke.insertion?.position.x === 160 &&
          stroke.insertion?.position.y === 860,
      ),
    ).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(hidden).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    stops.reverse().forEach((stop) => stop());
    hidden.mockRestore();
  }
});

it("keeps standard document insertion defaults when layout is not yet available instead of sizing from the covered board", async () => {
  const insert = vi
    .spyOn(insertions, "renderInsertion")
    .mockResolvedValue(undefined);
  const { api, view } = setup();
  const original = api.getAppState;
  api.getAppState = () => ({ ...original(), width: 9000, height: 7000 });
  const stops = [
    classroomCommands.context("document", () => ({
      id: "loading",
      page: 1,
      ink: [],
    })),
    classroomCommands.register("document.draw", "@internal", () => {}),
    classroomCommands.register("document.tool", "@internal", () => {}),
  ];
  try {
    await act(async () => {
      await classroomCommands.execute({
        name: "insert.object",
        args: { kind: "fourline" },
      });
    });
    expect(insert).toHaveBeenCalledWith(
      api,
      expect.objectContaining({
        kind: "fourline",
        position: { x: 60, y: 60 },
        width: 360,
        height: 144,
      }),
    );
  } finally {
    view.unmount();
    stops.reverse().forEach((stop) => stop());
  }
});

it("rejects an aborted insertion before writing and stops old tool changes after its target changes", async () => {
  let finish!: () => void;
  const insert = vi.spyOn(insertions, "renderInsertion").mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { api, view } = setup();
  const request = new AbortController();
  request.abort();
  try {
    await expect(
      classroomCommands.execute({
        name: "insert.object",
        args: { kind: "mindmap", signal: request.signal },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(insert).not.toHaveBeenCalled();
    let operation!: Promise<unknown>;
    await act(async () => {
      operation = classroomCommands.execute({
        name: "insert.object",
        args: { kind: "mindmap" },
      });
      classroomCommands.invalidate();
      finish();
      await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    });
    expect(api.setActiveTool).not.toHaveBeenCalled();
    expect(api.updateScene).not.toHaveBeenCalled();
  } finally {
    view.unmount();
  }
});

it("opens the actual signal viewer and preserves whether the firmware opened an external app", async () => {
  const { view } = setup();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: t("fcboard.signal") }),
    ).toBeEnabled(),
  );
  for (const embedded of [true, false]) {
    vi.mocked(Classroom.openFactoryInsertion).mockResolvedValueOnce({
      embedded,
    });
    await act(async () => {
      expect(
        await classroomCommands.execute({
          name: "insert.open",
          args: { kind: "signal" },
        }),
      ).toEqual({ embedded });
    });
  }
  expect(Classroom.openFactoryInsertion).toHaveBeenCalledWith({
    insertion: "signal",
    language: getLanguage().code,
  });
  view.unmount();
});

it("exposes real signal input IDs and video state and sends inspected IDs to the native selector", async () => {
  const { view } = setup();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: t("fcboard.signal") }),
    ).toBeEnabled(),
  );
  const state = {
    open: true,
    embedded: true,
    available: true,
    video: "available" as const,
    message: "",
    selectedId: "hardware/HDMI1",
    inputId: "hardware/HDMI1",
    inputs: [
      {
        id: "hardware/HDMI1",
        label: "HDMI 1",
        state: "connected" as const,
        selected: true,
      },
      {
        id: "hardware/HDMI2",
        label: "HDMI 2",
        state: "disconnected" as const,
        selected: false,
      },
    ],
  };
  vi.mocked(Classroom.signalAction).mockResolvedValue(state);
  expect(await classroomCommands.execute({ name: "signal.action" })).toEqual(
    state,
  );
  expect(Classroom.signalAction).toHaveBeenLastCalledWith({
    action: "read",
    id: undefined,
    language: getLanguage().code,
  });
  for (const action of ["select", "reload", "reset", "close"]) {
    const args =
      action === "select" ? { action, id: state.inputs[1].id } : { action };
    await classroomCommands.execute({ name: "signal.action", args });
    expect(Classroom.signalAction).toHaveBeenLastCalledWith({
      ...args,
      language: getLanguage().code,
    });
  }
  expect(classroomCommands.isPublic("signal.action")).toBe(true);
  view.unmount();
  expect(classroomCommands.has("signal.action")).toBe(false);
});

it("rejects invalid or aborted signal actions before native dispatch and returns real device failures", async () => {
  const { view } = setup();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: t("fcboard.signal") }),
    ).toBeEnabled(),
  );
  for (const args of [
    { action: "launch" },
    { action: "select" },
    { action: "select", id: " " },
    { action: "read", id: 1 },
    { action: false },
  ]) {
    await expect(
      classroomCommands.execute({ name: "signal.action", args }),
    ).rejects.toThrow("Invalid signal source action or input ID");
  }
  const request = new AbortController();
  request.abort();
  await expect(
    classroomCommands.execute({
      name: "signal.action",
      args: { action: "reset", signal: request.signal },
    }),
  ).rejects.toThrow();
  expect(Classroom.signalAction).not.toHaveBeenCalled();
  vi.mocked(Classroom.signalAction).mockRejectedValueOnce(
    new Error("External signal apps cannot be controlled here"),
  );
  await expect(
    classroomCommands.execute({
      name: "signal.action",
      args: { action: "select", id: "hardware/HDMI1" },
    }),
  ).rejects.toThrow("External signal apps cannot be controlled here");
  view.unmount();
});

it("does not advertise native signal actions on the web", () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
  const api = sceneAPI();
  api.onChange = vi.fn(() => () => {});
  const view = render(<InsertMenu api={api} />);
  expect(classroomCommands.has("signal.action")).toBe(false);
  view.unmount();
});
