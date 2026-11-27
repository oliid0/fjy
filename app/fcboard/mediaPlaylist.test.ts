import { Capacitor } from "@capacitor/core";
import { getDataURL } from "@fcboard/fcboard/data/blob";

import {
  exportMediaFiles,
  importMediaFiles,
  readMediaFiles,
  saveMediaFiles,
} from "./mediaPlaylist";

const stored = vi.hoisted(() => new Map<string, File[]>());
vi.mock("idb-keyval", () => ({
  createStore: () => ({}),
  get: async (key: string) => stored.get(key),
  set: async (key: string, value: File[]) => {
    stored.set(key, value);
  },
}));
beforeEach(() => {
  stored.clear();
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
});
afterEach(() => vi.restoreAllMocks());
it("embeds actual media bytes and restores independent keys without replacing the existing playlist", async () => {
  const files = [
    new File([new Uint8Array([0, 1, 2, 255])], "movie.mp4", {
      type: "video/mp4",
    }),
    new File(["audio"], "voice.wav", { type: "audio/wav" }),
  ];
  await saveMediaFiles("original", files);
  const packed = await exportMediaFiles(["original", "original"]);
  expect(packed.original).toHaveLength(2);
  const keys = new Map<string, string>();
  await importMediaFiles(packed, keys);
  const key = keys.get("original")!;
  expect(key).not.toBe("original");
  expect(await readMediaFiles("original")).toBe(files);
  const restored = await readMediaFiles(key);
  expect(restored!.map((file) => [file.name, file.type, file.size])).toEqual(
    files.map((file) => [file.name, file.type, file.size]),
  );
  expect(await getDataURL(restored![0])).toBe(packed.original[0].dataURL);
  expect(await exportMediaFiles([key])).toEqual({ [key]: packed.original });
});
it("refuses a save with missing media and rejects invalid embedded content", async () => {
  await expect(exportMediaFiles(["missing"])).rejects.toThrow("missing");
  await expect(
    importMediaFiles(
      {
        bad: [
          {
            name: "bad.html",
            type: "text/html",
            dataURL: "data:text/html;base64,WA==",
          },
        ],
      },
      new Map(),
    ),
  ).rejects.toThrow("Invalid BZD media");
  const request = new AbortController();
  request.abort();
  await expect(
    exportMediaFiles(["missing"], request.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});
