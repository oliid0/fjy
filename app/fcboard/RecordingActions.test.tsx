import { Capacitor } from "@capacitor/core";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { t } from "@excalidraw/excalidraw/i18n";

import { render } from "./test/render";
import { RecordingActions } from "./RecordingActions";
import * as exporting from "./recordingExport";

import type { Recording } from "./recording";

const recording: Recording = {
  id: "session",
  created: 0,
  duration: 10,
  mode: "screen",
  blob: new Blob(["video"], { type: "video/webm" }),
  transcript: [{ time: 2, text: "F=ma" }],
  summary: "A change in force changes acceleration.",
};
afterEach(() => vi.restoreAllMocks());

it("saves and shares one complete package, then revokes its QR session on dismissal", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  const session = {
    save: vi.fn().mockResolvedValue({ saved: true }),
    share: vi
      .fn()
      .mockResolvedValue({ urls: ["http://192.168.1.10:1234/token/"] }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const prepare = vi
    .spyOn(exporting, "prepareRecordingPackage")
    .mockResolvedValue(session);
  render(<RecordingActions recording={recording} />);
  fireEvent.click(screen.getByRole("button", { name: t("buttons.saveAs") }));
  await waitFor(() => expect(session.save).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: t("fcboard.qr_share") }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.qr_share") }));
  await waitFor(() =>
    expect(
      screen.getByRole("dialog", { name: t("fcboard.qr_share") }),
    ).toBeVisible(),
  );
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("link")).toHaveAttribute(
    "href",
    "http://192.168.1.10:1234/token/",
  );
  fireEvent.click(screen.getByRole("button", { name: t("buttons.close") }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(session.close).toHaveBeenCalledTimes(1);
});

it("does not claim an incomplete transcript or summary can be exported as the three-file package", () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  render(<RecordingActions recording={{ ...recording, summary: "" }} />);
  expect(
    screen.getByRole("button", { name: t("buttons.saveAs") }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: t("fcboard.qr_share") }),
  ).toBeDisabled();
});

it("closes a late package when its recording panel is removed during preparation", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  let finish!: (
    session: Awaited<ReturnType<typeof exporting.prepareRecordingPackage>>,
  ) => void;
  vi.spyOn(exporting, "prepareRecordingPackage").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const session = {
    save: vi.fn(),
    share: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const view = render(<RecordingActions recording={recording} />);
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.qr_share") }));
  view.unmount();
  await act(async () => {
    finish(session);
  });
  expect(session.close).toHaveBeenCalledTimes(1);
  expect(session.share).not.toHaveBeenCalled();
});

it("exposes all three actual browser downloads and keeps their URLs alive only while shown", () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
  let sequence = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(
    () => `blob:recording-${sequence++}`,
  );
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const view = render(<RecordingActions recording={recording} />);
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: t("buttons.export") }));
  expect(
    screen
      .getAllByRole("menuitem")
      .map((link) => link.getAttribute("download")),
  ).toEqual([
    "Fcboard-session.webm",
    "Fcboard-session-transcript.txt",
    "Fcboard-session-summary.md",
  ]);
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(
    screen.getByRole("button", { name: t("buttons.export") }),
  ).toHaveAttribute("aria-expanded", "false");
  view.unmount();
  expect(revoke).toHaveBeenCalledTimes(3);
});
