import { newElementWith } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";
import { API } from "@fcboard/fcboard/tests/helpers/api";
import { eraseStroke } from "@fcboard/fcboard/eraser/stroke";
import * as strokeGeometry from "@fcboard/fcboard/eraser/stroke";

import type { LocalPoint } from "@fcboard/math";

import { createNativeEraserBackend } from "./nativeEraser";

const native = vi.hoisted(() => ({
  erase: vi.fn(),
  clip: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ registerPlugin: () => native }));
beforeEach(() => {
  native.erase.mockReset().mockResolvedValue({ patches: [] });
  native.clip.mockReset();
  native.release.mockReset().mockResolvedValue(undefined);
});
const stroke = () => ({
  ...API.createElement({
    type: "freedraw",
    x: 0,
    y: 0,
    strokeWidth: 4,
    points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 0)],
  }),
  customData: { fcInk: { pen: "hard", dashOffset: 10 } },
  simulatePressure: false,
  pressures: [0.2, 0.8],
});
const path = [
  { x: 50, y: -30 },
  { x: 50, y: 30 },
];
it("clips a completed active contact in one native batch with its actual sample order", async () => {
  const ink = stroke();
  native.clip.mockResolvedValue({
    pieces: [
      [
        [0, 0, 0.2, 10, 0],
        [43, 0, 0.458, 53, 0],
      ],
    ],
    nibHit: true,
  });
  const backend = createNativeEraserBackend("board");
  const cuts = [
    {
      gesture: "palm",
      at: 1,
      path: [
        [50, -30],
        [50, 30],
      ] as [number, number][],
      width: 10,
      height: 12,
    },
  ];
  const pieces = await backend.clip(ink, cuts);
  expect(native.clip).toHaveBeenCalledTimes(1);
  expect(native.clip.mock.calls[0][0]).toMatchObject({
    cuts,
    stroke: {
      id: ink.id,
      samples: [
        [0, 0, 0.2, 10, 0, 0],
        [100, 0, 0.8, 110, 0, 1],
      ],
    },
  });
  expect(pieces[0]).toMatchObject({
    id: ink.id,
    pressures: [0.2, 0.458],
    customData: { fcInk: { dashOffset: 10 } },
  });
  expect(native.erase).not.toHaveBeenCalled();
});
it("sends version deltas once and removes deleted or locked strokes from the native index", async () => {
  const ink = stroke();
  const backend = createNativeEraserBackend("board");
  backend.synchronize([ink], []);
  await backend.erase([ink], path, 10, 12);
  expect(native.erase.mock.calls[0][0]).toMatchObject({
    owner: "board",
    updates: [
      {
        id: ink.id,
        samples: [
          [0, 0, 0.2, 10, 0],
          [100, 0, 0.8, 110, 0],
        ],
      },
    ],
    removals: [],
    path: [
      [50, -30],
      [50, 30],
    ],
  });
  await backend.erase([ink], path, 10, 12);
  expect(native.erase.mock.calls[1][0].updates).toEqual([]);
  const changed = newElementWith(ink, { x: 200 });
  backend.synchronize([changed], []);
  await backend.erase([changed], path, 10, 12);
  expect(native.erase.mock.calls[2][0].updates).toHaveLength(1);
  const locked = newElementWith(changed, { locked: true });
  backend.synchronize([locked], []);
  await backend.erase([locked], path, 10, 12);
  expect(native.erase.mock.calls[3][0].removals).toEqual([ink.id]);
});
it("reconstructs native intersections with the exact existing browser vector metadata", async () => {
  const ink = stroke();
  const backend = createNativeEraserBackend("board");
  backend.synchronize([ink], []);
  native.erase.mockResolvedValueOnce({
    patches: [
      {
        id: ink.id,
        nibHit: true,
        pieces: [
          [
            [0, 0, 0.2, 10, 0],
            [43, 0, 0.458, 53, 0],
          ],
          [
            [57, 0, 0.542, 67, 0],
            [100, 0, 0.8, 110, 0],
          ],
        ],
      },
    ],
  });
  const [patch] = await backend.erase([ink], path, 10, 12);
  const expected = eraseStroke(ink, path[0], path[1], 10, 12)!;
  expect(patch.source).toBe(ink);
  for (let i = 0; i < 2; i++) {
    const actual = patch.survivors[i];
    const browser = expected[i];
    expect(actual.x).toBeCloseTo(browser.x);
    expect(actual.points).toHaveLength(browser.points.length);
    actual.points.forEach((p, index) => {
      expect(p[0]).toBeCloseTo(browser.points[index][0]);
      expect(p[1]).toBeCloseTo(browser.points[index][1]);
    });
    actual.pressures.forEach((p, index) =>
      expect(p).toBeCloseTo(browser.pressures[index]),
    );
    expect(actual.customData?.fcInk.pen).toEqual(browser.customData?.fcInk.pen);
    expect(actual.customData?.fcInk.dashOffset).toBeCloseTo(
      browser.customData?.fcInk.dashOffset,
    );
    expect(actual.groupIds).toEqual(browser.groupIds);
  }
  // The editor may reject this patch after a concurrent update/cancellation.
  // The following batch must restore authoritative geometry even without edits.
  await backend.erase([ink], path, 10, 12);
  expect(native.erase.mock.calls[1][0].updates).toHaveLength(1);
});
it("drops an in-flight old-board response after native index reset", async () => {
  const ink = stroke();
  const backend = createNativeEraserBackend("board");
  backend.synchronize([ink], []);
  let finish!: (value: {
    patches: { id: string; pieces: number[][][]; nibHit: boolean }[];
  }) => void;
  native.erase.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pending = backend.erase([ink], path, 10, 12);
  await backend.reset();
  finish({ patches: [{ id: ink.id, pieces: [], nibHit: true }] });
  expect(await pending).toEqual([]);
  expect(native.release).toHaveBeenCalledWith({ owner: "board" });
  backend.synchronize([ink], []);
  await backend.erase([ink], path, 10, 12);
  expect(native.erase.mock.calls[1][0].updates).toHaveLength(1);
});

