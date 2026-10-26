import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";

import {
  cubeFaces,
  cubeNets,
  cylinderFaces,
  cylinderHeight,
  cylinderRadius,
  projectSolid,
} from "./solidGeometry";

import type { Vec3 } from "./solidGeometry";

export type SolidKind = "cube" | "cylinder";
export type SolidSettings = {
  unfold: number;
  net: number;
  colors: Record<string, string>;
  stroke: string;
  border: boolean;
  fit: number;
};
export const solidDefaults = (): SolidSettings => ({
  unfold: 0,
  net: 0,
  colors: {},
  stroke: "#17243c",
  border: true,
  fit: 1,
});
const validColor = (value: unknown): value is string =>
  typeof value === "string" &&
  (value === "transparent" ||
    /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(value));
export const solidFaces = (kind: SolidKind) =>
  kind === "cube"
    ? ["front", "back", "left", "right", "top", "bottom"]
    : ["side", "top", "bottom"];
export const configureSolid = (
  base: SolidSettings,
  changes: unknown,
): SolidSettings => {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new Error("Invalid solid settings");
  }
  const input = changes as Record<string, unknown>;
  const result = { ...base, colors: { ...base.colors } };
  if (input.fit !== undefined) {
    if (
      typeof input.fit !== "number" ||
      !Number.isFinite(input.fit) ||
      input.fit < 0.001 ||
      input.fit > 1
    ) {
      throw new Error("Invalid solid display scale");
    }
    result.fit = input.fit;
  }
  if (input.unfold !== undefined) {
    if (
      typeof input.unfold !== "number" ||
      !Number.isFinite(input.unfold) ||
      input.unfold < 0 ||
      input.unfold > 1
    ) {
      throw new Error("Invalid folding progress");
    }
    result.unfold = input.unfold;
  }
  if (input.net !== undefined) {
    if (
      typeof input.net !== "number" ||
      !Number.isInteger(input.net) ||
      input.net < 0 ||
      input.net >= cubeNets.length
    ) {
      throw new Error("Invalid unfolding net");
    }
    result.net = input.net;
  }
  if (input.border !== undefined) {
    if (typeof input.border !== "boolean") {
      throw new Error("Invalid solid border");
    }
    result.border = input.border;
  }
  if (input.stroke !== undefined) {
    if (!validColor(input.stroke)) {
      throw new Error("Invalid solid outline color");
    }
    result.stroke = input.stroke;
  }
  if (input.colors !== undefined) {
    if (
      !input.colors ||
      typeof input.colors !== "object" ||
      Array.isArray(input.colors)
    ) {
      throw new Error("Invalid face colors");
    }
    for (const [face, color] of Object.entries(input.colors)) {
      if (
        ![...solidFaces("cube"), "side"].includes(face) ||
        !validColor(color)
      ) {
        throw new Error("Invalid face color");
      }
      result.colors[face] = color;
    }
  }
  return result;
};

const pointKey = (point: Vec3) =>
  point.map((n) => Math.round(n * 1e6) / 1e6).join(",");
const edgeKey = (a: Vec3, b: Vec3) =>
  [pointKey(a), pointKey(b)].sort().join(";");
