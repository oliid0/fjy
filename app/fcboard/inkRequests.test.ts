import { InkRequests } from "./inkRequests";

import type { InkInput } from "./digitalInk";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const ink = (x: number): InkInput => [
  [
    [x, 100],
    [x + 100, 160],
  ],
];
it.each(["text", "language"])(
  "keeps detached %s strokes in one writing region and leaves a distant word independent",
  (mode) => {
    const requests = new InkRequests();
    const stem = {
      id: "stem",
      points: [
        [100, 140],
        [100, 180],
      ] as [number, number][],
    };
    const dot = { id: "dot", points: [[100, 120]] as [number, number][] };
    const distant = new AbortController();
    const first = new AbortController();
    requests.reserve(first, [stem.id], [stem.points], mode);
    requests.reserve(distant, ["distant"], ink(500), mode);
    requests.revise([dot.points], mode);
    expect(first.signal.aborted).toBe(true);
    expect(distant.signal.aborted).toBe(false);
    expect(
      requests.source(
        [stem, dot],
        mode,
        (item) => item.id,
        (items) => items.map((item) => item.points),
      ),
    ).toEqual([stem, dot]);
    const bars = [100, 140, 180].map((y, index) => ({
      id: String(index),
      points: [
        [100, y],
        [200, y],
      ] as [number, number][],
    }));
    expect(
      requests.source(
        bars,
        mode,
        (item) => item.id,
        (items) => items.map((item) => item.points),
      ),
    ).toEqual(bars);
  },
);
it("revises only a nearby contact while another pending region keeps its own deadline", () => {
  const requests = new InkRequests();
  const first = new AbortController();
  const second = new AbortController();
  const a = vi.fn();
  const b = vi.fn();
  requests.reserve(first, ["first"], ink(100), "magic");
  requests.schedule(first, a, 1600);
  vi.advanceTimersByTime(400);
  requests.reserve(second, ["second"], ink(500), "magic");
  requests.schedule(second, b, 1600);
  requests.revise(
    [
      [
        [180, 130],
        [220, 150],
      ],
    ],
    "magic",
  );
  expect(first.signal.aborted).toBe(true);
  expect(second.signal.aborted).toBe(false);
  vi.advanceTimersByTime(1599);
  expect(a).not.toHaveBeenCalled();
  expect(b).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(b).toHaveBeenCalledTimes(1);
});
it("deletes only removed regions and cancels all remaining timers on a page change", () => {
  const requests = new InkRequests();
  const first = new AbortController();
  const second = new AbortController();
  const a = vi.fn();
  const b = vi.fn();
  requests.reserve(first, ["first"], ink(100), "magic");
  requests.reserve(second, ["second"], ink(500), "magic");
  requests.schedule(first, a, 1600);
  requests.schedule(second, b, 1600);
  requests.prune(["second"]);
  expect(first.signal.aborted).toBe(true);
  expect(second.signal.aborted).toBe(false);
  requests.cancelAll();
  vi.advanceTimersByTime(2000);
  expect(a).not.toHaveBeenCalled();
  expect(b).not.toHaveBeenCalled();
  expect(second.signal.aborted).toBe(true);
});

it("releases relocated ink IDs for a new request while an independent region keeps its deadline", () => {
  const requests = new InkRequests();
  const moved = new AbortController();
  const other = new AbortController();
  const staleWork = vi.fn();
  const otherWork = vi.fn();
  let valid = true;
  requests.reserve(moved, ["moved"], ink(100), "text", () => valid);
  requests.reserve(other, ["other"], ink(500), "text");
  requests.schedule(moved, staleWork, 700);
  requests.schedule(other, otherWork, 700);
  vi.advanceTimersByTime(400);
  valid = false;
  requests.prune(["moved", "other"]);
  expect(moved.signal.aborted).toBe(true);
  expect(requests.available("moved")).toBe(true);
  expect(other.signal.aborted).toBe(false);
  vi.advanceTimersByTime(300);
  expect(staleWork).not.toHaveBeenCalled();
  expect(otherWork).toHaveBeenCalledTimes(1);
});
