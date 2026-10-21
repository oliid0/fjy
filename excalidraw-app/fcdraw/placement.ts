export type ContentRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** Pack new content near its question without covering existing ink or the toolbar. */
export const findContentPosition = (
  preferred: { x: number; y: number },
  size: { width: number; height: number },
  viewport: ContentRect,
  obstacles: readonly ContentRect[],
  gap: number,
) => {
  const valid = obstacles.filter((rect) =>
    Object.values(rect).every(Number.isFinite),
  );
  const fits = (point: typeof preferred) =>
    point.x >= viewport.left &&
    point.y >= viewport.top &&
    point.x + size.width <= viewport.right &&
    point.y + size.height <= viewport.bottom;
  const collision = (point: typeof preferred) =>
    valid.find(
      (rect) =>
        point.x < rect.right + gap &&
        point.x + size.width > rect.left - gap &&
        point.y < rect.bottom + gap &&
        point.y + size.height > rect.top - gap,
    );
  const clamp = (point: typeof preferred) => ({
    x: Math.max(viewport.left, Math.min(viewport.right - size.width, point.x)),
    y: Math.max(viewport.top, Math.min(viewport.bottom - size.height, point.y)),
  });
  const pending = [clamp(preferred)];
  const visited = new Set<string>();
  const distance = (point: typeof preferred) =>
    Math.hypot(point.x - preferred.x, point.y - preferred.y);
  for (let attempt = 0; pending.length && attempt < 512; attempt++) {
    pending.sort((a, b) => distance(a) - distance(b));
    const point = pending.shift()!;
    const key = `${point.x}:${point.y}`;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);
    if (!fits(point)) {
      continue;
    }
    const hit = collision(point);
    if (!hit) {
      return point;
    }
    pending.push(
      { x: hit.right + gap, y: point.y },
      { x: point.x, y: hit.bottom + gap },
      { x: hit.left - gap - size.width, y: point.y },
      { x: point.x, y: hit.top - gap - size.height },
    );
  }
  // A full viewport must not force an answer over the question. The board is infinite.
  const outside = {
    x: clamp(preferred).x,
    y: Math.max(preferred.y, viewport.bottom + gap),
  };
  let hit = collision(outside);
  while (hit) {
    outside.y = hit.bottom + gap;
    hit = collision(outside);
  }
  return outside;
};
