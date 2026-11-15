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

/** Saturation follows the reference palette's white center and full-color rim. */
export const spotlightColor = (x: number, y: number) => {
  const hue = ((Math.atan2(-y, x) * 180) / Math.PI + 360) % 360;
  const saturation = Math.min(1, Math.hypot(x, y));
  const chroma = saturation;
  const offset = 1 - chroma;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const rgb =
    hue < 60
      ? [chroma, second, 0]
      : hue < 120
      ? [second, chroma, 0]
      : hue < 180
      ? [0, chroma, second]
      : hue < 240
      ? [0, second, chroma]
      : hue < 300
      ? [second, 0, chroma]
      : [chroma, 0, second];
  return `#${rgb
    .map((channel) =>
      Math.round((channel + offset) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
};
