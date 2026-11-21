import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";

import { AUDIO_GENERATION_ENDPOINT, createStudyAudio } from "./studyAudio";
import { defaults, saveSettings } from "./settings";

vi.mock("@capacitor/core", async (original) => ({
  ...(await original<typeof import("@capacitor/core")>()),
  CapacitorHttp: { post: vi.fn() },
}));

const sources: ReturnType<typeof createStudyAudio>[] = [];
const source = () => {
  const value = createStudyAudio();
  sources.push(value);
  return value;
};
const network =
  vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>();
const audio = btoa("ID3 recorded pronunciation bytes");
beforeEach(() => {
  network
    .mockReset()
    .mockImplementation(
      async () => new Response(JSON.stringify({ audio, duration: 1 })),
    );
  saveSettings(
    { ...defaults, apiKey: "text-model-key", ttsKey: "speech-only-key" },
    false,
  );
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (...args: Parameters<typeof fetch>) => {
      const input = String(args[0]);
      if (input.startsWith("data:audio/mpeg;base64,")) {
        return new Response(
          Uint8Array.from(atob(input.split(",")[1]), (letter) =>
            letter.charCodeAt(0),
          ),
          { headers: { "Content-Type": "audio/mpeg" } },
        );
      }
      return network(...args);
    }),
  );
});
afterEach(() => {
  sources.splice(0).forEach((value) => value.clear());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

it("uses the PDF request and actual source language, accepts documented success without code, and caches real audio bytes", async () => {
  const value = source();
  const signal = new AbortController().signal;
  const blob = await value.generate("Good morning.", "en", signal);
  expect(blob.type).toBe("audio/mpeg");
  expect(blob.size).toBe(atob(audio).length);
  const [endpoint, options] = network.mock.calls[0];
  expect(endpoint).toBe(AUDIO_GENERATION_ENDPOINT);
  expect(options).toMatchObject({
    method: "POST",
    redirect: "error",
    headers: {
      "X-Api-Key": "speech-only-key",
      "X-Api-Request-Id": expect.any(String),
    },
  });
  expect(options?.headers).not.toHaveProperty("Authorization");
  const body = JSON.parse(String(options?.body));
  expect(body).toEqual({
    model: "seed-audio-1.0",
    text_prompt: expect.stringContaining("in en"),
    audio_config: { format: "mp3", sample_rate: 24000 },
  });
  expect(body.text_prompt).toContain('"Good morning."');
  expect(await value.generate("Good morning.", "en", signal)).toBe(blob);
  expect(network).toHaveBeenCalledTimes(1);
  await value.generate("Good morning.", "es", signal);
  expect(network).toHaveBeenCalledTimes(2);
});

it("uses installed native HTTP with independent bounded requests and decodes JSON audio rather than a JSON blob", async () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  const post = vi.mocked(CapacitorHttp.post).mockResolvedValue({
    status: 200,
    data: { audio },
    headers: {},
    url: AUDIO_GENERATION_ENDPOINT,
  });
  const blob = await source().generate(
    "こんにちは",
    "ja",
    new AbortController().signal,
  );
  expect(blob.type).toBe("audio/mpeg");
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({
      url: AUDIO_GENERATION_ENDPOINT,
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": "speech-only-key",
        "X-Api-Request-Id": expect.any(String),
      },
      responseType: "json",
      disableRedirects: true,
      connectTimeout: 15000,
      readTimeout: 30000,
      data: expect.objectContaining({
        text_prompt: expect.stringContaining("in ja"),
      }),
    }),
  );
  expect(network).not.toHaveBeenCalled();
});

it.each([
  { ttsKey: "", ttsEndpoint: "", language: "en" },
  {
    ttsKey: "speech-only-key",
    ttsEndpoint: "https://other.example/v1/audio/speech",
    language: "en",
  },
  { ttsKey: "speech-only-key", ttsEndpoint: "", language: "ar" },
])(
  "does not send a text-model key, another service's credential, or an unsupported language: %j",
  async (options) => {
    saveSettings({ ...defaults, apiKey: "text-model-key", ...options }, false);
    await expect(
      source().generate("word", options.language, new AbortController().signal),
    ).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  },
);

it.each([
  { status: 200, body: JSON.stringify({ code: 500, message: "no audio" }) },
  { status: 200, body: "invalid JSON" },
  { status: 200, body: JSON.stringify({ audio: "<not-base64>" }) },
  { status: 401, body: "not authorized" },
])(
  "rejects missing/invalid audio or an HTTP error instead of caching fake success: %j",
  async ({ status, body }) => {
    network.mockResolvedValue(new Response(body, { status }));
    const value = source();
    await expect(
      value.generate("word", "en", new AbortController().signal),
    ).rejects.toThrow(
      status === 401
        ? t("fcboard.voice_playback_request_failed_status", { status })
        : t("fcboard.the_voice_service_returned_invalid_audio"),
    );
    network.mockResolvedValue(new Response(JSON.stringify({ audio })));
    await expect(
      value.generate("word", "en", new AbortController().signal),
    ).resolves.toMatchObject({ type: "audio/mpeg" });
    expect(network).toHaveBeenCalledTimes(2);
  },
);

it("bounds four clips and evicts cached audio on idle or credential change", async () => {
  vi.useFakeTimers();
  const value = source();
  const signal = new AbortController().signal;
  for (const word of ["one", "two", "three", "four", "five"]) {
    await value.generate(word, "en", signal);
  }
  await value.generate("five", "en", signal);
  expect(network).toHaveBeenCalledTimes(5);
  await value.generate("one", "en", signal);
  expect(network).toHaveBeenCalledTimes(6);
  await vi.advanceTimersByTimeAsync(60001);
  await value.generate("one", "en", signal);
  expect(network).toHaveBeenCalledTimes(7);
  saveSettings({ ...defaults, ttsKey: "changed-speech-key" }, false);
  await value.generate("one", "en", signal);
  expect(network).toHaveBeenCalledTimes(8);
  expect(network.mock.calls.at(-1)?.[1]?.headers).toMatchObject({
    "X-Api-Key": "changed-speech-key",
  });
});

it.each(["close", "key", "deadline"])(
  "settles an ignored-abort audio provider on %s and never caches its late artifact",
  async (change) => {
    vi.useFakeTimers();
    const value = source();
    let finish!: (response: Response) => void;
    network.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = value.generate("word", "en", controller.signal);
    const rejected = expect(pending).rejects.toThrow();
    if (change === "close") {
      controller.abort();
    } else if (change === "key") {
      saveSettings({ ...defaults, ttsKey: "new-speech-key" }, false);
    } else {
      await vi.advanceTimersByTimeAsync(30000);
    }
    await rejected;
    expect((network.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(
      true,
    );
    finish(new Response(JSON.stringify({ audio })));
    await Promise.resolve();
    await value.generate("word", "en", new AbortController().signal);
    expect(network).toHaveBeenCalledTimes(2);
  },
);
