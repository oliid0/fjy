import { IMAGE_MIME_TYPES } from "@fcboard/common/constants";

const images: Record<string, string> = {
  ...IMAGE_MIME_TYPES,
  jpeg: IMAGE_MIME_TYPES.jpg,
  jepg: IMAGE_MIME_TYPES.jpg,
};
const playback: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  m4v: "video/mp4",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  flac: "audio/flac",
  opus: "audio/opus",
  wma: "audio/x-ms-wma",
};
const board = ["bzd", "bz", "bnf"];
const documents = [
  "ppt",
  "pptx",
  "pps",
  "ppsx",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "odt",
  "ods",
  "odp",
  "rtf",
  "txt",
];

/** Pass the same extension table to the Android picker. Known extensions take
 * precedence over generic or incorrect MIME values from file providers. */
export const openFileTypes = {
  ...Object.fromEntries(
    [...board, ...documents].map((ext) => [ext, "application/octet-stream"]),
  ),
  ...images,
  ...playback,
};
export const OPEN_ACCEPT = Object.keys(openFileTypes).map((ext) => `.${ext}`);

type FileInfo = Pick<File, "name" | "type">;
const extension = (name: string) =>
  name.includes(".") ? name.split(".").at(-1)!.toLowerCase() : "";
const mappedType = (types: Record<string, string>, name: string) => {
  const ext = extension(name);
  return Object.hasOwn(types, ext) ? types[ext] : "";
};
export const imageFileType = (file: FileInfo) =>
  mappedType(images, file.name) ||
  (Object.values(images).includes(file.type) ? file.type : "");
export const mediaFileType = (file: FileInfo) =>
  mappedType(playback, file.name) ||
  (/^(audio|video)\//.test(file.type) ? file.type : "");
export const boardFileKind = (file: FileInfo) => {
  const ext = extension(file.name);
  if (board.includes(ext)) {
    return "board";
  }
  if (documents.includes(ext)) {
    return "document";
  }
  if (mappedType(images, file.name)) {
    return "image";
  }
  if (mappedType(playback, file.name)) {
    return "playback";
  }
  if (imageFileType(file)) {
    return "image";
  }
  if (mediaFileType(file)) {
    return "playback";
  }
  return undefined;
};
