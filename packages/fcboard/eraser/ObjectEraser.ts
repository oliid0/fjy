import {
  getElementBounds,
  getWhiteboardCompositeKey,
  getElementLineSegments,
  isPointInElement,
  newElementWith,
  shouldTestInside,
} from "@fcboard/element";
import {
  factoryBrushSamples,
  isFactoryBrush,
} from "@fcboard/element/factoryBrush";
import { pointFrom, polygonIncludesPointNonZero } from "@fcboard/math";

import type { Scene } from "@fcboard/element";
import type { FcboardElement } from "@fcboard/element/types";
import type { GlobalPoint } from "@fcboard/math";

import { getLassoSelectedElementIds } from "../lasso/utils";

import {
  prepareNativeEraseStroke,
  strokeIntersectsSweep,
  sweptRectangle,
} from "./stroke";

type Point = { x: number; y: number };
type Bounds = readonly [number, number, number, number];
type Entry = {
  bounds: Bounds;
  cells?: string[];
  groups: readonly string[];
  related: string[];
  segments?: ReturnType<typeof getElementLineSegments>;
  stroke?: ReturnType<typeof prepareNativeEraseStroke>;
};
const CELL = 256;
const cells = (bounds: Bounds) => {
  const left = Math.floor(bounds[0] / CELL);
  const top = Math.floor(bounds[1] / CELL);
  const right = Math.floor(bounds[2] / CELL);
  const bottom = Math.floor(bounds[3] / CELL);
  // Same bounded-grid strategy as NativeStrokeEraser: very large objects or
  // sweeps use the coarse fallback instead of allocating an enormous grid.
  if (
    !bounds.every(Number.isFinite) ||
    (right - left + 1) * (bottom - top + 1) > 4096
  ) {
    return undefined;
  }
  const result: string[] = [];
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      result.push(`${col},${row}`);
    }
  }
  return result;
};
const overlaps = (a: Bounds, b: Bounds) =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** A scene-owned index follows committed mutations, including undo and in-place
 * edits. An empty eraser move neither rebuilds a scene map nor scans all ink. */
