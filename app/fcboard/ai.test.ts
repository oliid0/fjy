import * as i18n from "@fcboard/fcboard/i18n";
import { t } from "@fcboard/fcboard/i18n";
import { Capacitor } from "@capacitor/core";

import { boardContext, chat, parseJSON } from "./ai";
import { Classroom } from "./native";
import { sceneAPI } from "./test/scene";
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
      t(
        "fcboard.set_an_api_key_and_a_vision_model_or_endpoint_id_in_ai_settings",
      ),
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
    saveSettings({ ...defaults, apiKey: "remembered-key" }, true);
    sessionStorage.clear();
    expect(currentSettings().apiKey).toBe("remembered-key");
  });
  it("upgrades the previous default image model once while preserving custom models and later choices", () => {
    localStorage.setItem(
      "fcboard-settings",
      JSON.stringify({ imageModel: "doubao-seedream-5-0-flash-260915" }),
    );
    expect(currentSettings().imageModel).toBe("doubao-seedream-5-5-261028");
    saveSettings(
      { ...defaults, imageModel: "doubao-seedream-5-0-flash-260915" },
      false,
    );
    expect(currentSettings().imageModel).toBe(
      "doubao-seedream-5-0-flash-260915",
    );
    localStorage.setItem(
      "fcboard-settings",
      JSON.stringify({ imageModel: "custom-deployment" }),
    );
    expect(currentSettings().imageModel).toBe("custom-deployment");
  });
  it("ignores obsolete screenshot and assistant mode preferences", () => {
    localStorage.setItem(
      "fcboard-settings",
      JSON.stringify({ selectionImages: false, assistantVoice: "duplex" }),
    );
    expect(currentSettings()).not.toHaveProperty("selectionImages");
    expect(currentSettings()).not.toHaveProperty("assistantVoice");
  });
  it("reads real board text without encoding a screenshot when capture is disabled", async () => {
    const api = sceneAPI();
    const encode = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL");
    const result = await boardContext(
      api,
      false,
      api.getSceneElements(),
      undefined,
      false,
    );
    expect(result.text).toBe("学生的题目");
    expect(result.elements).toEqual(api.getSceneElements());
    expect(result.image).toBeUndefined();
    expect(encode).not.toHaveBeenCalled();
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
  it("uses Ark Responses input blocks and reads output_text without thinking for quick actions", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      status: 200,
      text: async () =>
        JSON.stringify({
          output: [
            { type: "reasoning", summary: [] },
            {
              type: "message",
              content: [{ type: "output_text", text: "1+1=" }],
            },
          ],
        }),
    });
    vi.stubGlobal("fetch", fetcher);
    const reply = await chat(
      [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,test" },
            },
            { type: "text", text: "识别文字" },
          ],
        },
      ],
      undefined,
      {
        ...defaults,
        model: "doubao-seed-evolving",
        apiKey: "test-key",
        endpoint: "https://ark.cn-beijing.volces.com/api/v3/responses",
      },
      { maxTokens: 256 },
    );
    expect(reply).toBe("1+1=");
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({
      model: "doubao-seed-evolving",
      stream: true,
      max_output_tokens: 256,
      input: [
        {
          role: "system",
          content: expect.stringContaining("active interface language"),
        },
        {
          role: "user",
          content: [
            { type: "input_image", image_url: "data:image/png;base64,test" },
            { type: "input_text", text: "识别文字" },
          ],
        },
      ],
    });
    expect(body.messages).toBeUndefined();
    expect(body.service_tier).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });

  it("parses fenced JSON and refuses malformed responses", () => {
    expect(parseJSON('```json\n{"action":"plot"}\n```')).toEqual({
      action: "plot",
    });
    expect(() => parseJSON("not JSON")).toThrow();
  });

  it("replaces connection settings and session keys without clearing the new values", () => {
    localStorage.setItem(
      "fcboard-settings",
      JSON.stringify({ endpoint: defaults.endpoint, model: "old-model" }),
    );
    sessionStorage.setItem(
      "fcboard-keys",
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
    const result = expect(request).rejects.toThrow(
      t(
        "fcboard.ai_request_timed_out_check_your_connection_or_try_again_later",
      ),
    );
    await vi.advanceTimersByTimeAsync(90000);
    await result;
  });

  it("cancels native requests promptly and ignores their late results", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    let finish!: (
      value: Awaited<ReturnType<typeof Classroom.postAIStream>>,
    ) => void;
    vi.spyOn(Classroom,"addListener").mockResolvedValue({remove:vi.fn().mockResolvedValue(undefined)});
    vi.spyOn(Classroom,"cancelAIStream").mockResolvedValue(undefined);
    vi.spyOn(Classroom, "postAIStream").mockImplementation(
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
    await vi.waitFor(() => expect(finish).toBeDefined());
    caller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    finish({
      status: 200,
      data: JSON.stringify({ choices: [{ message: { content: "stale" } }] }),
      stream: false,
    });
  });

  it("reports a non-JSON gateway response and accepts text content parts", async () => {
    const settings = { ...defaults, model: "test", apiKey: "test" };
    const fetcher = vi.fn().mockResolvedValue({
      status: 502,
      text: async () => "<html>gateway error</html>",
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(chat([], undefined, settings)).rejects.toThrow("502");
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
    expect(currentSettings().model).toBe("doubao-seed-2-1-lite-260915");
  });
});

vi.mock("@capacitor/core", async (original) => ({
  ...(await original<typeof import("@capacitor/core")>()),
  CapacitorHttp: { post: vi.fn() },
}));

it("migrates the old native system default to WSS when a speech key was configured, preserving new explicit choices", () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  localStorage.setItem(
    "fcboard-settings",
    JSON.stringify({ speech: "system", speechKey: "speech-test" }),
  );
  expect(currentSettings().speech).toBe("cloud");
  saveSettings(
    { ...defaults, speech: "system", speechKey: "speech-test" },
    false,
  );
  expect(currentSettings().speech).toBe("system");
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

it.each(["chat/completions", "responses"])(
  "sends Spanish UI output policy while preserving multilingual source on %s, and lets voice follow input",
  async (route) => {
    vi.spyOn(i18n, "getLanguage").mockReturnValue({
      code: "es-ES",
      label: "Español",
    });
    const messages: import("./ai").Message[] = [
      {
        role: "system",
        content: 'Return JSON {"answer":"text"}; preserve exact source fields.',
      },
      { role: "user", content: "Explain this English sentence: Good morning." },
    ];
    const before = JSON.stringify(messages);
    const fetcher = vi.fn().mockResolvedValue({
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: "respuesta" } }],
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "respuesta" }],
            },
          ],
        }),
    });
    vi.stubGlobal("fetch", fetcher);
    const settings = {
      ...defaults,
      apiKey: "test",
      model: "language-model",
      endpoint: `https://example.com/v1/${route}`,
    };
    try {
      await chat(messages, undefined, settings);
      const first = JSON.parse(fetcher.mock.calls[0][1].body);
      const content = first.messages || first.input;
      expect(content[0].content).toContain(
        "active interface language is es-ES",
      );
      expect(content[0].content).toContain("any language");
      expect(content[0].content).toContain(
        "translation target languages take priority",
      );
      expect(content[1]).toEqual(messages[1]);
      await chat(messages, undefined, settings, { responseLanguage: "input" });
      const second = JSON.parse(fetcher.mock.calls[1][1].body);
      expect((second.messages || second.input)[0].content).toContain(
        "respond in the language of the actual spoken/written request",
      );
      expect((second.messages || second.input)[0].content).not.toContain(
        "active interface language",
      );
      expect(JSON.stringify(messages)).toBe(before);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  },
);
