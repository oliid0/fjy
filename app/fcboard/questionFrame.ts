import {
  CaptureUpdateAction,
  convertToFcboardElements,
} from "@fcboard/fcboard";
import { getCommonBounds } from "@fcboard/element";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import type { FcboardElementSkeleton } from "@fcboard/element/transform";

import { boardContext } from "./ai";
import { boardInk, clipInk } from "./digitalInk";
import { classroomCommands } from "./commands";
import { documentStrokeBounds, inkSnapshot } from "./documents";
import { questionSurface } from "./questionInk";
import { selectionSignature } from "./selection";

import type { InkStroke } from "./documents";
import type { ContentRect } from "./placement";

export const questionFrames = (api: FcboardImperativeAPI) => {
  const document = classroomCommands.read("document") as
    | { ink: InkStroke[] }
    | undefined;
  return document
    ? (document.ink || [])
        .filter((item) => item.questionFrame)
        .map((item) => ({
          id: item.id,
          bounds: documentStrokeBounds(item),
          version: JSON.stringify(item),
        }))
    : api
        .getSceneElements()
        .filter((item) => !item.isDeleted && item.customData?.fcQuestionFrame)
        .map((item) => {
          const [left, top, right, bottom] = getCommonBounds([item]);
          return {
            id: item.id,
            bounds: { left, top, right, bottom },
            version: String(item.version),
          };
        });
};

/** The border is a normal scene object. Nothing captures pointer events in its interior. */
export const insertQuestionFrame = async (
  api: FcboardImperativeAPI,
  placement: { left: number; top: number; width: number; height: number },
) => {
  const surface = questionSurface(api);
  const [x, y] = surface.point(placement.left, placement.top);
  const shape: FcboardElementSkeleton = {
    type: "rectangle",
    x,
    y,
    width: placement.width / surface.scale,
    height: placement.height / surface.scale,
    strokeColor: "#1976d2",
    backgroundColor: "transparent",
    strokeWidth: 2,
    roughness: 0,
    customData: { fcQuestionFrame: true },
  };
  const element = convertToFcboardElements([shape])[0];
  if (classroomCommands.has("document.draw")) {
    await classroomCommands.execute({
      name: "document.draw",
      args: { lesson: "question-frame", shape: element, progress: 1 },
    });
  } else {
    api.updateScene({
      elements: [...api.getSceneElements(), element],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }
  return element.id;
};

const intersects = (a: ContentRect, b: ContentRect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const contains = (a: ContentRect, b: ContentRect) =>
  a.left <= b.left &&
  a.top <= b.top &&
  a.right >= b.right &&
  a.bottom >= b.bottom;

/** Read at search time, so moving a border changes the prompt without moving any notes. */
export const framedQuestion = (api: FcboardImperativeAPI, id: string) => {
  const frame = questionFrames(api).find((item) => item.id === id);
  if (!frame) {
    throw new DOMException("Question frame removed", "AbortError");
  }
  const region = frame.bounds;
  const document = classroomCommands.read("document") as
    | { ink: InkStroke[] }
    | undefined;
  if (document) {
    const source = (document.ink || []).filter(
      (item) =>
        !item.questionFrame && intersects(region, documentStrokeBounds(item)),
    );
    const clipped = source.flatMap((item) =>
      item.text || item.image || item.resource
        ? contains(region, documentStrokeBounds(item))
          ? [item]
          : []
        : clipInk([item.points], region).map((points) => ({ ...item, points })),
    );
    return {
      ids: source.map((item) => item.id),
      signature: `${frame.version}:${JSON.stringify(source)}`,
      ink: clipped
        .filter((item) => !item.text && !item.image && !item.resource)
        .map((item) => item.points),
      text: clipped
        .filter((item) => item.text)
        .map((item) => item.text!)
        .join("\n"),
      image: () =>
        inkSnapshot(clipped, region.bottom - region.top, undefined, region.top),
      hasContent: !!clipped.length,
    };
  }
  const source = api.getSceneElements().filter((item) => {
    if (item.isDeleted || item.customData?.fcQuestionFrame) {
      return false;
    }
    const [left, top, right, bottom] = getCommonBounds([item]);
    return intersects(region, { left, top, right, bottom });
  });
  const ink = clipInk(
    boardInk(source.filter((item) => item.type === "freedraw")),
    region,
  );
  const text = source
    .filter((item) => {
      const [left, top, right, bottom] = getCommonBounds([item]);
      return (
        item.type === "text" && contains(region, { left, top, right, bottom })
      );
    })
    .map((item) => (item.type === "text" ? item.originalText : ""))
    .join("\n");
  return {
    ids: source.map((item) => item.id),
    signature: `${frame.version}:${selectionSignature(source)}`,
    ink,
    text,
    image: async () =>
      (await boardContext(api, false, source, region)).image || "",
    hasContent: !!source.length,
  };
};
