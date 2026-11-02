import { pointFrom } from "@fcboard/math";

import type { FcboardElementSkeleton } from "@fcboard/element/transform";

import type { SolidSettings } from "./solids";

/** HShapeObject cases 11/13/14/17/18: factory silhouettes and hidden edges. */
export const factorySolidOutlines = (
  kind:
    | "cube"
    | "sphere"
    | "pyramid"
    | "cone"
    | "frustum"
    | "prism"
    | "hemisphere",
  settings: SolidSettings,
  size: number,
  rotation: number,
): FcboardElementSkeleton[] => {
  type Point = [number, number];
  const paths: { points: Point[]; hidden?: boolean; face?: string }[] = [];
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
  if (kind === "cube") {
    // HShapeObject case 12: one front square and two receding visible faces.
    paths.push(
      {
        points: [
          [0, 60],
          [120, 60],
          [120, 180],
          [0, 180],
          [0, 60],
          [60, 0],
          [180, 0],
          [180, 120],
          [120, 180],
          [120, 60],
          [180, 0],
        ],
      },
      {
        points: [
          [60, 0],
          [60, 120],
          [0, 180],
        ],
        hidden: true,
      },
      {
        points: [
          [60, 120],
          [180, 120],
        ],
        hidden: true,
      },
    );
    // Real face hit areas preserve the existing coloring/unfolding controls
    // while the visible outline remains the APK's three wire paths.
    paths.push(
      {
        face: "front",
        points: [
          [0, 60],
          [120, 60],
          [120, 180],
          [0, 180],
          [0, 60],
        ],
      },
      {
        face: "top",
        points: [
          [0, 60],
          [120, 60],
          [180, 0],
          [60, 0],
          [0, 60],
        ],
      },
      {
        face: "right",
        points: [
          [120, 60],
          [180, 0],
          [180, 120],
          [120, 180],
          [120, 60],
        ],
      },
    );
  } else if (kind === "sphere") {
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
  return paths.map(({ points, hidden, face }) => {
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
      strokeColor: !face && settings.border ? settings.stroke : "transparent",
      strokeStyle: hidden ? "dashed" : "solid",
      strokeWidth: face ? 0 : 2,
      roughness: 0,
      ...(face ? { customData: { fcSolidFace: face } } : {}),
    };
  });
};