it("consumes scene deltas without enumerating the board on each erase sweep", async () => {
  const ink = stroke();
  const backend = createNativeEraserBackend("board");
  backend.synchronize([ink], []);
  const unreadableScene = new Proxy([ink], {
    get() {
      throw new Error("A sweep must not inspect the whole scene");
    },
  });
  await backend.erase(unreadableScene, path, 10, 12);
  expect(native.erase.mock.calls.at(-1)![0].updates).toHaveLength(1);
  await backend.erase(unreadableScene, path, 10, 12);
  expect(native.erase.mock.calls.at(-1)![0].updates).toEqual([]);
  const moved = newElementWith(ink, { x: 200 });
  backend.synchronize([moved], []);
  await backend.erase(unreadableScene, path, 10, 12);
  expect(native.erase.mock.calls.at(-1)![0].updates[0].samples[0][0]).toBe(200);
  backend.synchronize([], [ink.id]);
  await backend.erase(unreadableScene, path, 10, 12);
  expect(native.erase.mock.calls.at(-1)![0].removals).toEqual([ink.id]);
});

it("preserves a new object version received while a native cut is in flight", async () => {
  const ink = stroke();
  const backend = createNativeEraserBackend("board");
  backend.synchronize([ink], []);
  let finish!: (value: {
    patches: { id: string; pieces: number[][][]; nibHit: boolean }[];
  }) => void;
  native.erase.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pending = backend.erase([], path, 10, 12);
  const moved = newElementWith(ink, { x: 300 });
  backend.synchronize([moved], []);
  finish({ patches: [{ id: ink.id, pieces: [], nibHit: true }] });
  const [stale] = await pending;
  expect(stale.source).toBe(ink);
  await backend.erase([], path, 10, 12);
  expect(native.erase.mock.calls.at(-1)![0].updates[0].samples[0][0]).toBe(300);
});

