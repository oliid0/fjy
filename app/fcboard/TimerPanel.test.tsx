import { act, fireEvent, screen } from "@testing-library/react";

import { TimerPanel } from "./TimerPanel";
import { classroomCommands } from "./commands";
import { render } from "./test/render";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("runs an independent countdown, excludes paused time and keeps full-screen controls working", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", undefined);
  const view = render(<TimerPanel />);
  try {
    await act(async () => {
      await classroomCommands.execute({
        name: "tools.timer",
        args: { seconds: 10, start: true },
      });
    });
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByLabelText("剩余时间")).toHaveTextContent("00:00:07");
    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    act(() => vi.advanceTimersByTime(9000));
    expect(screen.getByLabelText("剩余时间")).toHaveTextContent("00:00:07");
    fireEvent.click(screen.getByRole("button", { name: "全屏" }));
    expect(screen.getByRole("region", { name: "计时器" })).toHaveClass(
      "fc-timer-full",
    );
    fireEvent.click(screen.getByRole("button", { name: "开始 / 继续" }));
    act(() => vi.advanceTimersByTime(7000));
    expect(screen.getByText("倒计时结束")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    expect(screen.getByLabelText("剩余时间")).toHaveTextContent("00:00:10");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("region", { name: "计时器" })).toBeNull();
  } finally {
    view.unmount();
  }
});
