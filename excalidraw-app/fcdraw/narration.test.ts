import { t } from "@excalidraw/excalidraw/i18n";

import { createNarrator } from "./narration";

describe("one audible teacher", () => {
  const pause = vi.fn();
  const play = vi.fn().mockResolvedValue(undefined);
  const players: {
    onended?: () => void;
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
      t("fcboard.播报接口未返回有效音频"),
    );
    await narrator.finished;
    expect(players).toHaveLength(0);
    narrator.stop();
  });
});
