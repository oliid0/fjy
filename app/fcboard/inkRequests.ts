import { latestFunctionInk } from "./functionInk";

import type { InkInput } from "./digitalInk";

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
    const fresh = pending.filter((item) => this.available(id(item)));
    if (!fresh.length) {
      return [];
    }
    const selected = new Set(fresh.map(id));
    for (const [request, entry] of this.entries) {
      if (entry.mode !== mode) {
        continue;
      }
      const group = latestFunctionInk(
        [...entry.ink, ...ink(fresh)],
        mode === "calculation" ? 1.1 : 0.35,
      );
      if (
        Array.from(group).some((index) => index < entry.ink.length) &&
        Array.from(group).some((index) => index >= entry.ink.length)
      ) {
        request.abort();
        this.entries.delete(request);
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
  ) {
    this.entries.set(request, {
      ids,
      ink,
      mode,
      started: false,
      failed: false,
    });
  }
  start(request: AbortController) {
    const entry = this.entries.get(request);
    if (entry) {
      entry.started = true;
    }
  }
  finish(request: AbortController, failed: boolean) {
    const entry = this.entries.get(request);
    if (!entry) {
      return;
    }
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
  cancelPending() {
    for (const [request, entry] of this.entries) {
      if (!entry.started) {
        request.abort();
        this.entries.delete(request);
      }
    }
  }
  prune(visible: readonly string[]) {
    const ids = new Set(visible);
    for (const [request, entry] of this.entries) {
      if (entry.ids.some((id) => !ids.has(id))) {
        request.abort();
        this.entries.delete(request);
      }
    }
  }
  cancelAll() {
    this.entries.forEach((_, request) => request.abort());
    this.entries.clear();
  }
}
