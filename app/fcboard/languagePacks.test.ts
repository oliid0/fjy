import * as i18n from "@fcboard/fcboard/i18n";

import { packForLocale, languagePacksEvent } from "./languagePacks";
import { currentTextInkLanguage, recognizeDigitalInk } from "./digitalInk";
import { currentSettings } from "./settings";

const backend = vi.hoisted(() => ({ recognize: vi.fn(), prepare: vi.fn() }));
vi.mock("@capacitor/core", async (original) => ({
  ...(await original<typeof import("@capacitor/core")>()),
  registerPlugin: () => backend,
}));
vi.mock("./settings", () => ({
  currentSettings: vi.fn(() => ({ inkLanguage: "auto" })),
}));
beforeEach(() =>
  vi
    .mocked(currentSettings)
    .mockReturnValue({ ...currentSettings(), inkLanguage: "auto" }),
);
afterEach(() => {
  vi.restoreAllMocks();
  backend.recognize.mockReset();
});

it.each([
  ["zh-TW", "zh-Hani-CN"],
  ["en-GB", "en-US"],
  ["de-DE", "de-DE"],
  ["fr-CA", "fr-FR"],
  ["iw-IL", "he-IL"],
  ["in-ID", "id-ID"],
  ["es-MX", "es-ES"],
  ["unknown", "en-US"],
])(
  "resolves %s through the original language catalog to %s",
  (locale, pack) => {
    expect(packForLocale(locale)).toBe(pack);
  },
);

it("uses the current language's actual handwriting model and preserves explicit math and user language choices", async () => {
  const language = i18n.getLanguage();
  vi.spyOn(i18n, "getLanguage").mockReturnValue({ ...language, code: "de-DE" });
  backend.recognize.mockResolvedValue({
    candidates: ["Guten Tag", "Tag"],
    engine: "native",
  });
  const signal = new AbortController().signal;
  const strokes: [number, number][][] = [
    [
      [0, 0],
      [10, 20],
    ],
  ];
  expect(currentTextInkLanguage()).toBe("de-DE");
  expect(await recognizeDigitalInk(strokes, signal, "text")).toEqual([
    "Guten Tag",
    "Tag",
  ]);
  expect(backend.recognize).toHaveBeenLastCalledWith({
    strokes,
    language: "de-DE",
  });
  await recognizeDigitalInk(strokes, signal, "math");
  expect(backend.recognize).toHaveBeenLastCalledWith({
    strokes,
    language: "en-US",
  });
  vi.mocked(currentSettings).mockReturnValue({
    ...currentSettings(),
    inkLanguage: "zh-Hani-CN",
  });
  await recognizeDigitalInk(strokes, signal, "text");
  expect(backend.recognize).toHaveBeenLastCalledWith({
    strokes,
    language: "zh-Hani-CN",
  });
});

it("opens the original model-required flow on a real missing-model error and suppresses it after cancellation", async () => {
  const show = vi.fn();
  window.addEventListener(languagePacksEvent, show);
  const failure = Object.assign(new Error("Model required"), {
    code: "HANDWRITING_MODEL_REQUIRED",
  });
  backend.recognize.mockRejectedValue(failure);
  const controller = new AbortController();
  try {
    await expect(
      recognizeDigitalInk([[[0, 0]]], controller.signal, "text"),
    ).rejects.toBe(failure);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0].detail).toMatchObject({ required: true });
    backend.recognize.mockImplementation(async () => {
      controller.abort();
      throw failure;
    });
    await expect(
      recognizeDigitalInk([[[0, 0]]], controller.signal, "text"),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(show).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener(languagePacksEvent, show);
  }
});
