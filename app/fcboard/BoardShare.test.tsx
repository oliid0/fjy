import { t } from "@fcboard/fcboard/i18n";
import { Capacitor } from "@capacitor/core";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { exportToBlob } from "@fcboard/fcboard";

import { render } from "./test/render";

import { BoardShare } from "./BoardShare";
import { classroomCommands } from "./commands";
import { Classroom } from "./native";
import { Mail } from "./mail";
import * as boardFiles from "./boardFile";
import * as cloudTransfers from "./cloudTransfers";

vi.mock("@fcboard/fcboard", async (original) => ({
  ...(await original<typeof import("@fcboard/fcboard")>()),
  exportToBlob: vi.fn(),
}));
vi.mock("./native", () => ({
  Classroom: {
    stopShare: vi.fn(),
    sharePages: vi.fn(),
    startShare: vi.fn(),
    setSharePassword: vi.fn(),
  },
}));

vi.mock("./mail", () => ({
  Mail: { list: vi.fn(), send: vi.fn(), save: vi.fn(), remove: vi.fn() },
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens the QR with an optional password switch and changes protection without regenerating the pages or link", async () => {
  vi.mocked(exportToBlob)
    .mockClear()
    .mockResolvedValue(new Blob(["page"], { type: "image/png" }));
  vi.mocked(Classroom.startShare)
    .mockClear()
    .mockResolvedValue({ urls: ["http://board.test/shared/"] });
  vi.mocked(Classroom.setSharePassword)
    .mockClear()
    .mockResolvedValue(undefined);
  const close = await setup("board.share");
  fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.live_share.local") }),
  );
  const toggle = await screen.findByRole("switch", {
    name: t("fcboard.qr_password_protection"),
  });
  expect(toggle).not.toBeChecked();
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(Classroom.setSharePassword).toHaveBeenCalledWith({
      password: expect.stringMatching(/^\d{4}$/),
    }),
  );
  await waitFor(() => expect(toggle).toBeEnabled());
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(Classroom.setSharePassword).toHaveBeenLastCalledWith({
      password: "",
    }),
  );
  expect(Classroom.startShare).toHaveBeenCalledTimes(1);
  expect(
    vi
      .mocked(exportToBlob)
      .mock.calls.filter(([options]) => !options.exportingFrame),
  ).toHaveLength(1);
  close();
});

const setup = async (
  command: "board.mail" | "board.share" | "board.saveFile" = "board.mail",
  native = true,
) => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(native);
  vi.mocked(Classroom.stopShare).mockResolvedValue(undefined);
  vi.mocked(Mail.list).mockResolvedValue({
    accounts: [
      {
        id: "teacher",
        address: "teacher@example.test",
        username: "teacher@example.test",
        host: "smtp.example.test",
        port: 465,
        security: "tls",
        hasSecret: true,
      },
    ],
  });
  vi.mocked(Mail.send).mockClear().mockResolvedValue({
    sent: true,
    archived: false,
    messageId: "test-message",
  });
  const stop = classroomCommands.register("board.pages", "@internal", () => ({
    active: "first",
    boards: [
      { id: "first", name: "白板 1", elements: [], files: {}, view: {} },
    ],
  }));
  const view = render(<BoardShare />);
  await act(async () => {
    await classroomCommands.execute({ name: command });
  });
  return () => {
    view.unmount();
    stop();
  };
};

it("sends selected pages through the authenticated internal mailbox and reports real provider acceptance", async () => {
  vi.mocked(exportToBlob).mockResolvedValue(
    new Blob(["page"], { type: "image/png" }),
  );
  vi.mocked(Classroom.sharePages).mockResolvedValue(undefined);
  const close = await setup();
  fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "teacher@example.test",
    }),
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: t("fcboard.mailbox.recipient") }),
    { target: { value: "student@example.test" } },
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: t("fcboard.mailbox.send"),
    }),
  );
  await waitFor(() =>
    expect(Mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "teacher",
        to: "student@example.test",
        format: "pdf",
        pages: ["data:image/png;base64,cGFnZQ=="],
      }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      t("fcboard.mailbox.sent"),
    ),
  );
  expect(screen.queryByText("邮件已发送")).toBeNull();
  close();
});

