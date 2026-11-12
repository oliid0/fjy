import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { t } from "@fcboard/fcboard/i18n";

import { SplitBoard } from "./SplitBoard";
import { classroomCommands } from "./commands";
import { render } from "./test/render";

const backend = vi.hoisted(() => ({
  configure: vi.fn(),
  checkpoint: vi.fn(),
  restore: vi.fn(),
  remove: vi.fn(),
  acknowledge: vi.fn(),
  listeners: new Set<(event: Record<string, unknown>) => void>(),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "android", isNativePlatform: () => true },
  registerPlugin: () => ({
    ...backend,
    addListener: (
      _: string,
      listener: (event: Record<string, unknown>) => void,
    ) => {
      backend.listeners.add(listener);
      return Promise.resolve({
        remove: async () => {
          backend.listeners.delete(listener);
        },
      });
    },
  }),
}));
const command = async (args: Record<string, unknown> = {}) => {
  let result: unknown;
  await act(async () => {
    result = await classroomCommands.execute({ name: "tools.split", args });
  });
  return result;
};
const emit = (event: Record<string, unknown>) =>
  act(() => backend.listeners.forEach((listener) => listener(event)));
const pane = (number: number) =>
  screen.getByLabelText(t("fcboard.split_pane", { number }));
const canvas = (number: number) => pane(number).querySelector("canvas")!;
const ready = async () => {
  await waitFor(() =>
    expect(
      backend.configure.mock.calls.filter(([options]) => options.enabled),
    ).toHaveLength(2),
  );
  return backend.configure.mock.calls
    .filter(([options]) => options.enabled)
    .map(([options]) => options);
};
beforeEach(() => {
  for (const method of [
    backend.configure,
    backend.checkpoint,
    backend.restore,
    backend.remove,
    backend.acknowledge,
  ]) {
    method.mockReset().mockResolvedValue(undefined);
  }
  backend.listeners.clear();
  vi.spyOn(
    HTMLCanvasElement.prototype,
    "getBoundingClientRect",
  ).mockImplementation(function (this: HTMLCanvasElement) {
    return new DOMRect(
      this.closest("[aria-label]")?.getAttribute("aria-label") ===
      t("fcboard.split_pane", { number: 2 })
        ? 300
        : 0,
      0,
      300,
      500,
    );
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

it("mounts independent persistent native panes and updates real export ink without snapshots for completed strokes", async () => {
  render(<SplitBoard />);
  await command();
  const [left, right] = await ready();
  expect(left).toMatchObject({
    persistent: true,
    multiStroke: false,
    color: "#000000",
  });
  expect(right.owner).not.toBe(left.owner);
  expect(backend.restore).toHaveBeenCalledTimes(2);
  const contacts = [left, right].map((options, index) => ({
    owner: options.owner,
    token: options.token,
    id: `pen-${index}`,
    phase: "start",
    mode: "pen",
    width: 2,
    height: 2,
    points: [[index * 300 + 20, 60, 0.5]],
  }));
  contacts.forEach(emit);
  const erasing = {
    ...contacts[0],
    id: "palm",
    mode: "erase",
    width: 60,
    height: 72,
    points: [[200, 200, 0.5]],
  };
  emit(erasing);
  emit({ ...erasing, phase: "cancel" });
  expect(backend.restore).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(canvas(1), { key: "z", ctrlKey: true });
  fireEvent.keyDown(canvas(2), { key: "Delete" });
  contacts.forEach((contact, index) =>
    emit({
      ...contact,
      phase: "end",
      points: [
        [index * 300 + 20, 60, 0.5],
        [index * 300 + 160, 60, 0.5],
      ],
    }),
  );
  expect(await command({ count: 2 })).toMatchObject({
    panes: [{ strokes: 1 }, { strokes: 1 }, { strokes: 0 }, { strokes: 0 }],
  });
  expect(canvas(1).getContext("2d")!.quadraticCurveTo).toHaveBeenCalled();
  expect(backend.restore).toHaveBeenCalledTimes(2);
  fireEvent.click(
    within(pane(1)).getByRole("button", {
      name: t("fcboard.split_large_eraser"),
    }),
  );
  await waitFor(() =>
    expect(backend.configure.mock.calls.at(-1)![0]).toMatchObject({
      owner: left.owner,
      mode: "erase",
      eraserSize: 90,
    }),
  );
  expect(backend.restore).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: t("buttons.close") }));
  await waitFor(() =>
    expect(
      backend.configure.mock.calls
        .slice(-2)
        .every(([options]) => !options.enabled),
    ).toBe(true),
  );
  fireEvent.pointerDown(document.body);
  await waitFor(() =>
    expect(
      backend.configure.mock.calls
        .slice(-2)
        .every(([options]) => options.enabled),
    ).toBe(true),
  );
});

it("keeps a visible usable export canvas when the native restore fails", async () => {
  const failure = vi.spyOn(console, "error").mockImplementation(() => {});
  backend.restore.mockRejectedValue(new Error("native raster unavailable"));
  render(<SplitBoard />);
  await command();
  await waitFor(() => expect(backend.remove).toHaveBeenCalledTimes(2));
  expect(canvas(1).style.opacity).toBe("");
  expect(canvas(2).style.opacity).toBe("");
  expect(failure).toHaveBeenCalledTimes(2);
});

it("disables native input before undo restoration and ignores late callbacks after split closes", async () => {
  render(<SplitBoard />);
  await command();
  const [left] = await ready();
  const contact = {
    owner: left.owner,
    token: left.token,
    id: "first",
    phase: "start",
    mode: "pen",
    width: 2,
    height: 2,
    points: [[20, 60, 0.5]],
  };
  emit(contact);
  emit({
    ...contact,
    phase: "end",
    points: [
      [20, 60, 0.5],
      [160, 60, 0.5],
    ],
  });
  backend.configure.mockClear();
  fireEvent.keyDown(canvas(1), { key: "z", ctrlKey: true });
  await waitFor(() => expect(backend.restore).toHaveBeenCalledTimes(3));
  expect(backend.configure.mock.calls[0][0]).toMatchObject({
    owner: left.owner,
    enabled: false,
  });
  expect(await command({ open: false })).toMatchObject({ open: false });
  emit({
    ...contact,
    phase: "end",
    points: [
      [20, 60, 0.5],
      [200, 60, 0.5],
    ],
  });
  expect(await command()).toMatchObject({
    panes: [{ strokes: 0 }, { strokes: 0 }, { strokes: 0 }, { strokes: 0 }],
  });
});

it("replays an eraser around a concurrently completed pen and undoes that eraser as one gesture", async () => {
  render(<SplitBoard />);
  await command();
  const [left] = await ready();
  const pen = {
    owner: left.owner,
    token: left.token,
    id: "writer",
    phase: "start",
    mode: "pen",
    width: 2,
    height: 2,
    points: [[20, 60, 0.5]],
  };
  const eraser = {
    ...pen,
    id: "eraser",
    mode: "erase",
    width: 60,
    height: 72,
    points: [[150, 60, 0.5]],
  };
  emit(pen);
  emit(eraser);
  emit({ ...eraser, phase: "move", points: [[180, 60, 0.5]] });
  emit({
    ...pen,
    phase: "end",
    points: [
      [20, 60, 0.5],
      [200, 60, 0.5],
    ],
  });
  emit({ ...eraser, phase: "end", points: [[210, 60, 0.5]] });
  expect(await command({ count: 2 })).toMatchObject({
    panes: [{ strokes: 3 }, { strokes: 0 }, { strokes: 0 }, { strokes: 0 }],
  });
  expect(backend.restore).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(canvas(1), { key: "z", ctrlKey: true });
  await waitFor(() => expect(backend.restore).toHaveBeenCalledTimes(3));
  expect(await command({ count: 2 })).toMatchObject({
    panes: [{ strokes: 1 }, { strokes: 0 }, { strokes: 0 }, { strokes: 0 }],
  });
});
