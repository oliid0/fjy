import { Capacitor } from "@capacitor/core";
import { fileOpen, fileSave } from "browser-fs-access";
import { convertToFcboardElements } from "@fcboard/fcboard";
import { waitFor } from "@testing-library/react";

import type { DataURL } from "@fcboard/fcboard/types";

import {
  pickBoardFile,
  pickImageFile,
  openBoardFile,
  saveBoardFile,
  savePageFiles,
} from "./boardFile";

import type { Board } from "./boards";

const engine = vi.hoisted(() => ({
  begin: vi.fn(),
  append: vi.fn(),
  save: vi.fn(),
  choose: vi.fn(),
  read: vi.fn(),
  readAsset: vi.fn(),
  close: vi.fn(),
  cancelBrowser: vi.fn(),
}));
vi.mock("@capacitor/core", async (original) => {
  const actual = await original<typeof import("@capacitor/core")>();
  return {
    ...actual,
    registerPlugin: (
      name: string,
      implementation?: Parameters<typeof actual.registerPlugin>[1],
    ) =>
      name === "FcboardBoardFile"
        ? engine
        : actual.registerPlugin(name, implementation),
  };
});
vi.mock("browser-fs-access", () => ({ fileOpen: vi.fn(), fileSave: vi.fn() }));
const page = (): Board => ({
  id: "one",
  name: "原版课件",
  elements: convertToFcboardElements([
    { type: "text", x: 20, y: 30, text: "牛顿定律" },
  ]),
  files: {},
  view: {
    scrollX: 0,
    scrollY: 0,
    zoom: { value: 1 as Board["view"]["zoom"]["value"] },
    viewBackgroundColor: "#000000",
  },
  updated: 1,
});
const readText = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(file);
  });
beforeEach(() => {
  Object.values(engine).forEach((mock) => mock.mockReset());
  engine.close.mockResolvedValue(undefined);
  engine.cancelBrowser.mockResolvedValue({ cancelled: true });
  engine.begin.mockResolvedValue({ id: "save-one" });
  engine.append.mockResolvedValue(undefined);
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("uses the original image mode and preserves binary bytes and MIME through native chunked reads", async () => {
  const bytes = [137, 80, 78, 71, 0, 255, 128];
  engine.choose.mockResolvedValue({
    id: "image-one",
    name: "课堂.png",
    size: bytes.length,
    mimeType: "image/png",
  });
  engine.read.mockResolvedValue({
    data: btoa(String.fromCharCode(...bytes)),
    next: bytes.length,
  });
  const image = await pickImageFile();
  expect(engine.choose).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "image", language: "en" }),
  );
  expect(image).toMatchObject({
    name: "课堂.png",
    type: "image/png",
    size: bytes.length,
  });
  const result = await new Promise<ArrayBuffer>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(image!);
  });
  expect(Array.from(new Uint8Array(result))).toEqual(bytes);
  expect(engine.close).toHaveBeenCalledWith({ id: "image-one" });
});