it("prepares eraser geometry only when a sweep needs the latest committed version", async () => {
  const prepare = vi.spyOn(strokeGeometry, "prepareNativeEraseStroke");
  const ink = stroke();
  const backend = createNativeEraserBackend("board");
  try {
    backend.synchronize([ink], []);
    const moved = newElementWith(ink, { x: 200 });
    backend.synchronize([moved], []);
    expect(prepare).not.toHaveBeenCalled();
    await backend.erase([moved], path, 10, 12);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(moved);
    await backend.erase([moved], path, 10, 12);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(native.erase.mock.calls[1][0].updates).toEqual([]);
  } finally {
    prepare.mockRestore();
  }
});

it("prepares committed geometry before the first erase and discards superseded or reset work", async () => {
  vi.useFakeTimers();
  const prepare = vi.spyOn(strokeGeometry, "prepareNativeEraseStroke");
  const backend = createNativeEraserBackend("prepared");
  const original = stroke();
  const moved = newElementWith(original, { x: 300 });
  try {
    backend.synchronize([original], []);
    backend.synchronize([moved], []);
    await vi.runOnlyPendingTimersAsync();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(moved);
    await backend.erase([], path, 10, 12);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(native.erase.mock.calls.at(-1)![0].updates[0].samples[0][0]).toBe(
      300,
    );
    backend.synchronize([newElementWith(moved, { x: 500 })], []);
    await backend.reset();
    await vi.runOnlyPendingTimersAsync();
    expect(prepare).toHaveBeenCalledTimes(1);
  } finally {
    await backend.reset();
    prepare.mockRestore();
    vi.useRealTimers();
  }
});

it("yields first-erase preparation to input and keeps a version replaced during that yield", async () => {
  vi.useFakeTimers();
  let tick = 0;
  const clock = vi
    .spyOn(performance, "now")
    .mockImplementation(() => (tick += 5));
  const prepare = vi.spyOn(strokeGeometry, "prepareNativeEraseStroke");
  const backend = createNativeEraserBackend("dense");
  const inks = Array.from({ length: 48 }, stroke);
  const moved = newElementWith(inks[0], { x: 400 });
  let observed = -1;
  try {
    backend.synchronize(inks, []);
    setTimeout(() => {
      observed = prepare.mock.calls.length;
      backend.synchronize([moved], []);
    }, 0);
    const pending = backend.erase([], path, 10, 12);
    expect(native.erase).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    await pending;
    expect(observed).toBeGreaterThan(0);
    expect(observed).toBeLessThan(inks.length);
    expect(native.erase.mock.calls[0][0].updates).toHaveLength(47);
    expect(
      native.erase.mock.calls[0][0].updates.some(
        (item: { id: string }) => item.id === moved.id,
      ),
    ).toBe(false);
    const next = backend.erase([], path, 10, 12);
    await vi.runAllTimersAsync();
    await next;
    expect(native.erase.mock.calls[1][0].updates).toMatchObject([
      {
        id: moved.id,
        samples: [
          [400, 0, 0.2, 10, 0],
          [500, 0, 0.8, 110, 0],
        ],
      },
    ]);
    expect(prepare).toHaveBeenCalledTimes(49);
  } finally {
    await backend.reset();
    prepare.mockRestore();
    clock.mockRestore();
    vi.useRealTimers();
  }
});

it("drops a reset page before a yielded dense first-erase can submit its old geometry", async () => {
  vi.useFakeTimers();
  let tick = 0;
  const clock = vi
    .spyOn(performance, "now")
    .mockImplementation(() => (tick += 5));
  const backend = createNativeEraserBackend("old-page");
  try {
    backend.synchronize(Array.from({ length: 48 }, stroke), []);
    const pending = backend.erase([], path, 10, 12);
    expect(native.erase).not.toHaveBeenCalled();
    await backend.reset();
    await vi.runAllTimersAsync();
    expect(await pending).toEqual([]);
    expect(native.erase).not.toHaveBeenCalled();
  } finally {
    await backend.reset();
    clock.mockRestore();
    vi.useRealTimers();
  }
});
