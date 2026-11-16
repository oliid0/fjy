export type ContentRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** Pack new content near its question without covering existing ink or the toolbar. */
export const findVisibleContentPosition = (
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
  // The native eraser uses the same spatial-bucket principle. Placement may
  // test hundreds of candidates; unrelated old strokes need no repeated scan.
  const columns = 16;
  const rows = 16;
  const cellWidth = Math.max(1, (viewport.right - viewport.left) / columns);
  const cellHeight = Math.max(1, (viewport.bottom - viewport.top) / rows);
  const range = (rect: ContentRect) => ({
    left: Math.max(
      0,
      Math.min(
        columns - 1,
        Math.floor((rect.left - viewport.left) / cellWidth),
      ),
    ),
    right: Math.max(
      0,
      Math.min(
        columns - 1,
        Math.floor((rect.right - viewport.left) / cellWidth),
      ),
    ),
    top: Math.max(
      0,
      Math.min(rows - 1, Math.floor((rect.top - viewport.top) / cellHeight)),
    ),
    bottom: Math.max(
      0,
      Math.min(rows - 1, Math.floor((rect.bottom - viewport.top) / cellHeight)),
    ),
  });
  const cells: number[][] = Array.from({ length: columns * rows }, () => []);
  valid.forEach((rect, index) => {
    const box = {
      left: rect.left - gap,
      top: rect.top - gap,
      right: rect.right + gap,
      bottom: rect.bottom + gap,
    };
    if (
      box.right < viewport.left ||
      box.left > viewport.right ||
      box.bottom < viewport.top ||
      box.top > viewport.bottom
    ) {
      return;
    }
    const area = range(box);
    for (let y = area.top; y <= area.bottom; y++) {
      for (let x = area.left; x <= area.right; x++) {
        cells[y * columns + x].push(index);
      }
    }
  });
  const collision = (point: typeof preferred) => {
    const area = range({
      left: point.x,
      top: point.y,
      right: point.x + size.width,
      bottom: point.y + size.height,
    });
    const seen = new Set<number>();
    let first = valid.length;
    for (let y = area.top; y <= area.bottom; y++) {
      for (let x = area.left; x <= area.right; x++) {
        for (const index of cells[y * columns + x]) {
          if (index >= first || seen.has(index)) {
            continue;
          }
          seen.add(index);
          const rect = valid[index];
          if (
            point.x < rect.right + gap &&
            point.x + size.width > rect.left - gap &&
            point.y < rect.bottom + gap &&
            point.y + size.height > rect.top - gap
          ) {
            first = index;
          }
        }
      }
    }
    // Retain original obstacle order so the packing/search behavior is stable.
    return valid[first];
  };
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
  return undefined;
};

export const findContentPosition = (
  preferred: { x: number; y: number },
  size: { width: number; height: number },
  viewport: ContentRect,
  obstacles: readonly ContentRect[],
  gap: number,
) => {
  const visible = findVisibleContentPosition(
    preferred,
    size,
    viewport,
    obstacles,
    gap,
  );
  if (visible) {
    return visible;
  }
  // Legacy object placement: callers that can reflow use the visible-only API.
  const valid = obstacles.filter((rect) =>
    Object.values(rect).every(Number.isFinite),
  );
  const outside = {
    x: Math.max(
      viewport.left,
      Math.min(viewport.right - size.width, preferred.x),
    ),
    y: Math.max(preferred.y, viewport.bottom + gap),
  };
  const collision = (point: typeof preferred) =>
    valid.find(
      (rect) =>
        point.x < rect.right + gap &&
        point.x + size.width > rect.left - gap &&
        point.y < rect.bottom + gap &&
        point.y + size.height > rect.top - gap,
    );
  let hit = collision(outside);
  while (hit) {
    outside.y = hit.bottom + gap;
    hit = collision(outside);
  }
  return outside;
};
