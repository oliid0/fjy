import { languageInkSignature, parseLanguageStudy } from "./languageStudy";
import { languageStudy } from "./test/language";

it("requires a bounded complete translation and learning data before writing", () => {
  expect(parseLanguageStudy(JSON.stringify(languageStudy))).toEqual(
    languageStudy,
  );
  for (const value of [
    null,
    { term: "hello" },
    { ...languageStudy, translation: "" },
    { ...languageStudy, grammar: "" },
    { ...languageStudy, usage: "" },
    { ...languageStudy, term: "a".repeat(1801) },
    { ...languageStudy, meanings: [] },
  ]) {
    expect(() => parseLanguageStudy(JSON.stringify(value))).toThrow();
  }
});

it("keeps moved and scaled source ink valid but rejects erased or edited trajectories", () => {
  const strokes = [
    [
      [10, 20],
      [20, 40],
    ],
    [
      [30, 20],
      [40, 35],
    ],
  ];
  const signature = languageInkSignature(strokes);
  expect(
    languageInkSignature(
      strokes
        .map((stroke) => stroke.map(([x, y]) => [x * 2 + 100, y * 3 - 50]))
        .reverse(),
    ),
  ).toBe(signature);
  expect(languageInkSignature(strokes.slice(0, 1))).not.toBe(signature);
  expect(
    languageInkSignature([
      [
        [10, 20],
        [20, 38],
      ],
      strokes[1],
    ]),
  ).not.toBe(signature);
  expect(languageInkSignature([[[NaN, 0]]])).toBe("");
  expect(
    languageInkSignature([
      Array.from({ length: 150000 }, (_, i) => [i, i % 50]),
    ]),
  ).not.toBe("");
});

it.each(["zh-CN", "ja-JP"])(
  "generates an AI learning card directly from the screenshot in UI language %s",
  async (target) => {
    const { explainLanguage } = await import("./languageStudy");
    const { defaults, saveSettings } = await import("./settings");
    saveSettings(
      {
        ...defaults,
        apiKey: "configured",
        translationProvider: "local",
        model: "vision-main",
        textModel: "text-only",
      },
      false,
    );
    const response = {
      ...languageStudy,
      translation:
        target === "ja-JP" ? "おはようございます。" : languageStudy.translation,
    };
    const model = vi
      .spyOn(await import("./ai"), "chat")
      .mockResolvedValue(JSON.stringify(response));
    try {
      await expect(
        explainLanguage(
          "",
          new AbortController().signal,
          target,
          "data:image/png;base64,selected-word",
          true,
        ),
      ).resolves.toEqual(response);
      expect(model).toHaveBeenCalledTimes(1);
      expect(model.mock.calls[0][2]?.model).toBe("vision-main");
      expect(JSON.stringify(model.mock.calls[0][0])).toContain(
        "data:image/png;base64,selected-word",
      );
      expect(model.mock.calls[0][0].at(-1)?.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "text",
            text: expect.stringContaining(`"explanationLanguage":"${target}"`),
          }),
        ]),
      );
    } finally {
      vi.restoreAllMocks();
      localStorage.clear();
      sessionStorage.clear();
    }
  },
);
it("does not turn a failed AI study into a translation-only fake learning card", async () => {
  const { explainLanguage } = await import("./languageStudy");
  const { defaults, saveSettings } = await import("./settings");
  saveSettings(
    { ...defaults, apiKey: "configured", translationProvider: "local" },
    false,
  );
  vi.spyOn(await import("./ai"), "chat").mockRejectedValue(
    new Error("vision unavailable"),
  );
  const fallback = vi.spyOn(
    await import("./localTranslation"),
    "translateLocally",
  );
  try {
    await expect(
      explainLanguage(
        "",
        new AbortController().signal,
        "ja-JP",
        "data:image/png;base64,word",
        true,
      ),
    ).rejects.toThrow("vision unavailable");
    expect(fallback).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  }
});
