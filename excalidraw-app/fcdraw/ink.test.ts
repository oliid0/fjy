import { cssInkProfile } from "./ink";

describe("factory ink calibration", () => {
  it("keeps factory physical widths across screen densities and converts the vendor threshold once", () => {
    for (const dpr of [1, 2, 3]) {
      const profile = cssInkProfile(
        {
          hardPenWidth: 4,
          brushPenWidth: 15,
          eraserSize: 150,
          palmThreshold: 80,
        },
        dpr,
      )!;
      expect(profile.hardPenWidth * dpr).toBe(4);
      expect(profile.brushPenWidth * dpr).toBe(15);
      expect(profile.eraserSize * dpr).toBe(150);
      expect(profile.palmThreshold * dpr).toBe(80);
    }
  });
  it("keeps manual palm calibration available when the vendor provider is absent", () => {
    expect(
      cssInkProfile({ hardPenWidth: NaN, brushPenWidth: -1, eraserSize: 0 }, 3),
    ).toEqual({
      hardPenWidth: 4 / 3,
      brushPenWidth: 5,
      eraserSize: 50,
      palmThreshold: 36,
    });
  });
});
