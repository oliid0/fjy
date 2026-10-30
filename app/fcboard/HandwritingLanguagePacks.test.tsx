import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { t } from "@fcboard/fcboard/i18n";

import { LanguagePacks } from "./HandwritingLanguagePacks";
import { render } from "./test/render";
import { openLanguagePacks } from "./languagePacks";

import type { HandwritingPacks } from "./languagePacks";

const backend = vi.hoisted(() => ({
  listPacks: vi.fn(),
  downloadPack: vi.fn(),
  deletePack: vi.fn(),
  addListener: vi.fn(),
  remove: vi.fn(),
  native: vi.fn(() => true),
}));
vi.mock("./digitalInk", () => ({
  digitalInkEngine: backend,
  hasDigitalInk: backend.native,
  currentTextInkLanguage: () => "en-US",
}));
const initial = (): HandwritingPacks => ({
  revision: 1,
  packs: [
    { tag: "zh-Hani-CN", bundled: true, state: 1 },
    { tag: "de-DE", bundled: false, state: 2 },
    { tag: "en-US", bundled: true, state: 1 },
  ],
});
beforeEach(() => {
  vi.clearAllMocks();
  backend.native.mockReturnValue(true);
  backend.listPacks.mockResolvedValue(initial());
  backend.addListener.mockResolvedValue({ remove: backend.remove });
});

it("shows actual model states, downloads and confirms deletion while protecting bundled models", async () => {
  render(<LanguagePacks />);
  expect(backend.listPacks).not.toHaveBeenCalled();
  act(() => {
    openLanguagePacks();
  });
  const download = await screen.findByRole("button", {
    name: `German ${t("fcboard.languagePacks.download")}`,
  });
  expect(document.querySelector(".fc-language-pack-row")).toHaveAttribute(
    "data-pack",
    "en-US",
  );
  expect(
    screen.getByRole("button", {
      name: `English ${t("fcboard.languagePacks.builtin")}`,
    }),
  ).toBeDisabled();
  let finish!: (value: HandwritingPacks) => void;
  backend.downloadPack.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(download);
  expect(backend.downloadPack).toHaveBeenCalledWith({ tag: "de-DE" });
  expect(
    screen.getByRole("button", {
      name: `German ${t("fcboard.languagePacks.waiting")}`,
    }),
  ).toBeDisabled();
  act(() =>
    backend.addListener.mock.calls[0][1]({
      ...initial(),
      revision: 2,
      packs: initial().packs.map((pack) =>
        pack.tag === "de-DE" ? { ...pack, state: 3 } : pack,
      ),
    }),
  );
  expect(screen.getByRole("progressbar")).toBeVisible();
  const installed: HandwritingPacks = {
    revision: 3,
    packs: initial().packs.map((pack) =>
      pack.tag === "de-DE" ? { ...pack, state: 4 } : pack,
    ),
  };
  await act(async () => finish(installed));
  const remove = screen.getByRole("button", {
    name: `German ${t("fcboard.languagePacks.delete")}`,
  });
  fireEvent.click(remove);
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.languagePacks.cancel") }),
  );
  expect(backend.deletePack).not.toHaveBeenCalled();
  fireEvent.click(remove);
  backend.deletePack.mockResolvedValue({ ...initial(), revision: 4 });
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.languagePacks.delete") }),
  );
  await screen.findByRole("button", {
    name: `German ${t("fcboard.languagePacks.download")}`,
  });
  expect(backend.deletePack).toHaveBeenCalledWith({ tag: "de-DE" });
});

it("ignores an older list response after live progress and removes listeners when closed", async () => {
  let finish!: (value: HandwritingPacks) => void;
  backend.listPacks.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<LanguagePacks />);
  act(() => {
    openLanguagePacks("de-DE");
  });
  await waitFor(() => expect(backend.addListener).toHaveBeenCalled());
  act(() =>
    backend.addListener.mock.calls[0][1]({
      revision: 4,
      packs: [{ tag: "de-DE", bundled: false, state: 4 }],
    }),
  );
  await act(async () => finish(initial()));
  expect(
    screen.getByRole("button", {
      name: `German ${t("fcboard.languagePacks.delete")}`,
    }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.close") }));
  await waitFor(() => expect(backend.remove).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("offers the required-language prompt before managing models and reports an actual failed download", async () => {
  render(<LanguagePacks />);
  act(() => {
    openLanguagePacks("de-DE", true);
  });
  expect(screen.getByRole("alertdialog")).toHaveTextContent("German");
  expect(backend.listPacks).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.languagePacks.manage") }),
  );
  const download = await screen.findByRole("button", {
    name: `German ${t("fcboard.languagePacks.download")}`,
  });
  backend.downloadPack.mockRejectedValue(new Error("Network unavailable"));
  fireEvent.click(download);
  await screen.findByRole("alert");
  expect(
    screen.getByRole("button", {
      name: `German ${t("fcboard.languagePacks.retry")}`,
    }),
  ).toBeEnabled();
});

it("does not invent installed packs when the native model backend is unavailable", () => {
  backend.native.mockReturnValue(false);
  render(<LanguagePacks />);
  act(() => {
    openLanguagePacks();
  });
  expect(screen.getByRole("status")).toHaveTextContent(
    t("fcboard.languagePacks.android_only"),
  );
  expect(backend.listPacks).not.toHaveBeenCalled();
  expect(document.querySelector(".fc-language-pack-row")).toBeNull();
});
