import { act, render, screen } from "@testing-library/react";

import { TransientMessage } from "./TransientMessage";

it("dismisses feedback automatically and gives a new message its own lifetime", () => {
  vi.useFakeTimers();
  try {
    const { rerender, unmount } = render(
      <TransientMessage message="first error" role="alert" />,
    );
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByRole("alert")).toHaveTextContent("first error");
    rerender(<TransientMessage message="second error" role="alert" />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("alert")).toHaveTextContent("second error");
    act(() => vi.advanceTimersByTime(3500));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Hiding feedback must not clear a failed operation's state.
    rerender(<TransientMessage message="second error" role="alert" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();
  } finally {
    vi.useRealTimers();
  }
});
