import { act, fireEvent, render, screen } from "@testing-library/react";

import { Toast } from "../components/Toast";

it("automatically closes even an old infinite toast while the pointer rests on it", () => {
  vi.useFakeTimers();
  try {
    const close = vi.fn();
    const { unmount } = render(
      <Toast message="message" duration={Infinity} onClose={close} />,
    );
    fireEvent.mouseEnter(screen.getByRole("status"));
    act(() => vi.advanceTimersByTime(3000));
    expect(close).toHaveBeenCalledTimes(1);
    unmount();
  } finally {
    vi.useRealTimers();
  }
});