it("does not return a selected image when its surface changes during final native cleanup", async () => {
  const request = new AbortController();
  engine.choose.mockResolvedValue({
    id: "image-one",
    name: "课堂.png",
    size: 1,
    mimeType: "image/png",
  });
  engine.read.mockResolvedValue({ data: "YQ==", next: 1 });
  engine.close.mockImplementation(async () => {
    request.abort();
  });
  await expect(pickImageFile(request.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(engine.close).toHaveBeenCalledWith({ id: "image-one" });
});

it("stages all selected page files once with original page indices and bounded binary chunks", async () => {
  const first = new Blob(["a".repeat(270000)], { type: "image/jpeg" });
  const second = new Blob(["second page"], { type: "image/jpeg" });
  engine.save.mockResolvedValue({
    saved: true,
    uri: "file:///Whiteboard/pdf/课堂.pdf",
  });
  expect(
    await savePageFiles(
      [
        { page: 3, blob: first },
        { page: 12, blob: second },
      ],
      "课堂",
      "pdf",
    ),
  ).toBe(true);
  expect(engine.begin).toHaveBeenCalledWith({
    size: first.size + second.size,
    kind: "pdf",
    pages: [
      { page: 3, size: first.size },
      { page: 12, size: second.size },
    ],
  });
  const chunks = engine.append.mock.calls.map(([chunk]) => chunk);
  expect(chunks.map((chunk) => chunk.offset)).toEqual([0, 262144]);
  expect(chunks.map((chunk) => atob(chunk.data)).join("")).toBe(
    `${"a".repeat(270000)}second page`,
  );
  expect(engine.save).toHaveBeenCalledTimes(1);
  expect(engine.close).toHaveBeenCalledWith({ id: "save-one" });
});

it("rejects invalid page metadata before staging, and reports cancellation or actual save failure without success", async () => {
  const image = new Blob(["jpeg"], { type: "image/jpeg" });
  for (const pages of [
    [],
    [{ page: 0, blob: image }],
    [
      { page: 3, blob: image },
      { page: 3, blob: image },
    ],
    [{ page: 3, blob: new Blob(["png"], { type: "image/png" }) }],
  ]) {
    await expect(savePageFiles(pages, "课堂", "jpg")).rejects.toThrow();
  }
  expect(engine.begin).not.toHaveBeenCalled();
  engine.save
    .mockResolvedValueOnce({ saved: false })
    .mockRejectedValueOnce(new Error("Storage full"));
  expect(await savePageFiles([{ page: 2, blob: image }], "课堂", "jpg")).toBe(
    false,
  );
  await expect(
    savePageFiles([{ page: 2, blob: image }], "课堂", "jpg"),
  ).rejects.toThrow("Storage full");
  expect(engine.close).toHaveBeenCalledTimes(2);
});

it("uses the same original page numbering in the browser's actual image save fallback", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
  const image = new Blob(["jpeg"], { type: "image/jpeg" });
  vi.mocked(fileSave).mockClear().mockResolvedValue(null);
  expect(
    await savePageFiles(
      [
        { page: 3, blob: image },
        { page: 12, blob: image },
      ],
      "课堂",
      "jpg",
    ),
  ).toBe(true);
  expect(fileSave).toHaveBeenNthCalledWith(
    1,
    image,
    expect.objectContaining({ fileName: "课堂_03.jpg" }),
  );
  expect(fileSave).toHaveBeenNthCalledWith(
    2,
    image,
    expect.objectContaining({ fileName: "课堂_12.jpg" }),
  );
  expect(engine.begin).not.toHaveBeenCalled();
});

it("forwards an original sheared bitmap matrix to native decoding and imports the actual rendered bounds", async () => {
  engine.readAsset.mockResolvedValue({
    dataURL: "data:image/png;base64,YQ==" as DataURL,
    mimeType: "image/png",
    width: 250,
    height: 100,
    bounds: { x: 20, y: 30, width: 250, height: 100 },
  });
  const [board] = await openBoardFile(
    '<bzd><slide><object eType="OBJECT_BITMAP" picUrl="/Whiteboard/picture.png" matrix="1,0.5,20,0,1,30,0,0,1" photoRectRight="200" photoRectBottom="100"><lstPt/></object></slide></bzd>',
  );
  expect(engine.readAsset).toHaveBeenCalledWith({
    path: "/Whiteboard/picture.png",
    transform: [1, 0.5, 20, 0, 1, 30, 0, 0, 1],
  });
  expect(board.elements[0]).toMatchObject({
    type: "image",
    x: 20,
    y: 30,
    width: 250,
    height: 100,
  });
});

it("reads selected native bytes across a multibyte UTF-8 boundary into the real factory XML parser", async () => {
  const xml =
    '<bzd><slide name="牛顿"><object eType="OBJECT_TEXT" text="你好" width="30"><lstPt>10,20,false,</lstPt></object></slide></bzd>';
  const bytes = new TextEncoder().encode(xml);
  const split = bytes.findIndex((byte) => byte > 127) + 1;
  engine.choose.mockResolvedValue({
    id: "read-one",
    name: "课件.bzd",
    size: bytes.length,
  });
  engine.read.mockImplementation(async ({ offset }) => {
    const end = offset === 0 ? split : bytes.length;
    return {
      data: btoa(String.fromCharCode(...bytes.slice(offset, end))),
      next: end,
    };
  });
  const file = await pickBoardFile();
  expect(file?.name).toBe("课件.bzd");
  const [board] = await openBoardFile(await readText(file!));
  expect(board.name).toBe("牛顿");
  expect(board.elements[0]).toMatchObject({
    type: "text",
    text: "你好",
    x: 10,
    y: 20,
  });
  expect(engine.read).toHaveBeenCalledTimes(2);
  expect(engine.close).toHaveBeenCalledWith({ id: "read-one" });
});

it("keeps cancellation distinct from success and rejects broken native reads without leaking the selected file session", async () => {
  engine.choose.mockResolvedValueOnce({ cancelled: true });
  expect(await pickBoardFile()).toBeUndefined();
  expect(engine.read).not.toHaveBeenCalled();
  for (const [size, chunk] of [
    [8, { data: "", next: 0 }],
    [8, { data: "YQ==", next: 8 }],
    [64 * 1024 * 1024 + 1, undefined],
  ] as const) {
    engine.choose.mockResolvedValue({ id: "broken", name: "bad.bzd", size });
    engine.read.mockResolvedValue(chunk);
    await expect(pickBoardFile()).rejects.toThrow();
    expect(engine.close).toHaveBeenLastCalledWith({ id: "broken" });
  }
});

it("cancels only its own native browser request and releases a late selection after abort", async () => {
  let finish!: (value: { id: string; name: string; size: number }) => void;
  engine.choose.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const controller = new AbortController();
  const selecting = pickBoardFile(controller.signal);
  const requestId = engine.choose.mock.calls[0][0].requestId;
  controller.abort();
  expect(engine.cancelBrowser).toHaveBeenCalledWith({ id: requestId });
  finish({ id: "late", name: "课件.bzd", size: 10 });
  await expect(selecting).rejects.toMatchObject({ name: "AbortError" });
  expect(engine.read).not.toHaveBeenCalled();
  expect(engine.close).toHaveBeenCalledWith({ id: "late" });
  const permission = new AbortController();
  engine.choose.mockImplementationOnce(async () => {
    permission.abort();
    throw new Error("Permission denied");
  });
  await expect(pickBoardFile(permission.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
});

it("stages actual BZD XML before opening native save and waits for the true save result, including cancellation and write failure", async () => {
  engine.save
    .mockResolvedValueOnce({ saved: false })
    .mockResolvedValueOnce({ saved: true });
  expect(await saveBoardFile([page()], "课程")).toBe(false);
  const xml = engine.append.mock.calls
    .map(([chunk]) => atob(chunk.data))
    .join("");
  expect(
    new DOMParser().parseFromString(xml, "text/xml").documentElement.tagName,
  ).toBe("bzd");
  expect(engine.begin).toHaveBeenCalledWith({ size: expect.any(Number) });
  expect(engine.close).toHaveBeenCalledWith({ id: "save-one" });
  expect(await saveBoardFile([page()], "课程")).toBe(true);
  engine.append.mockRejectedValueOnce(new Error("Disk full"));
  await expect(saveBoardFile([page()], "课程")).rejects.toThrow("Disk full");
  expect(engine.save).toHaveBeenCalledTimes(2);
  expect(engine.close).toHaveBeenCalledTimes(3);
});

it("cancels an outstanding save dialog using its own staged ID and keeps web file selection and cancellation functional", async () => {
  let finish!: (value: { saved: boolean }) => void;
  engine.save.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const controller = new AbortController();
  const saving = saveBoardFile([page()], "课程", controller.signal);
  await waitFor(() => expect(engine.save).toHaveBeenCalled());
  controller.abort();
  expect(engine.cancelBrowser).toHaveBeenCalledWith({ id: "save-one" });
  finish({ saved: false });
  await expect(saving).rejects.toMatchObject({ name: "AbortError" });
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  vi.mocked(fileOpen).mockRejectedValueOnce(
    new DOMException("cancel", "AbortError"),
  );
  expect(await pickBoardFile()).toBeUndefined();
  vi.mocked(fileSave).mockRejectedValueOnce(
    new DOMException("cancel", "AbortError"),
  );
  expect(await saveBoardFile([page()], "课程")).toBe(false);
});
