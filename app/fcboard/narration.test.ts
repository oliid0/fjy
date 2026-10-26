import { t } from "@excalidraw/excalidraw/i18n";
import { Capacitor } from "@capacitor/core";

import { createNarrator } from "./narration";
import { OfflineTts, narrationChunks } from "./nativeNarration";

vi.mock("./nativeNarration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./nativeNarration")>()),
  OfflineTts: { synthesize: vi.fn(), cancel: vi.fn() },
}));

describe("one audible teacher", () => {
  const pause = vi.fn();
  const play = vi.fn().mockResolvedValue(undefined);
  const players: {
    onended?: () => void;
    onerror?: () => void;
    pause: typeof pause;
    play: typeof play;
  }[] = [];
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem(
      "fcboard-settings",
      JSON.stringify({
        ttsEndpoint: "https://voice.example.test/v1/audio/speech",
      }),
    );
    // Settings themselves are localStorage; secrets alone live in sessionStorage.
    localStorage.setItem(
      "fcboard-settings",
      JSON.stringify({
        ttsEndpoint: "https://voice.example.test/v1/audio/speech",
      }),
    );
    players.length = 0;
    pause.mockClear();
    play.mockClear();
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("web");
    vi.mocked(OfflineTts.synthesize).mockResolvedValue({
      path: "file:///data/cache/voice.wav",
    });
    vi.mocked(OfflineTts.cancel).mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(["wav"], { type: "audio/wav" }),
      }),
    );
    vi.stubGlobal(
      "Audio",
      class {
        pause = pause;
        play = play;
        constructor() {
          players.push(this);
        }
      },
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("pauses the original voice while answering and resolves each finished promise", async () => {
    const main = createNarrator();
    const branch = createNarrator();
    await main.speak("原课");
    let ended = false;
    void main.finished.then(() => {
      ended = true;
    });
    await branch.speak("回答追问");
    expect(pause).toHaveBeenCalled();
    expect(ended).toBe(false);
    players[1].onended?.();
    await branch.finished;
    branch.stop();
    await main.resume();
    expect(play).toHaveBeenCalledTimes(3);
    players[0].onended?.();
    await main.finished;
    expect(ended).toBe(true);
    main.stop();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
  it("surfaces invalid audio and releases playback instead of claiming speech succeeded", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["html"], { type: "text/html" }),
    } as Response);
    const narrator = createNarrator();
    await expect(narrator.speak("讲解")).rejects.toThrow(
      t("fcboard.the_voice_service_returned_invalid_audio"),
    );
    await narrator.finished;
    expect(players).toHaveLength(0);
    narrator.stop();
  });
  it("ignores replaced audio's late end and error events while the next response is playing", async () => {
    const narrator = createNarrator();
    await narrator.speak("first response");
    const end = players[0].onended;
    const error = players[0].onerror;
    await narrator.speak("new response");
    let finished = false;
    void narrator.finished.then(() => {
      finished = true;
    });
    const pauses = pause.mock.calls.length;
    end?.();
    error?.();
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(pause).toHaveBeenCalledTimes(pauses);
    players[1].onended?.();
    await narrator.finished;
    expect(finished).toBe(true);
    narrator.stop();
  });
  const android = () => {
    localStorage.setItem("fcboard-settings", "{}");
    vi.mocked(Capacitor.getPlatform).mockReturnValue("android");
  };
  it("uses the bundled Android engine without an endpoint or browser speech service", async () => {
    android();
    const narrator = createNarrator();
    const boundary = vi.fn();
    await narrator.speak("牛顿定律", { onBoundary: boundary });
    expect(OfflineTts.synthesize).toHaveBeenCalledWith({
      id: expect.any(String),
      text: "牛顿定律",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalledTimes(1);
    players[0].onended?.();
    await narrator.finished;
    expect(boundary).toHaveBeenLastCalledWith(4);
    expect(OfflineTts.cancel).toHaveBeenCalledWith({
      id: vi.mocked(OfflineTts.synthesize).mock.calls[0][0].id,
    });
    narrator.stop();
  });
  it("ignores a finished native chunk's delayed events after the next chunk starts", async () => {
    android();
    const narrator = createNarrator();
    await narrator.speak("A complete sentence for the classroom. ".repeat(8));
    const end = players[0].onended;
    const error = players[0].onerror;
    end?.();
    await vi.waitFor(() => expect(players).toHaveLength(2));
    let finished = false;
    void narrator.finished.then(() => {
      finished = true;
    });
    const pauses = pause.mock.calls.length;
    end?.();
    error?.();
    await Promise.resolve();
    expect(players).toHaveLength(2);
    expect(pause).toHaveBeenCalledTimes(pauses);
    expect(finished).toBe(false);
    narrator.stop();
    await narrator.finished;
  });
  it("does not play a cancelled native result after the board or lesson changes", async () => {
    android();
    let resolve!: (value: { path: string }) => void;
    vi.mocked(OfflineTts.synthesize).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const narrator = createNarrator();
    const pending = narrator.speak("已经取消");
    narrator.stop();
    resolve({ path: "file:///data/cache/late.wav" });
    await pending;
    await narrator.finished;
    expect(OfflineTts.cancel).toHaveBeenCalledTimes(1);
    expect(players).toHaveLength(0);
  });
  it("bounds long mixed-language inference, preserves text, and pauses across chunk preparation", async () => {
    android();
    const text = "牛顿定律， describes motion. 🧑‍🏫 ".repeat(20);
    const chunks = narrationChunks(text);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((chunk) => Array.from(chunk).length <= 80)).toBe(true);
    expect(chunks.every((chunk) => !/[\ud800-\udbff]$/.test(chunk))).toBe(true);
    const narrator = createNarrator();
    await narrator.speak(text);
    let ended = false;
    void narrator.finished.then(() => {
      ended = true;
    });
    narrator.pause();
    players[0].onended?.();
    await vi.waitFor(() => expect(players).toHaveLength(2));
    expect(play).toHaveBeenCalledTimes(1);
    expect(ended).toBe(false);
    await narrator.resume();
    expect(play).toHaveBeenCalledTimes(2);
    narrator.stop();
    await narrator.finished;
  });
  it("reports real native and playback errors so teaching can use paced captions", async () => {
    android();
    const narrator = createNarrator();
    vi.mocked(OfflineTts.synthesize).mockRejectedValueOnce(
      new Error("model unavailable"),
    );
    await expect(narrator.speak("讲解")).rejects.toThrow("model unavailable");
    await narrator.finished;
    await narrator.speak("再次讲解");
    players[0].onerror?.();
    await expect(narrator.finished).rejects.toThrow(
      t("fcboard.the_voice_service_returned_invalid_audio"),
    );
    narrator.stop();
  });
});