const scalar = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Every face remains an ordinary grouped board object, including transparent faces. */
export const solidShapes = (
  kind: SolidKind,
  settings: SolidSettings,
  size = 1,
  rotation = 0,
): ExcalidrawElementSkeleton[] => {
  const faces =
    kind === "cube"
      ? cubeFaces(settings.net, settings.unfold)
      : cylinderFaces(settings.net, settings.unfold);
  const angle = (-rotation * Math.PI) / 180;
  const near: Vec3 =
    kind === "cube"
      ? [0.5, -0.5, -1]
      : [0, -cylinderHeight / (6 * cylinderRadius), -1];
  const view: Vec3 = [
    near[0] * Math.cos(angle) + near[2] * Math.sin(angle),
    near[1],
    -near[0] * Math.sin(angle) + near[2] * Math.cos(angle),
  ];
  const facing = faces.map((face) => scalar(face.normal, view) > 1e-7);
  const projected = faces.map((face) =>
    face.points.map((p) => projectSolid(p, kind, rotation)),
  );
  const points = projected.flat();
  const center = [
    (Math.min(...points.map((p) => p[0])) +
      Math.max(...points.map((p) => p[0]))) /
      2,
    (Math.min(...points.map((p) => p[1])) +
      Math.max(...points.map((p) => p[1]))) /
      2,
  ];
  const scale = (kind === "cube" ? 140 : 150) * size * settings.fit;
  const project = (point: Vec3): [number, number] => {
    const p = projectSolid(point, kind, rotation);
    return [140 + (p[0] - center[0]) * scale, 130 + (p[1] - center[1]) * scale];
  };
  const path = (
    vertices: Vec3[],
    face: string,
    fill = "transparent",
    hidden = false,
  ): ExcalidrawElementSkeleton => {
    const p = vertices.map(project);
    const origin = p[0];
    return {
      type: "line",
      x: origin[0],
      y: origin[1],
      points: p.map(([x, y]) => pointFrom(x - origin[0], y - origin[1])),
      strokeColor: face ? "transparent" : settings.stroke,
      strokeWidth: face ? 0 : 2,
      strokeStyle: hidden ? "dashed" : "solid",
      backgroundColor: fill,
      fillStyle: "solid",
      roughness: 0,
      customData: face ? { fcSolidFace: face } : undefined,
    };
  };
  const result = faces
    .map((face, index) => ({
      face,
      index,
      depth:
        face.points.reduce((sum, p) => sum + scalar(p, view), 0) /
        face.points.length,
    }))
    .sort((a, b) => a.depth - b.depth)
    .map(({ face }) =>
      path(
        [...face.points, face.points[0]],
        face.id,
        settings.colors[face.id] || "transparent",
      ),
    );
  if (!settings.border) {
    return result;
  }
  if (kind === "cube") {
    const edges = new Map<string, { a: Vec3; b: Vec3; visible: boolean }>();
    faces.forEach((face, index) => {
      face.points.forEach((a, j) => {
        const b = face.points[(j + 1) % face.points.length];
        const id = edgeKey(a, b);
        const old = edges.get(id);
        edges.set(id, { a, b, visible: facing[index] || !!old?.visible });
      });
    });
    edges.forEach(({ a, b, visible }) =>
      result.push(path([a, b], "", "transparent", !visible)),
    );
  } else {
    const side = faces.filter((face) => face.id === "side");
    const closed = settings.unfold < 1e-7;
    for (const ring of [0, 1]) {
      let arc: Vec3[] = [];
      let hidden = false;
      side.forEach((face, i) => {
        const nextHidden =
          !facing[i] && !(closed && facing[side.length + ring]);
        if (arc.length && hidden !== nextHidden) {
          result.push(path(arc, "", "transparent", hidden));
          arc = [];
        }
        hidden = nextHidden;
        const a = face.points[ring ? 3 : 0];
        const b = face.points[ring ? 2 : 1];
        if (!arc.length) {
          arc.push(a);
        }
        arc.push(b);
      });
      if (arc.length) {
        result.push(path(arc, "", "transparent", hidden));
      }
    }
    side.forEach((face, i) => {
      const visible = facing[i];
      const [a, b, c, d] = face.points;
      if ((i && facing[i - 1] !== visible) || (i === 0 && !closed)) {
        result.push(path([a, d], ""));
      }
      if (i === side.length - 1 && !closed) {
        result.push(path([b, c], ""));
      }
    });
    if (!closed) {
      for (const face of faces.slice(side.length)) {
        result.push(path(face.points, ""));
      }
    }
  }
  return result;
};
