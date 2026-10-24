/** Rigid face hinges, as in Mathigon's x-net, projected into editable board paths.
 * Cube nets are enumerated and checked locally, rather than trusting a picture.
 * References and the factory projection are recorded in docs/apk-alignment.md.
 */
export type Vec3 = [number, number, number];
export type Cell = [number, number];
export type SolidFace = { id: string; points: Vec3[]; normal: Vec3 };
type Pose = { origin: Vec3; u: Vec3; v: Vec3 };
type Joint = { cell: Cell; parent: number; direction: number };
export type CubeNet = { cells: Cell[]; joints: Joint[]; faceIds: string[] };
const directions: Cell[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, n: number): Vec3 => [a[0] * n, a[1] * n, a[2] * n];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const rotate = (vector: Vec3, axis: Vec3, angle: number): Vec3 => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return add(
    add(mul(vector, cos), mul(cross(axis, vector), sin)),
    mul(axis, dot(axis, vector) * (1 - cos)),
  );
};

const poses = (joints: Joint[], unfold: number): Pose[] => {
  const result: Pose[] = [{ origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] }];
  const angle = ((1 - unfold) * Math.PI) / 2;
  for (const joint of joints.slice(1)) {
    const parent = result[joint.parent];
    const { origin, u, v } = parent;
    if (joint.direction === 0) {
      result.push({ origin: add(origin, u), u: rotate(u, v, -angle), v });
    } else if (joint.direction === 1) {
      result.push({ origin: add(origin, v), u, v: rotate(v, u, angle) });
    } else if (joint.direction === 2) {
      const nextU = rotate(u, v, angle);
      result.push({ origin: add(origin, mul(nextU, -1)), u: nextU, v });
    } else {
      const nextV = rotate(v, u, -angle);
      result.push({ origin: add(origin, mul(nextV, -1)), u, v: nextV });
    }
  }
  return result;
};

const corners = ({ origin, u, v }: Pose): Vec3[] => [
  origin,
  add(origin, u),
  add(add(origin, u), v),
  add(origin, v),
];

/** Free polyomino identity: translations, rotations and reflections are equivalent. */
const cellKey = (cells: Cell[]) => {
  const variants: string[] = [];
  for (const mirror of [1, -1]) {
    for (let turn = 0; turn < 4; turn++) {
      const points = cells.map(([x, y]): Cell => {
        let a = x * mirror;
        let b = y;
        for (let n = 0; n < turn; n++) {
          [a, b] = [-b, a];
        }
        return [a, b];
      });
      const left = Math.min(...points.map(([x]) => x));
      const top = Math.min(...points.map(([, y]) => y));
      variants.push(
        points
          .map(([x, y]): Cell => [x - left, y - top])
          .sort((a, b) => a[0] - b[0] || a[1] - b[1])
          .map((p) => p.join(","))
          .join(";"),
      );
    }
  }
  return variants.sort()[0];
};

const cubeNet = (cells: Cell[]): CubeNet | undefined => {
  const joints: Joint[] = [{ cell: cells[0], parent: -1, direction: 0 }];
  const visited = new Set([cells[0].join(",")]);
  let edges = 0;
  for (const [x, y] of cells) {
    edges += directions.filter(([dx, dy]) =>
      cells.some(([a, b]) => a === x + dx && b === y + dy),
    ).length;
  }
  if (edges !== 10) {
    return;
  }
  for (let index = 0; index < joints.length; index++) {
    const [x, y] = joints[index].cell;
    directions.forEach(([dx, dy], direction) => {
      const next: Cell = [x + dx, y + dy];
      if (
        !visited.has(next.join(",")) &&
        cells.some(([a, b]) => a === next[0] && b === next[1])
      ) {
        visited.add(next.join(","));
        joints.push({ cell: next, parent: index, direction });
      }
    });
  }
  if (joints.length !== 6) {
    return;
  }
  const folded = poses(joints, 0);
  const normals = folded.map(({ u, v }) =>
    cross(u, v).map(Math.round).join(","),
  );
  if (new Set(normals).size !== 6) {
    return;
  }
  if (
    folded
      .flatMap(corners)
      .some((p) => p.some((n) => n < -1e-7 || n > 1 + 1e-7))
  ) {
    return;
  }
  const faceIds = folded.map((pose) => {
    const center = add(pose.origin, mul(add(pose.u, pose.v), 0.5));
    if (Math.abs(center[2]) < 1e-7) {
      return "front";
    }
    if (Math.abs(center[2] - 1) < 1e-7) {
      return "back";
    }
    if (Math.abs(center[0]) < 1e-7) {
      return "left";
    }
    if (Math.abs(center[0] - 1) < 1e-7) {
      return "right";
    }
    return Math.abs(center[1]) < 1e-7 ? "top" : "bottom";
  });
  return { cells, joints, faceIds };
};

