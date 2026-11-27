import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { t } from "@fcboard/fcboard/i18n";

import { CloudFiles } from "./CloudFiles";
import { classroomCommands } from "./commands";
import { render } from "./test/render";

it("keeps cloud retrieval errors editable for retry without requiring an upload key", async () => {
  const open = vi.fn().mockResolvedValue({ pages: 1 });
  const stop = classroomCommands.register("board.open", "@internal", open);
  const view = render(<CloudFiles />);
  try {
    await act(() => classroomCommands.execute({ name: "files.cloud" }));
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.retrieve_cloud_file") }),
    );
    const input = await screen.findByRole("textbox", {
      name: t("fcboard.cloud_transfer.code"),
    });
    const confirm = screen.getByRole("button", { name: t("buttons.confirm") });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: "Ab12" } });
    open.mockRejectedValueOnce(new Error("Incorrect extraction code"));
    fireEvent.click(confirm);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Incorrect extraction code",
    );
    expect(input).toHaveValue("Ab12");
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: "Cd34" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(open).toHaveBeenLastCalledWith(
      expect.objectContaining({
        code: "Cd34",
        endpoint: "https://101.96.199.53/",
        signal: expect.any(AbortSignal),
      }),
    );
  } finally {
    view.unmount();
    stop();
  }
});

it("aborts an in-progress cloud read when the code dialog closes and suppresses a late error", async () => {
  let reject!: (error: Error) => void;
  let signal!: AbortSignal;
  const stop = classroomCommands.register("board.open", "@internal", (args) => {
    signal = args.signal as AbortSignal;
    return new Promise((_, fail) => {
      reject = fail;
    });
  });
  const view = render(<CloudFiles />);
  try {
    await act(() => classroomCommands.execute({ name: "files.cloud" }));
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.retrieve_cloud_file") }),
    );
    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "Ab12" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
    await waitFor(() => expect(signal).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: t("buttons.close") }));
    expect(signal.aborted).toBe(true);
    await act(async () => {
      reject(new Error("Late network error"));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  } finally {
    view.unmount();
    stop();
  }
});