const cloudConfig = () => {
  vi.stubGlobal("localStorage", { getItem: () => "https://share.test/" });
  vi.stubGlobal("sessionStorage", { getItem: () => "test-cloud-service-key" });
};
it("shares selected pages through the cloud on browsers and routes password changes and closing to the actual cloud session", async () => {
  cloudConfig();
  vi.mocked(exportToBlob)
    .mockClear()
    .mockResolvedValue(new Blob(["cloud-page"], { type: "image/png" }));
  const session = {
    url: "https://share.test/share/public-id/",
    setPassword: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
  } as unknown as cloudTransfers.CloudPageShare;
  const create = vi
    .spyOn(cloudTransfers.CloudPageShare, "start")
    .mockResolvedValue(session);
  const close = await setup("board.share", false);
  try {
    fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
    expect(
      screen.getByRole("button", { name: t("fcboard.live_share.local") }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.live_share.cloud") }),
    );
    const toggle = await screen.findByRole("switch");
    expect(create).toHaveBeenCalledWith(
      { endpoint: "https://share.test/", key: "test-cloud-service-key" },
      ["data:image/png;base64,Y2xvdWQtcGFnZQ=="],
      expect.any(AbortSignal),
    );
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(session.setPassword).toHaveBeenCalledWith(
        expect.stringMatching(/^\d{4}$/),
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.close_sharing") }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(session.end).toHaveBeenCalledTimes(1);
  } finally {
    close();
  }
});

it("uploads BZD through the original cloud/local chooser and shows its readonly extraction code only after real upload success", async () => {
  cloudConfig();
  const upload = vi
    .spyOn(cloudTransfers, "uploadCloudBzd")
    .mockRejectedValueOnce(new Error("Upload unavailable"))
    .mockResolvedValueOnce({ code: "aB12", expires: Date.now() + 86400000 });
  const close = await setup("board.saveFile");
  try {
    fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
    fireEvent.click(screen.getByRole("button", { name: "BZD" }));
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.live_share.cloud") }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Upload unavailable",
    );
    expect(
      screen.queryByLabelText(t("fcboard.cloud_transfer.code")),
    ).toBeNull();
    expect(
      screen.getByLabelText(t("fcboard.live_share.key_label")),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
    const code = await screen.findByRole("textbox", {
      name: t("fcboard.cloud_transfer.code"),
    });
    expect(code).toHaveValue("aB12");
    expect(code).toHaveAttribute("readonly");
    expect(upload.mock.calls[1][1]).toContain("<bzd>");
    expect(upload.mock.calls[1][1]).toContain('<fcboard version="1">');
    expect(
      screen.queryByRole("button", { name: t("buttons.cancel") }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  } finally {
    close();
  }
});

it("cleans up a cloud QR that finishes after its chooser closes and never shows late success", async () => {
  cloudConfig();
  vi.mocked(exportToBlob).mockResolvedValue(
    new Blob(["page"], { type: "image/png" }),
  );
  let finish!: (session: cloudTransfers.CloudPageShare) => void;
  const create = vi
    .spyOn(cloudTransfers.CloudPageShare, "start")
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const close = await setup("board.share", false);
  try {
    fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.live_share.cloud") }),
    );
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: t("buttons.close") }));
    expect(create.mock.calls[0][2]?.aborted).toBe(true);
    const end = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      finish({
        url: "https://share.test/share/late/",
        end,
      } as unknown as cloudTransfers.CloudPageShare);
    });
    expect(end).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  } finally {
    close();
  }
});

it("requires selected pages and saves PDF through the original file browser instead of the attachment chooser", async () => {
  const save = vi.spyOn(boardFiles, "savePageFiles").mockResolvedValue(true);
  vi.mocked(exportToBlob).mockResolvedValue(
    new Blob(["page"], { type: "image/jpeg" }),
  );
  vi.mocked(Classroom.sharePages).mockClear().mockResolvedValue(undefined);
  const close = await setup("board.saveFile");
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.select_none") }),
  );
  expect(
    screen.getByRole("button", { name: t("buttons.confirm") }),
  ).toBeDisabled();
  expect(Classroom.sharePages).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: t("labels.selectAll") }));
  fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
  fireEvent.click(screen.getByRole("button", { name: /^PDF$/ }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      [{ page: 1, blob: expect.any(Blob) }],
      "Fcboard",
      "pdf",
      expect.any(AbortSignal),
    ),
  );
  expect(Classroom.sharePages).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent(t("fcboard.file_saved"));
  close();
});

it("updates full-page export dimensions when the current canvas rotates while the page chooser is open", async () => {
  const save = vi.spyOn(boardFiles, "savePageFiles").mockResolvedValue(true);
  vi.mocked(exportToBlob)
    .mockClear()
    .mockResolvedValue(new Blob(["page"], { type: "image/jpeg" }));
  let canvasSize = { width: 1280, height: 720, pixelRatio: 1 };
  const stop = classroomCommands.context("boards", () => ({ canvasSize }));
  const close = await setup("board.saveFile");
  try {
    act(() => {
      canvasSize = { width: 390, height: 844, pixelRatio: 3 };
      classroomCommands.changed("boards");
    });
    fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
    fireEvent.click(screen.getByRole("button", { name: /^PDF$/ }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const options = vi.mocked(exportToBlob).mock.calls.at(-1)![0];
    expect(options.quality).toBe(1);
    expect(options.exportingFrame).toMatchObject({ width: 390, height: 844 });
    expect(options.getDimensions!(390, 844)).toMatchObject({
      width: 1170,
      height: 2532,
    });
  } finally {
    close();
    stop();
  }
});

it("keeps JPG cancellation and actual write failure distinct from a successful file save", async () => {
  const save = vi
    .spyOn(boardFiles, "savePageFiles")
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(new Error("Storage full"));
  vi.mocked(exportToBlob).mockResolvedValue(
    new Blob(["page"], { type: "image/jpeg" }),
  );
  const close = await setup("board.saveFile");
  fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
  const jpg = screen.getByRole("button", {
    name: t("fcboard.download_selected_pages"),
  });
  fireEvent.click(jpg);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(jpg).toBeEnabled());
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.click(jpg);
  expect(await screen.findByRole("alert")).toHaveTextContent("Storage full");
  expect(screen.queryByText(t("fcboard.file_saved"))).toBeNull();
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
  fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "teacher@example.test",
    }),
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: t("fcboard.mailbox.recipient") }),
    { target: { value: "student@example.test" } },
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: t("fcboard.mailbox.send"),
    }),
  );
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.close_sharing") }),
    );
  });
  await act(async () => {
    finish(new Blob(["page"], { type: "image/png" }));
  });
  expect(Mail.send).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  close();
});