const enumerateCubeNets = () => {
  let candidates = new Map<string, Cell[]>([["0,0", [[0, 0]]]]);
  for (let count = 1; count < 6; count++) {
    const next = new Map<string, Cell[]>();
    for (const cells of candidates.values()) {
      for (const [x, y] of cells) {
        for (const [dx, dy] of directions) {
          const cell: Cell = [x + dx, y + dy];
          if (cells.some(([a, b]) => a === cell[0] && b === cell[1])) {
            continue;
          }
          const key = cellKey([...cells, cell]);
          if (!next.has(key)) {
            next.set(
              key,
              key.split(";").map((pair) => pair.split(",").map(Number) as Cell),
            );
          }
        }
      }
    }
    candidates = next;
  }
  return [...candidates.values()]
    .map(cubeNet)
    .filter((net): net is CubeNet => !!net);
};

export const cubeNets = enumerateCubeNets();
export const cubeFaces = (net: number, unfold: number): SolidFace[] => {
  const layout = cubeNets[net];
  if (!layout || !Number.isFinite(unfold) || unfold < 0 || unfold > 1) {
    throw new Error("Invalid cube net or folding progress");
  }
  return poses(layout.joints, unfold).map((pose, index) => ({
    id: layout.faceIds[index],
    points: corners(pose),
    normal: mul(cross(pose.u, pose.v), -1),
  }));
};

export const cylinderNets = [
  [0, 0],
  [-0.5, 0.5],
  [0.5, -0.5],
] as const;
export const cylinderRadius = 0.5;
export const cylinderHeight = 13 / 15;
export const cylinderFaces = (net: number, unfold: number): SolidFace[] => {
  if (
    !cylinderNets[net] ||
    !Number.isFinite(unfold) ||
    unfold < 0 ||
    unfold > 1
  ) {
    throw new Error("Invalid cylinder net or folding progress");
  }
  const radius = cylinderRadius;
  const height = cylinderHeight;
  const curvature = (1 - unfold) / radius;
  const curve = (s: number): Vec3 =>
    Math.abs(curvature) < 1e-8
      ? [s, 0, 0]
      : [
          Math.sin(curvature * s) / curvature,
          0,
          (1 - Math.cos(curvature * s)) / curvature,
        ];
  const tangent = (s: number): Vec3 => [
    Math.cos(curvature * s),
    0,
    Math.sin(curvature * s),
  ];
  const inward = (s: number): Vec3 => [
    -Math.sin(curvature * s),
    0,
    Math.cos(curvature * s),
  ];
  const faces: SolidFace[] = [];
  const count = 48;
  for (let i = 0; i < count; i++) {
    const a = ((i / count) * 2 - 1) * Math.PI * radius;
    const b = (((i + 1) / count) * 2 - 1) * Math.PI * radius;
    faces.push({
      id: "side",
      points: [
        curve(a),
        curve(b),
        add(curve(b), [0, height, 0]),
        add(curve(a), [0, height, 0]),
      ],
      normal: mul(inward((a + b) / 2), -1),
    });
  }
  for (const [index, id] of ["top", "bottom"].entries()) {
    const s = cylinderNets[net][index] * Math.PI * radius;
    const hinge = add(curve(s), [0, index ? height : 0, 0]);
    const u = tangent(s);
    const v = add(mul(inward(s), Math.cos((unfold * Math.PI) / 2)), [
      0,
      (index ? 1 : -1) * Math.sin((unfold * Math.PI) / 2),
      0,
    ]);
    const center = add(hinge, mul(v, radius));
    const points = Array.from({ length: 97 }, (_, i) =>
      add(
        center,
        mul(
          add(
            mul(u, Math.cos((i / 96) * 2 * Math.PI)),
            mul(v, Math.sin((i / 96) * 2 * Math.PI)),
          ),
          radius,
        ),
      ),
    );
    faces.push({
      id,
      points: index ? points.reverse() : points,
      normal: mul(cross(u, v), index ? -1 : 1),
    });
  }
  return faces;
};

/** Factory cube: full square plus half-side depth. Cylinder: quarter-height ovals. */
export const projectSolid = (
  point: Vec3,
  kind: "cube" | "cylinder",
  rotation: number,
): [number, number] => {
  const origin: Vec3 =
    kind === "cube" ? [0.5, 0.5, 0.5] : [0, cylinderHeight / 2, cylinderRadius];
  const p = add(
    rotate(add(point, mul(origin, -1)), [0, 1, 0], (rotation * Math.PI) / 180),
    origin,
  );
  return kind === "cube"
    ? [p[0] + p[2] * 0.5, p[1] - p[2] * 0.5]
    : [p[0], p[1] - (p[2] * cylinderHeight) / (6 * cylinderRadius)];
};
