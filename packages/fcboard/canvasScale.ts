/** Three live canvas layers must fit a bounded backing-store budget on ARM WebViews.
 * Pointer coordinates and scene geometry remain in CSS pixels. */
export const canvasScale = (
  width: number,
  height: number,
  ratio = window.devicePixelRatio || 1,
  android = /Android/i.test(navigator.userAgent),
) => {
  const pixels = Math.max(1, width) * Math.max(1, height);
  const budget = android ? 2_097_152 : 16_777_216;
  return Number.isFinite(pixels) && Number.isFinite(ratio) && ratio > 0
    ? Math.min(ratio, Math.sqrt(budget / pixels))
    : 1;
};
