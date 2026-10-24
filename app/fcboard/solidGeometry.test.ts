import {
  cubeFaces,
  cubeNets,
  cylinderFaces,
  cylinderHeight,
  cylinderRadius,
  projectSolid,
} from "./solidGeometry";

const distance = (a: number[], b: number[]) =>
  Math.hypot(...a.map((value, i) => value - b[i]));
const key = (p: number[]) => p.map((n) => Math.round(n * 1e7) / 1e7).join(",");

it("enumerates the eleven distinct cube nets and closes each to the same six physical faces", () => {
  expect(cubeNets).toHaveLength(11);
  const identities = new Map(
    cubeFaces(0, 0).map((face) => [
      face.id,
      face.points.map(key).sort().join(";"),
    ]),
  );
  for (let net = 0; net < cubeNets.length; net++) {
    const faces = cubeFaces(net, 0);
    expect(new Set(faces.map((face) => face.id)).size).toBe(6);
    expect(new Set(faces.flatMap((face) => face.points.map(key))).size).toBe(8);
    for (const face of faces) {
      expect(face.points.map(key).sort().join(";")).toBe(
        identities.get(face.id),
      );
    }
  }
});

it.each([0, 0.2, 0.5, 0.8, 1])(
  "preserves square faces and connected hinges at progress %s",
  (progress) => {
    cubeNets.forEach((net, index) => {
      const faces = cubeFaces(index, progress);
      faces.forEach((face, j) => {
        for (let i = 0; i < 4; i++) {
          expect(
            distance(face.points[i], face.points[(i + 1) % 4]),
          ).toBeCloseTo(1, 8);
        }
        expect(distance(face.points[0], face.points[2])).toBeCloseTo(
          Math.SQRT2,
          8,
        );
        expect(Math.hypot(...face.normal)).toBeCloseTo(1, 8);
        if (j) {
          const parent = faces[net.joints[j].parent];
          expect(
            face.points.filter((point) =>
              parent.points.some((p) => distance(p, point) < 1e-7),
            ),
          ).toHaveLength(2);
        }
      });
      if (progress === 1) {
        expect(
          faces
            .flatMap((face) => face.points)
            .every((point) => Math.abs(point[2]) < 1e-8),
        ).toBe(true);
        expect(
          new Set(
            faces.map((face) =>
              key(
                face.points.reduce<number[]>(
                  (sum, point) => sum.map((n, i) => n + point[i] / 4),
                  [0, 0, 0],
                ),
              ),
            ),
          ).size,
        ).toBe(6);
      }
    });
  },
);

it.each([0, 1, 2])(
  "unrolls a cylinder into its true circumference and two unchanged circular caps, net %s",
  (net) => {
    const folded = cylinderFaces(net, 0);
    for (const point of folded
      .filter((face) => face.id === "side")
      .flatMap((face) => face.points)) {
      expect(Math.hypot(point[0], point[2] - cylinderRadius)).toBeCloseTo(
        cylinderRadius,
        8,
      );
    }
    const flat = cylinderFaces(net, 1);
    const side = flat
      .filter((face) => face.id === "side")
      .flatMap((face) => face.points);
    expect(
      Math.max(...side.map((p) => p[0])) - Math.min(...side.map((p) => p[0])),
    ).toBeCloseTo(2 * Math.PI * cylinderRadius, 8);
    expect(
      Math.max(...side.map((p) => p[1])) - Math.min(...side.map((p) => p[1])),
    ).toBeCloseTo(cylinderHeight, 8);
    for (const cap of flat.filter((face) => face.id !== "side")) {
      expect(
        Math.max(...cap.points.map((p) => p[0])) -
          Math.min(...cap.points.map((p) => p[0])),
      ).toBeCloseTo(cylinderRadius * 2, 8);
      expect(
        Math.max(...cap.points.map((p) => p[1])) -
          Math.min(...cap.points.map((p) => p[1])),
      ).toBeCloseTo(cylinderRadius * 2, 8);
    }
    expect(
      flat.flatMap((face) => face.points).every((p) => Math.abs(p[2]) < 1e-8),
    ).toBe(true);
  },
);

it("uses the factory cube depth and cylinder oval proportions", () => {
  expect(projectSolid([0, 0, 0], "cube", 0)).toEqual([0, 0]);
  expect(projectSolid([1, 1, 1], "cube", 0)).toEqual([1.5, 0.5]);
  const faces = cylinderFaces(0, 0);
  const all = faces.flatMap((face) =>
    face.points.map((p) => projectSolid(p, "cylinder", 0)),
  );
  const height =
    Math.max(...all.map((p) => p[1])) - Math.min(...all.map((p) => p[1]));
  const top = faces
    .find((face) => face.id === "top")!
    .points.map((p) => projectSolid(p, "cylinder", 0));
  expect(
    Math.max(...top.map((p) => p[1])) - Math.min(...top.map((p) => p[1])),
  ).toBeCloseTo(height / 4, 8);
  expect(() => cubeFaces(11, 0)).toThrow();
  expect(() => cylinderFaces(3, 0)).toThrow();
  expect(() => cubeFaces(0, NaN)).toThrow();
});
