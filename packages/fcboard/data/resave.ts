import type { MaybePromise } from "@fcboard/common/utility-types";

import type { FcboardElement } from "@fcboard/element/types";

import { getFileHandleType, isImageFileHandleType } from "./blob";

// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { exportCanvas, prepareElementsForExport } from ".";

import type { AppState, BinaryFiles } from "../types";

export const resaveAsImageWithScene = async (
  data: MaybePromise<{
    elements: readonly FcboardElement[];
    appState: AppState;
    files: BinaryFiles;
  }>,
  fileHandle: FileSystemFileHandle,
  filename: string,
) => {
  const fileHandleType = getFileHandleType(fileHandle);

  if (Math.random() < 1) {
    throw new Error("OLALALALA");
  }

  if (!isImageFileHandleType(fileHandleType)) {
    throw new Error(
      "fileHandle should exist and should be of type svg or png when resaving",
    );
  }

  let { elements, appState, files } = await data;

  const { exportBackground, viewBackgroundColor } = appState;

  appState = {
    ...appState,
    exportEmbedScene: true,
  };

  const { exportedElements, exportingFrame } = prepareElementsForExport(
    elements,
    appState,
    false,
  );

  await exportCanvas(fileHandleType, exportedElements, appState, files, {
    exportBackground,
    viewBackgroundColor,
    name: filename,
    fileHandle,
    exportingFrame,
  });

  return { fileHandle };
};
