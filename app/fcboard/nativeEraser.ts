import { registerPlugin } from "@capacitor/core";
import {
  prepareNativeEraseStroke,
  restoreEraseFragments,
} from "@fcboard/fcboard/eraser/stroke";

import type {
  NativeEraserBackend,
  NativeEraseUpdate,
  NativeInkClipBackend,
} from "@fcboard/fcboard/eraser/stroke";
import type {
  FcboardElement,
  FcboardFreeDrawElement,
} from "@fcboard/element/types";

const plugin = registerPlugin<{
  synchronize(options: {
    owner: string;
    updates: unknown[];
    removals: string[];
  }): Promise<void>;
  erase(options: {
    owner: string;
    updates: unknown[];
    removals: string[];
    path: number[][];
    width: number;
    height: number;
  }): Promise<{
    patches: { id: string; pieces: number[][][]; nibHit: boolean }[];
  }>;
  release(options: { owner: string }): Promise<void>;
  clip(options: { stroke: unknown; cuts: unknown[] }): Promise<{
    pieces: number[][][];
    nibHit: boolean;
  }>;
}>("FcboardNativeEraser");

type Cached = {
  source: FcboardFreeDrawElement;
  version: number;
  nonce: number;
  geometry?: Omit<
    ReturnType<typeof prepareNativeEraseStroke>,
    "samples" | "sources"
  >;
  payload?: unknown;
  failure?: { reason: unknown };
};

/** The native worker owns the index and all repeated sweep/clip calculations.
 * Send only version deltas; canonical rendered geometry is prepared once when
 * a stroke first enters the index, never for every eraser motion sample. */
