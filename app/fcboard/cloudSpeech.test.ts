import { startCloudSpeech } from "./cloudSpeech";
import { defaults, loadSettings, saveSettings } from "./settings";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  start: vi.fn().mockResolvedValue({ session: "cloud" }),
  push: vi.fn().mockResolvedValue({ lines: [] }),
  stop: vi.fn().mockResolvedValue({}),
  addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  native: true,
}));
vi.mock("./localSpeech", () => ({ startPCMSpeech: mocks.capture }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
  registerPlugin: () => mocks,
}));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  mocks.native = true;
});

it("uses cloud by default on Android and keeps the speech credential separate from Ark", async () => {
  expect(loadSettings().speech).toBe("cloud");
  expect(loadSettings().imageModel).toBe("doubao-seedream-5-0-flash-260915");
  saveSettings(
    {
      ...defaults,
      speech: "cloud",
      apiKey: "ark-only",
      speechKey: "speech-only",
    },
    false,
  );
  startCloudSpeech(vi.fn(), vi.fn(), {} as MediaStream);
  const [transport] = mocks.capture.mock.calls[0];
  await transport.start();
  expect(mocks.start).toHaveBeenCalledWith({
    key: "speech-only",
    resource: "volc.seedasr.sauc.duration",
  });
  await transport.stop({ session: "cloud", discard: true });
  expect(mocks.stop).toHaveBeenCalledWith({ session: "cloud", discard: true });
  expect(JSON.parse(localStorage.getItem("fcboard-settings")!).speechKey).toBe(
    "",
  );
});

it("captures voice directly in native code and isolates late session events", async () => {
  saveSettings({ ...defaults, speechKey: "native-speech" }, false);
  const lines = vi.fn();
  const interim = vi.fn();
  const remove = vi.fn();
  let receive!: (event: {
    session: string;
    lines?: { time: number; text: string }[];
  }) => void;
  mocks.addListener.mockImplementation(async (_name, callback) => {
    receive = callback;
    return { remove };
  });
  const handle = await startCloudSpeech(
    lines,
    vi.fn(),
    undefined,
    undefined,
    interim,
  );
  expect(mocks.capture).not.toHaveBeenCalled();
  expect(mocks.start).toHaveBeenCalledWith(
    expect.objectContaining({ capture: true, key: "native-speech" }),
  );
  receive({ session: "old", lines: [{ time: 1, text: "ignored" }] });
  receive({ session: "cloud", lines: [{ time: 1, text: "写一个标题" }] });
  expect(lines).toHaveBeenCalledTimes(1);
  await handle.cancel();
  expect(remove).toHaveBeenCalledTimes(1);
  receive({ session: "cloud", lines: [{ time: 2, text: "late" }] });
  expect(lines).toHaveBeenCalledTimes(1);
});

it("does not open capture using the model key when the speech key is missing", () => {
  saveSettings({ ...defaults, apiKey: "ark-only" }, false);
  expect(() => startCloudSpeech(vi.fn(), vi.fn())).toThrow();
  expect(mocks.capture).not.toHaveBeenCalled();
});

it("does not pretend browser WebSocket can supply native authorization headers", () => {
  mocks.native = false;
  expect(() => startCloudSpeech(vi.fn(), vi.fn())).toThrow();
  expect(mocks.capture).not.toHaveBeenCalled();
});
