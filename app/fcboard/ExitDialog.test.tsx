import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { t } from "@fcboard/fcboard/i18n";

import { render } from "./test/render";
import { ExitDialog } from "./ExitDialog";

it("stays open when saving is cancelled or fails and closes only after actual success", async () => {
  const close = vi.fn();
  const exit = vi
    .fn()
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(new Error("文件无法写入"))
    .mockResolvedValueOnce(true);
  render(<ExitDialog onExit={exit} onClose={close} />);
  const save = screen.getByRole("button", { name: t("fcboard.save_and_exit") });
  fireEvent.click(save);
  await waitFor(() => expect(save).toBeEnabled());
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(save);
  expect(await screen.findByRole("alert")).toHaveTextContent("文件无法写入");
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(save);
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(exit).toHaveBeenNthCalledWith(3, true, expect.any(AbortSignal));
});

it.each(["escape", "close", "cancel"] as const)(
  "allows %s while exit is pending and ignores late success",
  async (method) => {
    let finish!: (value: boolean) => void;
    const exit = vi.fn().mockReturnValue(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    );
    const close = vi.fn();
    render(<ExitDialog onExit={exit} onClose={close} />);
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.exit_without_saving") }),
    );
    expect(exit).toHaveBeenCalledWith(false, expect.any(AbortSignal));
    const signal = exit.mock.calls[0][1] as AbortSignal;
    if (method === "escape") {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    } else {
      fireEvent.click(
        screen.getByRole("button", {
          name: t(method === "close" ? "buttons.close" : "buttons.cancel"),
        }),
      );
    }
    expect(close).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(true);
    await act(async () => finish(true));
    expect(close).toHaveBeenCalledTimes(1);
  },
);