export const createNativeEraserBackend = (owner: string) => {
  const clip: NativeInkClipBackend = async (element, cuts) => {
    const geometry = prepareNativeEraseStroke(element);
    const result = await plugin.clip({
      stroke: {
        id: element.id,
        cap: geometry.cap,
        brush: geometry.brush,
        brushAngle: geometry.brushAngle,
        samples: geometry.samples.map((p, i) => [
          p.x,
          p.y,
          p.pressure,
          p.distance,
          p.brushWidth,
          geometry.sources[i],
        ]),
        nibOutline: geometry.nibOutline.map((p) => [p.x, p.y]),
        nibSource: element.points.length - 1,
      },
      cuts: [...cuts],
    });
    return restoreEraseFragments(element, decodePieces(result.pieces), {
      ...geometry,
      nibHit: result.nibHit,
    });
  };
  const cache = new Map<string, Cached>();
  const indexed = new Map<string, Cached>();
  const dirty = new Map<string, Cached>();
  const removed = new Set<string>();
  let epoch = 0;
  const preparation = new Map<string, Cached>();
  const prepare = (entry: Cached) => {
    if (entry.failure) {
      throw entry.failure.reason;
    }
    if (!entry.payload) {
      const {
        samples,
        sources: _sources,
        ...geometry
      } = prepareNativeEraseStroke(entry.source);
      entry.geometry = geometry;
      entry.payload = {
        id: entry.source.id,
        cap: geometry.cap,
        brush: geometry.brush,
        brushAngle: geometry.brushAngle,
        samples: samples.map((p) => [
          p.x,
          p.y,
          p.pressure,
          p.distance,
          p.brushWidth,
        ]),
        nibOutline: geometry.nibOutline.map((p) => [p.x, p.y]),
      };
    }
    return entry.payload;
  };
  let preparationTimer: ReturnType<typeof setTimeout> | undefined;
  let indexing: Promise<void> | undefined;
  let sweeps = 0;
  const schedulePreparation = () => {
    if (
      preparationTimer !== undefined ||
      indexing ||
      sweeps ||
      (!preparation.size && !removed.size)
    ) {
      return;
    }
    preparationTimer = setTimeout(() => {
      preparationTimer = undefined;
      if (sweeps) {
        return;
      }
      const stamp = epoch;
      const entries = new Map<string, Cached>();
      const began = performance.now();
      for (const [id, entry] of preparation) {
        preparation.delete(id);
        if (cache.get(id) !== entry) {
          continue;
        }
        try {
          prepare(entry);
          entries.set(id, entry);
        } catch (reason) {
          entry.failure = { reason };
        }
        // Keep recognition, result placement and ordinary editor work responsive
        // while a loaded dense page prepares its existing stroke geometry.
        if (entries.size >= 16 || performance.now() - began >= 4) {
          break;
        }
      }
      const removals = [...removed];
      if (!entries.size && !removals.length) {
        schedulePreparation();
        return;
      }
      indexing = plugin
        .synchronize({
          owner,
          updates: [...entries.values()].map((entry) => entry.payload),
          removals,
        })
        .then(() => {
          if (epoch === stamp) {
            for (const id of removals) {
              indexed.delete(id);
              removed.delete(id);
            }
            for (const [id, entry] of entries) {
              indexed.set(id, entry);
              if (dirty.get(id) === entry) {
                dirty.delete(id);
              }
            }
          }
        })
        .catch(() => {
          // The next sweep retries the authoritative deltas.
        })
        .finally(() => {
          if (epoch === stamp) {
            indexing = undefined;
            if (preparation.size) schedulePreparation();
          }
        });
    }, 0);
  };

  const update = (
    elements: readonly FcboardElement[],
    removals: readonly string[],
  ) => {
    for (const id of removals) {
      cache.delete(id);
      preparation.delete(id);
      dirty.delete(id);
      removed.add(id);
    }
    for (const source of elements) {
      if (
        source.type !== "freedraw" ||
        source.isDeleted ||
        source.locked ||
        !source.points.length
      ) {
        if (cache.delete(source.id) || indexed.has(source.id)) {
          preparation.delete(source.id);
          dirty.delete(source.id);
          removed.add(source.id);
        }
        continue;
      }
      const previous = cache.get(source.id);
      if (
        previous?.source === source &&
        previous.version === source.version &&
        previous.nonce === source.versionNonce
      ) {
        continue;
      }
      const entry: Cached = {
        source,
        version: source.version,
        nonce: source.versionNonce,
      };
      cache.set(source.id, entry);
      dirty.set(source.id, entry);
      preparation.set(source.id, entry);
      removed.delete(source.id);
    }
  };
  const synchronize = (
    elements: readonly FcboardElement[],
    removals: readonly string[],
  ) => {
    update(elements, removals);
    schedulePreparation();
  };
  const cut: NativeEraserBackend = async (_elements, path, width, height) => {
    const stamp = epoch;
    const entries = [...dirty.entries()];
    let began = performance.now();
    for (let i = 0; i < entries.length; i++) {
      const [id, entry] = entries[i];
      if (cache.get(id) !== entry) {
        continue;
      }
      preparation.delete(id);
      prepare(entry);
      // A dense page may reach the first eraser before idle preparation. Do not
      // turn that first gesture into one synchronous board-sized JS task.
      if (i + 1 < entries.length && performance.now() - began >= 4) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (epoch !== stamp) {
          return [];
        }
        began = performance.now();
      }
    }
    const updates: unknown[] = [];
    for (const [id, entry] of entries) {
      if (cache.get(id) !== entry) {
        continue;
      }
      updates.push(entry.payload);
      indexed.set(id, entry);
      if (dirty.get(id) === entry) {
        dirty.delete(id);
      }
    }
    const removals = [...removed];
    removals.forEach((id) => indexed.delete(id));
    removed.clear();
    const result = await plugin.erase({
      owner,
      updates,
      removals,
      path: path.map((p) => [p.x, p.y]),
      width,
      height,
    });
    if (epoch !== stamp) {
      return [];
    }
    const patches: NativeEraseUpdate[] = [];
    began = performance.now();
    for (let i = 0; i < result.patches.length; i++) {
      const patch = result.patches[i];
      const entry = indexed.get(patch.id);
      if (!entry) {
        throw new Error("Native eraser returned an unknown stroke");
      }
      // The editor can reject a stale result after a concurrent edit/cancel.
      // Force the next synchronization to restore authoritative scene geometry.
      if (cache.get(patch.id) === entry) {
        dirty.set(patch.id, entry);
      }
      const pieces = decodePieces(patch.pieces);
      patches.push({
        source: entry.source,
        version: entry.version,
        nonce: entry.nonce,
        survivors: restoreEraseFragments(entry.source, pieces, {
          ...entry.geometry!,
          nibHit: patch.nibHit,
        }),
      });
      if (i + 1 < result.patches.length && performance.now() - began >= 4) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (epoch !== stamp) {
          return [];
        }
        began = performance.now();
      }
    }
    return patches;
  };
  const erase: NativeEraserBackend = async (...args) => {
    const stamp = epoch;
    sweeps++;
    try {
      if (indexing) await indexing;
      return stamp === epoch ? await cut(...args) : [];
    } finally {
      sweeps--;
      schedulePreparation();
    }
  };
  const reset = () => {
    indexing = undefined;
    epoch++;
    clearTimeout(preparationTimer);
    preparationTimer = undefined;
    preparation.clear();
    cache.clear();
    indexed.clear();
    dirty.clear();
    removed.clear();
    return plugin.release({ owner });
  };
  return { erase, clip, synchronize, reset };
};

const decodePieces = (pieces: number[][][]) =>
  pieces.map((piece) => {
    if (!piece.length) {
      throw new Error("Native eraser returned an empty fragment");
    }
    return piece.map((p) => {
      if (p.length !== 5 || !p.every(Number.isFinite) || p[4] < 0) {
        throw new Error("Native eraser returned invalid geometry");
      }
      return {
        x: p[0],
        y: p[1],
        pressure: p[2],
        distance: p[3],
        brushWidth: p[4],
      };
    });
  });
