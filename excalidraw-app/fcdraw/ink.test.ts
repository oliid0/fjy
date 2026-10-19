import { Capacitor } from "@capacitor/core";
import { act, renderHook, waitFor } from "@testing-library/react";

import { cssInkProfile, useDeviceInkProfile } from "./ink";
import { Classroom } from "./native";

vi.mock("./native", () => ({ Classroom: { getInkProfile: vi.fn() } }));

describe("factory ink calibration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("recalibrates after density changes without rereading the device or retaining listeners", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    vi.mocked(Classroom.getInkProfile).mockResolvedValue({
      hardPenWidth: 4,
      brushPenWidth: 15,
      eraserSize: 150,
      palmThreshold: 80,
    });
    vi.stubGlobal("devicePixelRatio", 3);
    const media: EventTarget[] = [];
    const queries = vi.spyOn(window, "matchMedia").mockImplementation(() => {
      const target = new EventTarget();
      media.push(target);
      return target as MediaQueryList;
    });
    const { result, unmount } = renderHook(useDeviceInkProfile);
    await waitFor(() => expect(result.current?.hardPenWidth).toBe(4 / 3));
    vi.stubGlobal("devicePixelRatio", 2);
    act(() => media[0].dispatchEvent(new Event("change")));
    expect(result.current?.hardPenWidth).toBe(2);
    expect(result.current?.palmThreshold).toBe(40);
    expect(queries).toHaveBeenLastCalledWith("(resolution: 2dppx)");
    expect(Classroom.getInkProfile).toHaveBeenCalledTimes(1);
    unmount();
    const count = queries.mock.calls.length;
    vi.stubGlobal("devicePixelRatio", 1);
    media.at(-1)!.dispatchEvent(new Event("change"));
    window.dispatchEvent(new Event("resize"));
    expect(queries).toHaveBeenCalledTimes(count);
  });
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
