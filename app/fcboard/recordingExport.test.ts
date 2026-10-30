import { blobToArrayBuffer } from "@fcboard/fcboard/data/blob";

import {
  prepareRecordingPackage,
  recordingFiles,
  saveRecordingFiles,
} from "./recordingExport";

import type { Recording } from "./recording";

const engine = vi.hoisted(() => ({
  begin: vi.fn(),
  append: vi.fn(),
  complete: vi.fn(),
  save: vi.fn(),
  share: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@capacitor/core", async (original) => ({
  ...(await original<typeof import("@capacitor/core")>()),
  registerPlugin: () => engine,
}));
const recording: Recording = {
  id: "test",
  created: 0,
  duration: 10,
  mode: "screen",
  blob: new Blob([new Uint8Array(300000).fill(7)], { type: "video/webm" }),
  transcript: [{ time: 2, text: "F=ma" }],
  summary: "Acceleration equals force divided by mass.",
};
beforeEach(() => {
  vi.clearAllMocks();
  engine.begin.mockResolvedValue({ id: "export" });
  engine.append.mockResolvedValue(undefined);
  engine.complete.mockResolvedValue(undefined);
  engine.close.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (window as Window & { showDirectoryPicker?: unknown })
    .showDirectoryPicker;
});

it("exports the actual media plus timestamped text and summary", async () => {
  const files = recordingFiles(recording);
  expect(files.map((file) => file.name)).toEqual([
    "Fcboard-test.webm",
    "Fcboard-test-transcript.txt",
    "Fcboard-test-summary.md",
  ]);
  expect(new Uint8Array(await blobToArrayBuffer(files[0]))).toEqual(
    new Uint8Array(300000).fill(7),
  );
  expect(new TextDecoder().decode(await blobToArrayBuffer(files[1]))).toBe(
    "[00:02] F=ma",
  );
  expect(new TextDecoder().decode(await blobToArrayBuffer(files[2]))).toBe(
    recording.summary,
  );
});
it("uploads bounded chunks in order before allowing native save or share", async () => {
  const item = await prepareRecordingPackage(
    recording,
    new AbortController().signal,
  );
  expect(engine.append.mock.calls.map(([chunk]) => chunk.offset)).toEqual([
    0, 262144,
  ]);
  expect(
    engine.append.mock.calls.every(([chunk]) => chunk.data.length <= 350000),
  ).toBe(true);
  expect(engine.complete).toHaveBeenCalledWith({ id: "export" });
  await item.save();
  await item.share();
  await item.close();
  expect(engine.save).toHaveBeenCalledWith({ id: "export" });
  expect(engine.share).toHaveBeenCalledWith({ id: "export" });
});
it("discards a cancelled partial native export instead of completing it", async () => {
  const controller = new AbortController();
  engine.append.mockImplementation(async () => controller.abort());
  await expect(
    prepareRecordingPackage(recording, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(engine.append).toHaveBeenCalledTimes(1);
  expect(engine.complete).not.toHaveBeenCalled();
  expect(engine.close).toHaveBeenCalledWith({ id: "export" });
});
it("writes all three files after one directory choice", async () => {
  const output = {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
  };
  const directory = {
    getFileHandle: vi
      .fn()
      .mockResolvedValue({ createWritable: vi.fn().mockResolvedValue(output) }),
  };
  const picker = vi.fn().mockResolvedValue(directory);
  Object.assign(window, { showDirectoryPicker: picker });
  await saveRecordingFiles(recording);
  expect(picker).toHaveBeenCalledTimes(1);
  expect(directory.getFileHandle).toHaveBeenCalledTimes(3);
  expect(output.write.mock.calls.map(([file]) => file.name)).toEqual(
    recordingFiles(recording).map((file) => file.name),
  );
  expect(output.close).toHaveBeenCalledTimes(3);
});
