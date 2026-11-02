import { t } from "@fcboard/fcboard/i18n";
import { Capacitor, CapacitorHttp } from "@capacitor/core";

import { boardContext, chat, parseJSON } from "./ai";
import { sceneAPI } from "./test/scene";
import {
  currentSettings,
  defaults,
  saveSettings,
  validateEndpoint,
} from "./settings";

describe("AI configuration and transport", () => {
  it("falls back once when fast returns a structured provider error inside HTTP 200", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "ServiceTierUnavailable",
              message: "resource unavailable",
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ordinary answer" } }],
          }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(
      await chat([{ role: "user", content: "hello" }], undefined, {
        ...defaults,
        apiKey: "structured-fast-error-only",
      }),
    ).toBe("ordinary answer");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).service_tier).toBe("fast");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).not.toHaveProperty(
      "service_tier",
    );
  });
  it("does not replay an authentication failure or an already-started streamed answer", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "invalid key" } }), {
        status: 401,
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      chat([{ role: "user", content: "hello" }], undefined, {
        ...defaults,
        apiKey: "no-replay-key",
      }),
    ).rejects.toThrow("invalid key");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const onDelta = vi.fn();
    fetcher.mockResolvedValueOnce(
      new Response(
        'data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"error":{"message":"fast unavailable"}}\n\n',
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    );
    await expect(
      chat(
        [{ role: "user", content: "hello" }],
        undefined,
        { ...defaults, apiKey: "no-replay-key" },
        { onDelta },
      ),
    ).rejects.toThrow("fast unavailable");
    expect(onDelta).toHaveBeenCalledWith("partial");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("requires real provider search evidence before reporting a web-assisted answer", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    const source = { title: "课程标准", url: "https://example.com/curriculum" };
    const fetcher = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "answer",
                  annotations: [{ type: "url_citation", url_citation: source }],
                },
              },
            ],
            usage: { tool_usage: { web_search: 1 } },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const evidence = vi.fn();
    expect(
      await chat(
        [{ role: "user", content: "search" }],
        undefined,
        { ...defaults, apiKey: "test" },
        { webSearch: true, onSearch: evidence },
      ),
    ).toBe("answer");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      stream: false,
      web_search_options: {},
    });
    for (const field of [
      "service_tier",
      "thinking",
      "reasoning",
      "prompt_cache_key",
    ]) {
      expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty(
        field,
      );
    }
    expect(evidence).toHaveBeenCalledWith({ count: 1, sources: [source] });
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "answer with invented URL" } }],
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(
      chat(
        [{ role: "user", content: "search" }],
        undefined,
        { ...defaults, apiKey: "test", model: "search-model" },
        { webSearch: true },
      ),
    ).rejects.toThrow("未返回实际联网搜索");
  });
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
  it("defaults selection screenshots off and persists an explicit boolean opt-in", () => {
    expect(currentSettings().selectionImages).toBe(false);
    saveSettings({ ...defaults, selectionImages: true }, false);
    expect(currentSettings().selectionImages).toBe(true);
    localStorage.setItem(
      "fcboard-settings",
      JSON.stringify({ selectionImages: "true" }),
    );
    expect(currentSettings().selectionImages).toBe(false);
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
  it("uses standard Ark Responses image blocks without model-specific inference overrides", async () => {
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
          role: "user",
          content: [
            { type: "input_image", image_url: "data:image/png;base64,test" },
            { type: "input_text", text: "识别文字" },
          ],
        },
      ],
    });
    expect(body.messages).toBeUndefined();
    for (const key of [
      "reasoning",
      "thinking",
      "service_tier",
      "prompt_cache_key",
      "temperature",
    ]) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it.each(["chat/completions", "responses"])(
    "routes images to the configured vision model over %s",
    async (path) => {
      const fetcher = vi.fn().mockResolvedValue({
        status: 200,
        text: async () =>
          JSON.stringify(
            path === "responses"
              ? {
                  output: [
                    {
                      type: "message",
                      content: [{ type: "output_text", text: "star" }],
                    },
                  ],
                }
              : { choices: [{ message: { content: "star" } }] },
          ),
      });
      vi.stubGlobal("fetch", fetcher);
      await chat(
        [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,test" },
              },
            ],
          },
        ],
        undefined,
        {
          ...defaults,
          apiKey: "test",
          ocrModel: "configured-vision",
          endpoint: `https://ark.cn-beijing.volces.com/api/v3/${path}`,
        },
      );
      const body = JSON.parse(fetcher.mock.calls[0][1].body);
      expect(body.model).toBe("configured-vision");
      expect(body).not.toHaveProperty("service_tier");
      expect(body).not.toHaveProperty("prompt_cache_key");
    },
  );

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
    expect(currentSettings().model).toBe("doubao-seed-2-0-mini-260428");
  });
});

vi.mock("@capacitor/core", async (original) => ({
  ...(await original<typeof import("@capacitor/core")>()),
  CapacitorHttp: { post: vi.fn() },
}));
