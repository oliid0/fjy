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
