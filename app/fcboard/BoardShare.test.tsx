import { t } from "@excalidraw/excalidraw/i18n";
import { Capacitor } from "@capacitor/core";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { exportToBlob } from "@excalidraw/excalidraw";

import { render } from "./test/render";

import { BoardShare } from "./BoardShare";
import { classroomCommands } from "./commands";
import { Classroom } from "./native";

vi.mock("@excalidraw/excalidraw", async (original) => ({
  ...(await original<typeof import("@excalidraw/excalidraw")>()),
  exportToBlob: vi.fn(),
}));
vi.mock("./native", () => ({
  Classroom: { stopShare: vi.fn(), sharePages: vi.fn() },
}));

afterEach(() => vi.restoreAllMocks());

const setup = async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.mocked(Classroom.stopShare).mockResolvedValue(undefined);
  const stop = classroomCommands.register("board.pages", "@internal", () => ({
    active: "first",
    boards: [
      { id: "first", name: "白板 1", elements: [], files: {}, view: {} },
    ],
  }));
  const view = render(<BoardShare />);
  await act(async () => {
    await classroomCommands.execute({ name: "board.mail" });
  });
  return () => {
    view.unmount();
    stop();
  };
};

it("opens a page attachment composer through the same menu and AI command, without claiming delivery", async () => {
  vi.mocked(exportToBlob).mockResolvedValue(
    new Blob(["page"], { type: "image/png" }),
  );
  vi.mocked(Classroom.sharePages).mockResolvedValue(undefined);
  const close = await setup();
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.open_email_share_window") }),
  );
  await waitFor(() =>
    expect(Classroom.sharePages).toHaveBeenCalledWith({
      pages: ["data:image/png;base64,cGFnZQ=="],
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      t("fcboard.choose_an_app_in_the_system_share_window_and_confirm_sending"),
    ),
  );
  expect(screen.queryByText("邮件已发送")).toBeNull();
  close();
});

it("does not launch the composer when the page chooser closes during export", async () => {
  let finish!: (blob: Blob) => void;
  vi.mocked(exportToBlob).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  vi.mocked(Classroom.sharePages).mockClear();
  const close = await setup();
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.open_email_share_window") }),
  );
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.close_sharing") }),
    );
  });
  await act(async () => {
    finish(new Blob(["page"], { type: "image/png" }));
  });
  expect(Classroom.sharePages).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  close();
});
