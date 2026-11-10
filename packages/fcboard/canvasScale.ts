/** Keep 4K ink at display resolution, with a bounded budget for the three layers.
 * At 8M pixels each, Android's RGBA backing stores total at most 96 MiB.
 * Pointer coordinates and scene geometry remain in CSS pixels. */
export const canvasScale = (
  width: number,
  height: number,
  ratio = window.devicePixelRatio || 1,
  android = /Android/i.test(navigator.userAgent),
) => {
  const pixels = Math.max(1, width) * Math.max(1, height);
  const budget = android ? 8_388_608 : 16_777_216;
  return Number.isFinite(pixels) && Number.isFinite(ratio) && ratio > 0
    ? Math.min(ratio, Math.sqrt(budget / pixels))
    : 1;
};