export class ObjectEraser {
  private entries = new Map<string, Entry>();
  private grid = new Map<string, Set<string>>();
  private large = new Set<string>();
  private groups = new Map<string, Set<string>>();
  private stop: () => void;
  constructor(private scene: Scene) {
    this.stop = scene.onMutation((updated, removed) => {
      const changed = new Set<string>();
      for (const id of removed) {
        this.entries
          .get(id)
          ?.related.forEach((related) => changed.add(related));
        this.remove(id);
      }
      for (const element of updated) {
        changed.add(element.id);
        this.entries.get(element.id)?.related.forEach((id) => changed.add(id));
        element.boundElements?.forEach((bound) => changed.add(bound.id));
        if (element.type === "text" && element.containerId) {
          changed.add(element.containerId);
        }
      }
      for (const id of changed) {
        this.update(id);
      }
    });
  }
  private remove(id: string) {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    for (const key of entry.cells || []) {
      const bucket = this.grid.get(key);
      bucket?.delete(id);
      if (!bucket?.size) {
        this.grid.delete(key);
      }
    }
    for (const key of entry.groups) {
      const group = this.groups.get(key);
      group?.delete(id);
      if (!group?.size) {
        this.groups.delete(key);
      }
    }
    this.large.delete(id);
    this.entries.delete(id);
  }
  private update(id: string) {
    this.remove(id);
    const map = this.scene.getNonDeletedElementsMap();
    const element = map.get(id);
    if (!element || element.locked) {
      return;
    }
    const raw = getElementBounds(element, map);
    const radius =
      element.type === "freedraw"
        ? isFactoryBrush(element)
          ? factoryBrushSamples(element).reduce(
              (max, sample) => Math.max(max, sample.width / 2),
              0,
            )
          : (element.strokeWidth * (element.customData?.fcInk ? 1 : 4.25)) / 2
        : element.strokeWidth / 2;
    const bounds: Bounds = [
      raw[0] - radius,
      raw[1] - radius,
      raw[2] + radius,
      raw[3] + radius,
    ];
    const related = element.boundElements?.map((bound) => bound.id) || [];
    if (element.type === "text" && element.containerId) {
      related.push(element.containerId);
    }
    const entry: Entry = {
      bounds,
      cells: cells(bounds),
      groups: [
        ...element.groupIds.map((group) => `group:${group}`),
        ...(getWhiteboardCompositeKey(element)
          ? [getWhiteboardCompositeKey(element)!]
          : []),
      ],
      related,
    };
    this.entries.set(id, entry);
    if (entry.cells) {
      for (const key of entry.cells) {
        const bucket = this.grid.get(key) || new Set<string>();
        bucket.add(id);
        this.grid.set(key, bucket);
      }
    } else {
      this.large.add(id);
    }
    for (const key of entry.groups) {
      const group = this.groups.get(key) || new Set<string>();
      group.add(id);
      this.groups.set(key, group);
    }
  }
  erase(
    samples: readonly Point[],
    width: number,
    height: number,
    live: Iterable<string> = [],
    protectedId?: string,
  ): readonly FcboardElement[] {
    const before = this.scene.getElementsIncludingDeleted();
    if (!samples.length) {
      return before;
    }
    // Browser writing keeps changing points without committed scene mutations.
    // Refresh only those few active contacts before querying their current cells.
    for (const id of live) {
      this.update(id);
    }
    const sweeps = (samples.length === 1 ? [samples[0]] : samples.slice(1)).map(
      (to, index) => {
        const from = samples[index];
        return {
          from,
          to,
          bounds: [
            Math.min(from.x, to.x) - width / 2,
            Math.min(from.y, to.y) - height / 2,
            Math.max(from.x, to.x) + width / 2,
            Math.max(from.y, to.y) + height / 2,
          ] as Bounds,
          path: sweptRectangle(from, to, width, height).map(({ x, y }) =>
            pointFrom<GlobalPoint>(x, y),
          ),
        };
      },
    );
    const candidates = new Set(this.large);
    for (const sweep of sweeps) {
      const keys = cells(sweep.bounds);
      if (!keys) {
        for (const id of this.entries.keys()) {
          candidates.add(id);
        }
        break;
      }
      for (const key of keys) {
        this.grid.get(key)?.forEach((id) => candidates.add(id));
      }
    }
    const elementsMap = this.scene.getNonDeletedElementsMap();
    const hit = new Set<string>();
    for (const id of candidates) {
      const entry = this.entries.get(id);
      const element = elementsMap.get(id);
      if (
        !entry ||
        !element ||
        element.locked ||
        hit.has(id) ||
        id === protectedId
      ) {
        continue;
      }
      const inside = shouldTestInside(element);
      const touched = sweeps.some(
        ({ from, to, path, bounds }) =>
          overlaps(entry.bounds, bounds) &&
          // Like HCanvas quickContains, an enclosing footprint deletes the
          // object directly without expanding a long centerline/curve.
          ([
            [entry.bounds[0], entry.bounds[1]],
            [entry.bounds[2], entry.bounds[1]],
            [entry.bounds[2], entry.bounds[3]],
            [entry.bounds[0], entry.bounds[3]],
          ].every(([x, y]) =>
            polygonIncludesPointNonZero(pointFrom<GlobalPoint>(x, y), path),
          ) ||
            (inside &&
              path.some((point) =>
                isPointInElement(point, element, elementsMap),
              )) ||
            (element.type === "freedraw"
              ? strokeIntersectsSweep(
                  (entry.stroke ||= prepareNativeEraseStroke(element)),
                  from,
                  to,
                  width,
                  height,
                )
              : getLassoSelectedElementIds({
                  lassoPath: path,
                  elements: [element],
                  elementsMap,
                  elementsSegments: new Map([
                    [
                      id,
                      (entry.segments ||= getElementLineSegments(
                        element,
                        elementsMap,
                      )),
                    ],
                  ]),
                  intersectedElements: new Set(),
                  enclosedElements: new Set(),
                }).selectedElementIds.length > 0)),
      );
      if (!touched) {
        continue;
      }
      hit.add(id);
      const group = element.groupIds.at(-1);
      if (group) {
        this.groups.get(`group:${group}`)?.forEach((member) => hit.add(member));
      }
      const composite = getWhiteboardCompositeKey(element);
      if (composite) {
        this.groups.get(composite)?.forEach((member) => hit.add(member));
      }
      element.boundElements
        ?.filter((bound) => bound.type === "text")
        .forEach((bound) => hit.add(bound.id));
      if (element.type === "text" && element.containerId) {
        hit.add(element.containerId);
      }
    }
    if (protectedId) {
      hit.delete(protectedId);
    }
    if (!hit.size) {
      return before;
    }
    return before.map((element) =>
      hit.has(element.id) && !element.isDeleted && !element.locked
        ? newElementWith(element, { isDeleted: true })
        : element,
    );
  }
  dispose() {
    this.stop();
    this.entries.clear();
    this.grid.clear();
    this.groups.clear();
    this.large.clear();
  }
}
