import {
  boardFileKind,
  imageFileType,
  mediaFileType,
  OPEN_ACCEPT,
} from "./fileTypes";

it.each([
  ["课件.PDF", "document"],
  ["表格.xlsx", "document"],
  ["表格.xls", "document"],
  ["表格.csv", "document"],
  ["讲义.doc", "document"],
  ["讲义.docx", "document"],
  ["演示.pptx", "document"],
  ["照片.jpeg", "image"],
  ["照片.jepg", "image"],
  ["照片.jpg", "image"],
  ["照片.png", "image"],
  ["影片.mp4", "playback"],
  ["录音.mp3", "playback"],
  ["录音.wav", "playback"],
  ["白板.bzd", "board"],
] as const)("routes %s through the common Open action", (name, kind) => {
  expect(boardFileKind({ name, type: "application/octet-stream" })).toBe(kind);
  expect(OPEN_ACCEPT).toContain(`.${name.split(".").at(-1)!.toLowerCase()}`);
});
it("retains explicit media MIME and infers real video/audio MIME when providers omit it", () => {
  expect(mediaFileType({ name: "a.mp4", type: "" })).toBe("video/mp4");
  expect(
    mediaFileType({ name: "a.mp3", type: "application/octet-stream" }),
  ).toBe("audio/mpeg");
  expect(mediaFileType({ name: "a.wav", type: "" })).toBe("audio/wav");
  expect(mediaFileType({ name: "a.bin", type: "video/webm" })).toBe(
    "video/webm",
  );
  expect(
    boardFileKind({ name: "a.exe", type: "application/octet-stream" }),
  ).toBeUndefined();
});

it("normalizes picker MIME by known extension before considering provider metadata", () => {
  expect(
    imageFileType({ name: "photo.JEPG", type: "application/octet-stream" }),
  ).toBe("image/jpeg");
  expect(mediaFileType({ name: "film.MP4", type: "audio/mp4" })).toBe(
    "video/mp4",
  );
  expect(boardFileKind({ name: "grades.csv", type: "image/png" })).toBe(
    "document",
  );
  expect(boardFileKind({ name: "photo.png", type: "video/mp4" })).toBe("image");
});
