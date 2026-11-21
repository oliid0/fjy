import type {
  AppClassProperties,
  BinaryFiles,
  DataURL,
} from "@fcboard/fcboard/types";

import { updateImageCache } from "../src/image";

import type { FileId } from "../src/types";

const fileId = "versioned-function" as FileId;
let images: HTMLImageElement[];
beforeEach(() => {
  images = [];
  vi.stubGlobal(
    "Image",
    vi.fn(() => {
      const image = document.createElement("img");
      images.push(image);
      return image;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const load = (
  imageCache: AppClassProperties["imageCache"],
  version: number,
) => {
  const files: BinaryFiles = {
    [fileId]: {
      id: fileId,
      mimeType: "image/svg+xml",
      dataURL: `data:image/svg+xml,version-${version}` as DataURL,
      created: 1,
      version,
    },
  };
  return updateImageCache({ fileIds: [fileId], files, imageCache });
};

it("keeps the last decoded pixels visible while the next version loads", async () => {
  const cache: AppClassProperties["imageCache"] = new Map();
  const original = document.createElement("img");
  cache.set(fileId, { image: original, mimeType: "image/svg+xml" });
  const pending = load(cache, 2);
  expect(cache.get(fileId)?.image).toBe(original);
  images[0].dispatchEvent(new Event("load"));
  await pending;
  expect(cache.get(fileId)?.image).toBe(images[0]);
});

it.each(["load", "error"])(
  "ignores an old decode's late %s after newer pixels are ready",
  async (event) => {
    const cache: AppClassProperties["imageCache"] = new Map();
    const old = load(cache, 1);
    const latest = load(cache, 2);
    images[1].dispatchEvent(new Event("load"));
    await latest;
    images[0].dispatchEvent(new Event(event));
    const result = await old;
    expect(cache.get(fileId)?.image).toBe(images[1]);
    expect(result.erroredFiles.size).toBe(0);
  },
);

it("does not reinsert a decoded image after its cache entry is removed", async () => {
  const cache: AppClassProperties["imageCache"] = new Map();
  const pending = load(cache, 1);
  cache.clear();
  images[0].dispatchEvent(new Event("load"));
  await pending;
  expect(cache.size).toBe(0);
});

it("still reports a real failure of the current version", async () => {
  const cache: AppClassProperties["imageCache"] = new Map();
  const pending = load(cache, 2);
  images[0].dispatchEvent(new Event("error"));
  expect((await pending).erroredFiles.has(fileId)).toBe(true);
});
