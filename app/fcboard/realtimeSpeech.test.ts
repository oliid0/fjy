import { startRealtimeSpeech } from "./realtimeSpeech";
import { defaults, saveSettings } from "./settings";
import * as cloud from "./cloudSpeech";
import * as local from "./localSpeech";

const platform = vi.hoisted(() => ({ native: true }));
vi.mock("@capacitor/core", async (original) => ({
  ...(await original<typeof import("@capacitor/core")>()),
  Capacitor: { isNativePlatform: () => platform.native },
}));

const capture = () => ({
  stop: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn().mockResolvedValue(undefined),
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  saveSettings(
    { ...defaults, speech: "cloud", speechKey: "speech-key" },
    false,
  );
  platform.native = true;
});
afterEach(() => {
  vi.restoreAllMocks();
});

it("prefers cloud, drains final words on stop and ignores late callbacks", async () => {
  const cloudHandle = capture();
  const start = vi
    .spyOn(cloud, "startCloudSpeech")
    .mockResolvedValue(cloudHandle);
  const offline = vi.spyOn(local, "startLocalSpeech");
  const lines = vi.fn();
  const handle = await startRealtimeSpeech(lines, vi.fn());
  cloudHandle.stop.mockImplementation(async () => {
    start.mock.calls[0][0]({ time: 2, text: "final words" });
  });
  await handle.stop();
  expect(lines).toHaveBeenCalledWith(
    expect.objectContaining({ text: "final words" }),
  );
  start.mock.calls[0][0]({ time: 3, text: "late" });
  expect(lines).toHaveBeenCalledTimes(1);
  expect(offline).not.toHaveBeenCalled();
});

it("falls back after an unavailable cloud start without reporting a spurious failure", async () => {
  vi.spyOn(cloud, "startCloudSpeech").mockRejectedValue(
    new Error("cloud unavailable"),
  );
  const localHandle = capture();
  const offline = vi
    .spyOn(local, "startLocalSpeech")
    .mockResolvedValue(localHandle);
  const error = vi.fn();
  const handle = await startRealtimeSpeech(vi.fn(), error);
  expect(offline).toHaveBeenCalledTimes(1);
  expect(error).not.toHaveBeenCalled();
  await handle.cancel();
  expect(localHandle.cancel).toHaveBeenCalledTimes(1);
});

it("releases a broken cloud session before one local restart, retaining the recording stream and time origin", async () => {
  let now = 10000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const cloudHandle = capture();
  const localHandle = capture();
  const start = vi
    .spyOn(cloud, "startCloudSpeech")
    .mockResolvedValue(cloudHandle);
  const offline = vi
    .spyOn(local, "startLocalSpeech")
    .mockResolvedValue(localHandle);
  const lines = vi.fn();
  const error = vi.fn();
  const activity = vi.fn();
  const interim = vi.fn();
  const stream = {} as MediaStream;
  const handle = await startRealtimeSpeech(
    lines,
    error,
    stream,
    activity,
    interim,
  );
  start.mock.calls[0][0]({ time: 2, text: "cloud words" });
  now += 5000;
  start.mock.calls[0][1]("network lost");
  start.mock.calls[0][1]("duplicate error");
  await vi.waitFor(() => expect(offline).toHaveBeenCalledTimes(1));
  expect(cloudHandle.cancel).toHaveBeenCalledTimes(1);
  expect(offline.mock.calls[0][2]).toBe(stream);
  start.mock.calls[0][0]({ time: 9, text: "stale cloud" });
  start.mock.calls[0][3]?.();
  start.mock.calls[0][4]?.({ time: 9, text: "stale cloud partial" });
  offline.mock.calls[0][4]?.({ time: 0.5, text: "offline partial" });
  expect(interim.mock.calls.map(([line]) => line)).toEqual([
    null,
    { time: 5.5, text: "offline partial" },
  ]);
  offline.mock.calls[0][0]({ time: 1, text: "offline words" });
  expect(lines.mock.calls.map(([line]) => line)).toEqual([
    { time: 2, text: "cloud words" },
    { time: 6, text: "offline words" },
  ]);
  expect(activity).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  await handle.stop();
  expect(localHandle.stop).toHaveBeenCalledTimes(1);
  offline.mock.calls[0][4]?.({ time: 10, text: "late partial" });
  expect(interim).toHaveBeenLastCalledWith(null);
});

it("does not reopen a microphone when cancelled during a delayed cloud failure cleanup", async () => {
  const cloudHandle = capture();
  let release!: () => void;
  cloudHandle.cancel.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const start = vi
    .spyOn(cloud, "startCloudSpeech")
    .mockResolvedValue(cloudHandle);
  const offline = vi.spyOn(local, "startLocalSpeech");
  const lines = vi.fn();
  const handle = await startRealtimeSpeech(lines, vi.fn());
  start.mock.calls[0][1]("offline");
  await vi.waitFor(() => expect(cloudHandle.cancel).toHaveBeenCalledTimes(1));
  const ending = handle.cancel();
  release();
  await ending;
  expect(offline).not.toHaveBeenCalled();
  start.mock.calls[0][0]({ time: 3, text: "cancelled" });
  expect(lines).not.toHaveBeenCalled();
});

it("uses local directly when explicitly selected and reports its terminal runtime error once", async () => {
  saveSettings({ ...defaults, speech: "local" }, false);
  const localHandle = capture();
  const offline = vi
    .spyOn(local, "startLocalSpeech")
    .mockResolvedValue(localHandle);
  const start = vi.spyOn(cloud, "startCloudSpeech");
  const error = vi.fn();
  const handle = await startRealtimeSpeech(vi.fn(), error);
  offline.mock.calls[0][1]("local microphone lost");
  expect(error).toHaveBeenCalledWith("local microphone lost");
  expect(start).not.toHaveBeenCalled();
  await handle.cancel();
});
