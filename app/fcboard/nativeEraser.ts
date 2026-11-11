import { registerPlugin } from "@capacitor/core";
import {
  prepareNativeEraseStroke,
  restoreEraseFragments,
} from "@fcboard/fcboard/eraser/stroke";

import type {
  NativeEraserBackend,
  NativeEraseUpdate,
} from "@fcboard/fcboard/eraser/stroke";
import type {
  FcboardElement,
  FcboardFreeDrawElement,
} from "@fcboard/element/types";

const plugin = registerPlugin<{
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
}>("FcboardNativeEraser");

type Cached = {
  source: FcboardFreeDrawElement;
  version: number;
  nonce: number;
  geometry: ReturnType<typeof prepareNativeEraseStroke>;
};

/** The native worker owns the index and all repeated sweep/clip calculations.
 * Send only version deltas; canonical rendered geometry is prepared once when
 * a stroke first enters the index, never for every eraser motion sample. */
export const createNativeEraserBackend = (owner: string) => {
  const cache = new Map<string, Cached>();
  const indexed = new Map<string, Cached>();
  const dirty = new Map<string, Cached>();
  const removed = new Set<string>();
  let streamed = false;
  let epoch = 0;
  const update = (
    elements: readonly FcboardElement[],
    removals: readonly string[],
  ) => {
    for (const id of removals) {
      cache.delete(id);
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
      const entry = {
        source,
        version: source.version,
        nonce: source.versionNonce,
        geometry: prepareNativeEraseStroke(source),
      };
      cache.set(source.id, entry);
      dirty.set(source.id, entry);
      removed.delete(source.id);
    }
  };
  const synchronize = (
    elements: readonly FcboardElement[],
    removals: readonly string[],
  ) => {
    streamed = true;
    update(elements, removals);
  };
  const erase: NativeEraserBackend = async (elements, path, width, height) => {
    const stamp = epoch;
    if (!streamed) {
      // Compatibility for standalone callers; the editor uses onMutation deltas.
      const ids = new Set(elements.map((element) => element.id));
      update(
        elements,
        [...cache.keys()].filter((id) => !ids.has(id)),
      );
    }
    const updates = [...dirty.values()].map((entry) => {
      const { source, geometry } = entry;
      indexed.set(source.id, entry);
      return {
        id: source.id,
        cap: geometry.cap,
        brush: geometry.brush,
        brushAngle: geometry.brushAngle,
        samples: geometry.samples.map((p) => [
          p.x,
          p.y,
          p.pressure,
          p.distance,
          p.brushWidth,
        ]),
        nibOutline: geometry.nibOutline.map((p) => [p.x, p.y]),
      };
    });
    const removals = [...removed];
    removals.forEach((id) => indexed.delete(id));
    dirty.clear();
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
    for (const patch of result.patches) {
      const entry = indexed.get(patch.id);
      if (!entry) {
        throw new Error("Native eraser returned an unknown stroke");
      }
      // The editor can reject a stale result after a concurrent edit/cancel.
      // Force the next synchronization to restore authoritative scene geometry.
      if (cache.get(patch.id) === entry) {
        dirty.set(patch.id, entry);
      }
      const pieces = patch.pieces.map((piece) =>
        piece.map((p) => {
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
        }),
      );
      patches.push({
        source: entry.source,
        version: entry.version,
        nonce: entry.nonce,
        survivors: restoreEraseFragments(entry.source, pieces, {
          ...entry.geometry,
          nibHit: patch.nibHit,
        }),
      });
    }
    return patches;
  };
  const reset = () => {
    epoch++;
    cache.clear();
    indexed.clear();
    dirty.clear();
    removed.clear();
    streamed = false;
    return plugin.release({ owner });
  };
  return { erase, synchronize, reset };
};
