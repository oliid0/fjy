/** Convert letterboxed browser coordinates to the current decoded device resolution. */
export const screenPoint = (
  x: number,
  y: number,
  rect: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
) => {
  const scale = Math.min(rect.width / width, rect.height / height);
  return {
    pointerX: Math.max(
      0,
      Math.min(
        width - 1,
        Math.round((x - rect.left - (rect.width - width * scale) / 2) / scale),
      ),
    ),
    pointerY: Math.max(
      0,
      Math.min(
        height - 1,
        Math.round((y - rect.top - (rect.height - height * scale) / 2) / scale),
      ),
    ),
    videoWidth: width,
    videoHeight: height,
  };
};
