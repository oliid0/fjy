import type { FileId } from "@fcboard/element/types";

import { Fcboard } from "../index";
import { getDataURL_sync } from "../data/blob";

import { act, render } from "./test-utils";

it("updates explicit newer file versions without mutating earlier snapshots or accepting stale replacements", async () => {
  await render(<Fcboard />);
  const api = window.h.app.api;
  const fileId = "versioned-file" as FileId;
  const image = (color: string) =>
    getDataURL_sync(
      `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="${color}"/></svg>`,
      "image/svg+xml",
    );
  const original = {
    id: fileId,
    dataURL: image("red"),
    mimeType: "image/svg+xml" as const,
    created: 1,
    version: 1,
  };
  act(() => api.addFiles([original]));
  const snapshot = api.getFiles();
  const before = snapshot[fileId].dataURL;
  const nextVersion = (snapshot[fileId].version ?? 1) + 1;
  act(() =>
    api.addFiles([
      { ...original, dataURL: image("blue"), version: nextVersion },
    ]),
  );
  const latest = api.getFiles()[fileId];
  expect(latest.dataURL).not.toBe(before);
  expect(snapshot[fileId].dataURL).toBe(before);
  expect(Object.keys(api.getFiles())).toEqual([fileId]);
  for (const version of [
    undefined,
    0,
    nextVersion - 1,
    latest.version,
    Infinity,
    NaN,
  ]) {
    act(() =>
      api.addFiles([{ ...original, dataURL: image("green"), version }]),
    );
    expect(api.getFiles()[fileId]).toBe(latest);
  }
});
