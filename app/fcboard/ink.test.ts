import { Capacitor } from "@capacitor/core";
import { act, renderHook } from "@testing-library/react";

import { useDeviceInkProfile } from "./ink";
describe("display density ink calibration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("recalibrates after density changes without rereading the device or retaining listeners", () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    vi.stubGlobal("devicePixelRatio", 3);
    const media: EventTarget[] = [];
    const queries = vi.spyOn(window, "matchMedia").mockImplementation(() => {
      const target = new EventTarget();
      media.push(target);
      return target as MediaQueryList;
    });
    const { result, unmount } = renderHook(useDeviceInkProfile);
    expect(result.current?.hardPenWidth).toBe(4 / 3);
    vi.stubGlobal("devicePixelRatio", 2);
    act(() => media[0].dispatchEvent(new Event("change")));
    expect(result.current?.hardPenWidth).toBe(2);
    expect(result.current?.palmThreshold).toBe(36);
    expect(queries).toHaveBeenLastCalledWith("(resolution: 2dppx)");
    unmount();
    const count = queries.mock.calls.length;
    vi.stubGlobal("devicePixelRatio", 1);
    media.at(-1)!.dispatchEvent(new Event("change"));
    window.dispatchEvent(new Event("resize"));
    expect(queries).toHaveBeenCalledTimes(count);
  });
  it("uses safe physical defaults when density is unavailable", () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    vi.stubGlobal("devicePixelRatio", 0);
    const { result } = renderHook(useDeviceInkProfile);
    expect(result.current).toEqual({
      hardPenWidth: 4,
      brushPenWidth: 15,
      eraserSize: 150,
      palmThreshold: 36,
      penWidthMax: 40,
    });
  });
});
