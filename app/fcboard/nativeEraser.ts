import { registerPlugin } from "@capacitor/core";
import {
  prepareNativeEraseStroke,
  restoreEraseFragments,
} from "@fcboard/fcboard/eraser/stroke";

import type {
  NativeEraserBackend,
  NativeEraseUpdate,
} from "@fcboard/fcboard/eraser/stroke";
import type { FcboardFreeDrawElement } from "@fcboard/element/types";

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
  let cache = new Map<string, Cached>();
  let epoch = 0;
  const erase: NativeEraserBackend = async (elements, path, width, height) => {
    const stamp = epoch;
    const next = new Map<string, Cached>();
    const updates = [];
    for (const source of elements) {
      if (
        source.type !== "freedraw" ||
        source.isDeleted ||
        source.locked ||
        !source.points.length
      ) {
        continue;
      }
      const previous = cache.get(source.id);
      const entry =
        previous?.source === source &&
        previous.version === source.version &&
        previous.nonce === source.versionNonce
          ? previous
          : {
              source,
              version: source.version,
              nonce: source.versionNonce,
              geometry: prepareNativeEraseStroke(source),
            };
      next.set(source.id, entry);
      if (entry !== previous) {
        const { geometry } = entry;
        updates.push({
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
        });
      }
    }
    const result = await plugin.erase({
      owner,
      updates,
      removals: [...cache.keys()].filter((id) => !next.has(id)),
      path: path.map((p) => [p.x, p.y]),
      width,
      height,
    });
    if (epoch !== stamp) {
      return [];
    }
    cache = next;
    const patches: NativeEraseUpdate[] = [];
    for (const patch of result.patches) {
      const entry = next.get(patch.id);
      if (!entry) {
        throw new Error("Native eraser returned an unknown stroke");
      }
      // The editor can reject a stale result after a concurrent edit/cancel.
      // Force the next synchronization to restore authoritative scene geometry.
      cache.delete(patch.id);
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
    return plugin.release({ owner });
  };
  return { erase, reset };
};
