/** MarkSizeView's hdpi assets and raw-pixel offsets, expressed in CSS/dp units. */
export const spotlightMenu = (
  x: number,
  radius: number,
  width: number,
  height: number,
) => {
  const left = x - radius;
  const right = x + radius;
  const flipped = right > width * 0.75;
  return {
    x: Math.max(8, Math.min(width - 58, flipped ? left - 85 : right + 35)),
    y: Math.max(8, Math.min(height - 182, height / 2 - 260 / 3)),
    resizeX: Math.max(
      8,
      Math.min(width - 52, flipped ? left - 155 / 3 : right + 15),
    ),
    resizeY: Math.max(8, Math.min(height - 52, height / 2 + 295 / 3)),
    flipped,
  };
};

export const keepSpotlightVisible = <
  T extends { x: number; y: number; radius: number; halfHeight: number },
>(
  state: T,
  width: number,
  height: number,
): T => {
  const overflow = (size: number) => Math.min(size / 3, Math.max(0, size - 80));
  const horizontal = overflow(state.radius * 2);
  const vertical = overflow(state.halfHeight * 2);
  return {
    ...state,
    x: Math.max(
      state.radius - horizontal,
      Math.min(width - state.radius + horizontal, state.x),
    ),
    y: Math.max(
      state.halfHeight - vertical,
      Math.min(height - state.halfHeight + vertical, state.y),
    ),
  };
};

/** The original fivePoints path is a closed pentagram, not a ten-vertex approximation. */
export const spotlightStar = (
  radius: number,
  halfHeight: number,
  outer: boolean,
) => {
  const size = radius * 2 + (outer ? 20 : -20);
  const top = -halfHeight + (outer ? 0 : 20);
  const horizontal = size * Math.sin(Math.PI / 10);
  const bottom = top + size * Math.cos(Math.PI / 10);
  const middle = top + Math.sqrt((horizontal * 2) ** 2 - (size / 2) ** 2);
  return [
    [0, top],
    [-horizontal, bottom],
    [size / 2, middle],
    [-size / 2, middle],
    [horizontal, bottom],
    [0, top],
  ]
    .map((point) => point.join(","))
    .join(" ");
};
