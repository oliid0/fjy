import { pointFrom } from "@fcboard/math";

import type { FcboardElementSkeleton } from "@fcboard/element/transform";

import type { SolidSettings } from "./solids";

/** HShapeObject cases 11/13/14/17/18: factory silhouettes and hidden edges. */
export const factorySolidOutlines = (
  kind: "sphere" | "pyramid" | "cone" | "frustum" | "prism" | "hemisphere",
  settings: SolidSettings,
  size: number,
  rotation: number,
): FcboardElementSkeleton[] => {
  type Point = [number, number];
  const paths: { points: Point[]; hidden?: boolean }[] = [];
  const arc = (
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    start: number,
    sweep: number,
    hidden = false,
  ) => {
    const count = Math.ceil((Math.abs(sweep) * 32) / Math.PI);
    paths.push({
      hidden,
      points: Array.from({ length: count + 1 }, (_, index) => {
        const angle = start + (sweep * index) / count;
        return [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)];
      }),
    });
  };
  if (kind === "sphere") {
    arc(90, 90, 90, 90, 0, 2 * Math.PI);
    arc(90, 90, 90, 45, 0, Math.PI);
    arc(90, 90, 90, 45, 0, -Math.PI, true);
  } else if (kind === "hemisphere") {
    arc(90, 90, 90, 90, 0, -Math.PI);
    arc(90, 90, 90, 45, 0, Math.PI);
    arc(90, 90, 90, 45, 0, -Math.PI, true);
  } else if (kind === "cone") {
    paths.push({
      points: [
        [0, 180],
        [90, 0],
        [180, 180],
      ],
    });
    arc(90, 180, 90, 20, 0, Math.PI);
    arc(90, 180, 90, 20, 0, -Math.PI, true);
  } else if (kind === "frustum") {
    arc(90, 37.5, 45, 12.5, 0, 2 * Math.PI);
    paths.push(
      {
        points: [
          [45, 37.5],
          [0, 175],
        ],
      },
      {
        points: [
          [135, 37.5],
          [180, 175],
        ],
      },
    );
    arc(90, 175, 90, 25, 0, Math.PI);
    arc(90, 175, 90, 25, 0, -Math.PI, true);
  } else if (kind === "pyramid") {
    paths.push(
      {
        points: [
          [90, 0],
          [0, 180],
          [180, 180],
          [90, 0],
        ],
      },
      {
        points: [
          [90, 0],
          [90, 120],
          [0, 180],
        ],
        hidden: true,
      },
      {
        points: [
          [90, 120],
          [180, 180],
        ],
        hidden: true,
      },
    );
  } else {
    paths.push(
      {
        points: [
          [0, 50],
          [0, 200],
          [90, 150],
          [180, 200],
          [180, 50],
          [90, 0],
          [0, 50],
        ],
      },
      {
        points: [
          [90, 0],
          [90, 150],
        ],
        hidden: true,
      },
    );
  }
  const all = paths.flatMap((path) => path.points);
  const cx =
    (Math.min(...all.map(([x]) => x)) + Math.max(...all.map(([x]) => x))) / 2;
  const cy =
    (Math.min(...all.map(([, y]) => y)) + Math.max(...all.map(([, y]) => y))) /
    2;
  const angle = (rotation * Math.PI) / 180;
  const scale = size * settings.fit;
  return paths.map(({ points, hidden }) => {
    const transformed = points.map(
      ([x, y]): Point => [
        (cx + (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle)) * scale,
        (cy + (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle)) * scale,
      ],
    );
    const [x, y] = transformed[0];
    return {
      type: "line",
      x,
      y,
      points: transformed.map(([px, py]) => pointFrom(px - x, py - y)),
      strokeColor: settings.border ? settings.stroke : "transparent",
      strokeStyle: hidden ? "dashed" : "solid",
      strokeWidth: 2,
      roughness: 0,
    };
  });
};
