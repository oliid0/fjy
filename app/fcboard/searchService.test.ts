import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { getLanguage, t } from "@fcboard/fcboard/i18n";

import {
  readSearchPage,
  searchPage,
  searchDuration,
  searchBaseUrl,
} from "./searchService";
vi.mock("@capacitor/core", async (original) => ({
  ...(await original<typeof import("@capacitor/core")>()),
  CapacitorHttp: { post: vi.fn() },
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("reads the deployed string code, first definition, empty pages and honest service failures", () => {
  expect(
    readSearchPage("word", {
      code: "0",
      data: [{ abstractText: "Definition" }, { abstractText: "second" }],
    }),
  ).toEqual({ text: "Definition", items: [] });
  expect(readSearchPage("photo", { code: 0, data: [] })).toEqual({
    text: "",
    items: [],
  });
  expect(() =>
    readSearchPage("word", { code: 1, message: "Unavailable", data: [] }),
  ).toThrow("Unavailable");
  expect(() => readSearchPage("photo", { code: 0, data: null })).toThrow(
    t("fcboard.search_failed"),
  );
});
it("sorts photos by actual resolution, preserves video order and excludes invalid media URLs", () => {
  const rows = [
    { url: "https://example.test/small.png", width: 100, height: 50 },
    { url: "https://example.test/large.png", width: 800, height: 600 },
    { url: "file:///tmp/unavailable.png" },
  ];
  expect(
    readSearchPage("photo", { code: "0", data: rows }).items.map(
      (item) => item.url,
    ),
  ).toEqual([rows[1].url, rows[0].url]);
  expect(
    readSearchPage("video", { code: "0", data: rows }).items.map(
      (item) => item.url,
    ),
  ).toEqual([rows[0].url, rows[1].url]);
});
it.each([
  ["word", "searchWord", 1],
  ["photo", "searchPhoto", 3],
  ["video", "searchVideo", 2],
] as const)(
  "posts the verified %s contract without AI setup",
  async (kind, path, page) => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    const fetcher = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ code: "0", data: [] }),
    });
    vi.stubGlobal("fetch", fetcher);
    await searchPage(
      kind,
      "  Newton laws  ",
      page,
      new AbortController().signal,
    );
    expect(fetcher).toHaveBeenCalledWith(
      `${searchBaseUrl}/media/${path}`,
      expect.objectContaining({
        method: "POST",
        headers: {
          source: "PC",
          language: getLanguage().code.replaceAll("-", "_"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          keyword: "Newton laws",
          language: getLanguage().code.replaceAll("-", "_"),
          page,
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  },
);
it("uses native HTTP to cross WebView CORS and ignores a cancelled late native result", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  const controller = new AbortController();
  vi.mocked(CapacitorHttp.post).mockImplementation(async () => {
    controller.abort();
    return {
      status: 200,
      data: JSON.stringify({ code: "0", data: [] }),
      url: "",
      headers: {},
    };
  });
  await expect(
    searchPage("photo", "Sun", 1, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(CapacitorHttp.post).toHaveBeenCalledWith(
    expect.objectContaining({
      url: `${searchBaseUrl}/media/searchPhoto`,
      data: expect.objectContaining({ keyword: "Sun", page: 1 }),
      connectTimeout: 15000,
      readTimeout: 30000,
    }),
  );
});
it("does not dispatch a pre-cancelled or invalid-page request and formats native video duration", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(
    searchPage("word", "Sun", 1, cancelled.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    searchPage("photo", "Sun", 0, new AbortController().signal),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  expect(searchDuration(91)).toBe("01:31");
  expect(searchDuration(3661)).toBe("1:01:01");
});

it.each([true, false])(
  "accepts real native JSON body variants (string=%s)",
  async (encoded) => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    const data = { code: "0", data: [{ abstractText: "Native definition" }] };
    vi.mocked(CapacitorHttp.post).mockResolvedValue({
      status: 200,
      data: encoded ? JSON.stringify(data) : data,
      url: "",
      headers: {},
    });
    expect(
      await searchPage("word", "Sun", 1, new AbortController().signal),
    ).toEqual({ text: "Native definition", items: [] });
  },
);
