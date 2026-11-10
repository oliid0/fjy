import { latestFunctionInk } from "./functionInk";
import { latestShapeInk } from "./shapeRecognition";

import type { InkInput } from "./digitalInk";

const region = (ink: InkInput, mode: string) => {
  if (mode === "shape") {
    return latestShapeInk(ink);
  }
  if (mode === "text" || mode === "language") {
    // Detached dots and horizontal Chinese strokes still belong to a word.
    // Derive the gap from local stroke size, so zoom and handwriting size do
    // not turn every pen lift into a separate recognition request.
    const sizes = ink
      .map((stroke) => {
        let left = Infinity;
        let right = -Infinity;
        let top = Infinity;
        let bottom = -Infinity;
        for (const [x, y] of stroke) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
        return Math.max(right - left, bottom - top);
      })
      .filter((size) => Number.isFinite(size) && size > 0)
      .sort((a, b) => a - b);
    return latestFunctionInk(
      ink,
      0.8,
      Math.max(8, (sizes[Math.floor(sizes.length / 2)] || 0) / 2),
    );
  }
  return latestFunctionInk(ink, mode === "calculation" ? 1.1 : 0.35);
};

/** Independent ink regions keep separate requests; adding to the same region revises only it. */
export class InkRequests {
  private entries = new Map<
    AbortController,
    {
      ids: string[];
      ink: InkInput;
      mode: string;
      started: boolean;
      failed: boolean;
      current?: () => boolean;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  available(id: string) {
    return !Array.from(this.entries.values()).some((entry) =>
      entry.ids.includes(id),
    );
  }
  source<T>(
    pending: readonly T[],
    mode: string,
    id: (item: T) => string,
    ink: (items: readonly T[]) => InkInput,
  ) {
    let fresh = pending.filter((item) => this.available(id(item)));
    const included = region(ink(fresh), mode);
    fresh = fresh.filter((_, index) => included.has(index));
    if (!fresh.length) {
      return [];
    }
    const selected = new Set(fresh.map(id));
    for (const [request, entry] of this.entries) {
      if (entry.mode !== mode) {
        continue;
      }
      const group = region([...entry.ink, ...ink(fresh)], mode);
      if (
        Array.from(group).some((index) => index < entry.ink.length) &&
        Array.from(group).some((index) => index >= entry.ink.length)
      ) {
        this.cancel(request);
        entry.ids.forEach((value) => selected.add(value));
      }
    }
    return pending.filter((item) => selected.has(id(item)));
  }
  reserve(
    request: AbortController,
    ids: string[],
    ink: InkInput,
    mode: string,
    current?: () => boolean,
  ) {
    this.entries.set(request, {
      ids,
      ink,
      mode,
      started: false,
      failed: false,
      current,
    });
  }
  /** Every region owns its debounce; other regions may keep writing meanwhile. */
  schedule(request: AbortController, work: () => void, delay: number) {
    const entry = this.entries.get(request);
    if (entry) {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        if (entry.current && !entry.current()) {
          this.cancel(request);
        } else {
          work();
        }
      }, delay);
    }
  }
  /** A new contact revises only nearby requests, including its own pending debounce. */
  revise(ink: InkInput, mode: string) {
    for (const [request, entry] of this.entries) {
      if (entry.mode !== mode) {
        continue;
      }
      const included = region([...entry.ink, ...ink], mode);
      if (
        Array.from(included).some((index) => index < entry.ink.length) &&
        Array.from(included).some((index) => index >= entry.ink.length)
      ) {
        this.cancel(request);
      }
    }
  }
  private cancel(request: AbortController) {
    clearTimeout(this.entries.get(request)?.timer);
    request.abort();
    this.entries.delete(request);
  }
  start(request: AbortController) {
    const entry = this.entries.get(request);
    if (entry) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
      entry.started = true;
    }
  }
  finish(request: AbortController, failed: boolean) {
    const entry = this.entries.get(request);
    if (!entry) {
      return;
    }
    clearTimeout(entry.timer);
    if (!failed || request.signal.aborted) {
      this.entries.delete(request);
    } else {
      entry.failed = true;
      // Retain failed regions so unchanged ink is not included in the next query.
      if (this.entries.size > 100) {
        const oldest = Array.from(this.entries).find(([, item]) => item.failed);
        if (oldest) {
          this.entries.delete(oldest[0]);
        }
      }
    }
  }
  get busy() {
    return Array.from(this.entries.values()).some(
      (entry) => entry.started && !entry.failed,
    );
  }
  prune(visible: readonly string[]) {
    const ids = new Set(visible);
    for (const [request, entry] of this.entries) {
      if (
        entry.ids.some((id) => !ids.has(id)) ||
        (entry.current && !entry.current())
      ) {
        this.cancel(request);
      }
    }
  }
  cancelAll() {
    this.entries.forEach((_, request) => this.cancel(request));
  }
}
