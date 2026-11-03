import { act, fireEvent, screen } from "@testing-library/react";
import { getNormalizedZoom } from "@fcboard/fcboard/scene/normalize";
import { getDefaultAppState } from "@fcboard/fcboard/appState";

import type { ViewportGesture } from "@fcboard/fcboard/types";

import { BoardZoom } from "./BoardZoom";
import { sceneAPI } from "./test/scene";
import { render } from "./test/render";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("shows the original temporary percentage/reset only during gestures and preserves the last anchor on reset", async () => {
  vi.useFakeTimers();
  const api = sceneAPI();
  const state = {
    ...getDefaultAppState(),
    ...api.getAppState(),
    offsetLeft: 0,
    offsetTop: 0,
    zoom: { value: getNormalizedZoom(1.5) },
  };
  api.getAppState = () => state;
  let receive!: (value: ViewportGesture) => void;
  const release = vi.fn();
  api.onViewportGesture = (callback) => {
    receive = callback;
    return release;
  };
  api.onChange = () => () => {};
  const view = render(<BoardZoom api={api} />);
  try {
    expect(
      screen.queryByRole("group", { name: "白板缩放" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "放大白板" }),
    ).not.toBeInTheDocument();
    const gesture: ViewportGesture = {
      active: true,
      zoom: 1.5,
      center: { x: 300, y: 200 },
      pointers: [
        { x: 200, y: 200 },
        { x: 400, y: 200 },
      ],
    };
    await act(async () => {
      receive(gesture);
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(screen.getByText("缩放150%")).toBeVisible();
    expect(view.container.querySelectorAll("circle")).toHaveLength(2);
    await act(async () => {
      receive({ ...gesture, active: false, pointers: [] });
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(view.container.querySelector("circle")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(967);
    });
    expect(screen.getByText("缩放150%")).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(
      screen.queryByRole("group", { name: "白板缩放" }),
    ).not.toBeInTheDocument();
    await act(async () => {
      receive(gesture);
      await vi.advanceTimersByTimeAsync(16);
    });
    fireEvent.click(screen.getByRole("button", { name: "恢复白板100%" }));
    expect(api.updateScene).toHaveBeenCalledWith({
      appState: {
        zoom: { value: 1 },
        scrollX: 100,
        scrollY: expect.any(Number),
        currentItemStrokeWidth: state.currentItemStrokeWidth / 1.5,
      },
    });
    expect(
      vi.mocked(api.updateScene).mock.calls[0][0].appState?.scrollY,
    ).toBeCloseTo(200 / 3, 6);
    expect(
      screen.queryByRole("group", { name: "白板缩放" }),
    ).not.toBeInTheDocument();
  } finally {
    view.unmount();
  }
  expect(release).toHaveBeenCalledTimes(1);
});
