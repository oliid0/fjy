import { Capacitor, CapacitorHttp } from "@capacitor/core";

import { chat, parseJSON } from "./ai";
import {
  currentSettings,
  defaults,
  saveSettings,
  validateEndpoint,
} from "./settings";

describe("AI configuration and transport", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it("uses the requested default endpoint and requires a real model and key", async () => {
    expect(currentSettings().endpoint).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    );
    await expect(chat([{ role: "user", content: "hello" }])).rejects.toThrow(
      "设置",
    );
  });
  it("keeps keys in the session unless explicitly remembered", () => {
    saveSettings(
      { ...defaults, apiKey: "test-secret", speechKey: "speech-secret" },
      false,
    );
    expect(localStorage.getItem("fcboard-settings")).not.toContain(
      "test-secret",
    );
    expect(currentSettings().apiKey).toBe("test-secret");
    sessionStorage.clear();
    expect(currentSettings().apiKey).toBe("");
  });
  it("accepts secure and LAN endpoints and blocks executable URLs", () => {
    expect(validateEndpoint("http://192.168.1.2:8080/chat")).toContain(
      "192.168.1.2",
    );
    expect(() => validateEndpoint("data:text/plain,invalid")).toThrow();
    expect(() => validateEndpoint("http://public.example/chat")).toThrow();
    expect(() =>
      validateEndpoint("http://localhost.attacker.example/chat"),
    ).toThrow();
    expect(() =>
      validateEndpoint("http://192.168.attacker.example/chat"),
    ).toThrow();
    expect(() =>
      validateEndpoint("https://key:secret@api.example/chat"),
    ).toThrow();
  });
  it("sends the selected model and reports upstream failures", async () => {
    saveSettings(
      { ...defaults, apiKey: "test-key", model: "visual-model" },
      false,
    );
    const fetcher = vi.fn().mockResolvedValue({
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: "answer" } }] }),
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await chat([{ role: "user", content: "hello" }])).toBe("answer");
    expect(JSON.parse(fetcher.mock.calls[0][1].body).model).toBe(
      "visual-model",
    );
    fetcher.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: "invalid key" } }),
    });
    await expect(chat([])).rejects.toThrow("invalid key");
  });
  it("parses fenced JSON and refuses malformed responses", () => {
    expect(parseJSON('```json\n{"action":"plot"}\n```')).toEqual({
      action: "plot",
    });
    expect(() => parseJSON("not JSON")).toThrow();
  });

  it("keeps the old brand's connection settings and session keys readable", () => {
    localStorage.setItem(
      "fcdraw-settings",
      JSON.stringify({ endpoint: defaults.endpoint, model: "old-model" }),
    );
    sessionStorage.setItem(
      "fcdraw-keys",
      JSON.stringify({ apiKey: "old-key" }),
    );
    expect(currentSettings()).toMatchObject({
      model: "old-model",
      apiKey: "old-key",
    });
    saveSettings({ ...defaults, model: "new-model", apiKey: "new-key" }, false);
    expect(currentSettings()).toMatchObject({
      model: "new-model",
      apiKey: "new-key",
    });
  });

  it("times out even when a caller supplies a cancellation signal", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    const caller = new AbortController();
    const request = chat([], caller.signal, {
      ...defaults,
      model: "test",
      apiKey: "test",
    });
    const result = expect(request).rejects.toThrow("超时");
    await vi.advanceTimersByTimeAsync(90000);
    await result;
  });

  it("cancels native requests promptly and ignores their late results", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    let finish!: (
      value: Awaited<ReturnType<typeof CapacitorHttp.post>>,
    ) => void;
    vi.spyOn(CapacitorHttp, "post").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const caller = new AbortController();
    const request = chat([], caller.signal, {
      ...defaults,
      model: "test",
      apiKey: "test",
    });
    caller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    finish({
      status: 200,
      headers: {},
      url: defaults.endpoint,
      data: { choices: [{ message: { content: "stale" } }] },
    });
  });

  it("reports a non-JSON gateway response and accepts text content parts", async () => {
    const settings = { ...defaults, model: "test", apiKey: "test" };
    const fetcher = vi.fn().mockResolvedValue({
      status: 502,
      text: async () => "<html>gateway error</html>",
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(chat([], undefined, settings)).rejects.toThrow("JSON (502)");
    fetcher.mockResolvedValue({
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            { message: { content: [{ type: "text", text: "answer" }] } },
          ],
        }),
    });
    expect(await chat([], undefined, settings)).toBe("answer");
    expect(currentSettings().model).toBe("");
  });
});

vi.mock("@capacitor/core", async (original) => ({
  ...(await original<typeof import("@capacitor/core")>()),
  CapacitorHttp: { post: vi.fn() },
}));
