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
  afterEach(() => vi.unstubAllGlobals());
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
    expect(localStorage.getItem("fcdraw-settings")).not.toContain(
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
      ok: true,
      json: async () => ({ choices: [{ message: { content: "answer" } }] }),
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await chat([{ role: "user", content: "hello" }])).toBe("answer");
    expect(JSON.parse(fetcher.mock.calls[0][1].body).model).toBe(
      "visual-model",
    );
    fetcher.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "invalid key" } }),
    });
    await expect(chat([])).rejects.toThrow("invalid key");
  });
  it("parses fenced JSON and refuses malformed responses", () => {
    expect(parseJSON('```json\n{"action":"plot"}\n```')).toEqual({
      action: "plot",
    });
    expect(() => parseJSON("not JSON")).toThrow();
  });
});
