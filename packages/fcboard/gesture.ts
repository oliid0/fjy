import type { PointerCoords } from "./types";

export const getCenter = (pointers: Map<number, PointerCoords>) => {
  const allCoords = Array.from(pointers.values());
  return {
    x: sum(allCoords, (coords) => coords.x) / allCoords.length,
    y: sum(allCoords, (coords) => coords.y) / allCoords.length,
  };
};

export const getDistance = ([a, b]: readonly PointerCoords[]) =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** HCanvas.centerPointBetweenArea: sum distances from the first contact.
 * Despite the APK's name, this is a length (no square-root area ratio).
 * Its center is the midpoint of the first and last contacts in pointer order.
 */
export const getFactoryGesture = (pointers: Map<number, PointerCoords>) => {
  const points = Array.from(pointers.values());
  if (points.length < 2) {
    return null;
  }
  const first = points[0];
  const last = points[points.length - 1];
  const center = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
  const distance = points
    .slice(1)
    .reduce(
      (sum, point) => sum + Math.hypot(point.x - first.x, point.y - first.y),
      0,
    );
  return [center.x, center.y, distance].every(Number.isFinite)
    ? { center, distance }
    : null;
};

const sum = <T>(array: readonly T[], mapper: (item: T) => number): number =>
  array.reduce((acc, item) => acc + mapper(item), 0);
