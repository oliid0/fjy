import { FONT_FAMILY, toBrandedType } from "@fcboard/common";
import { newTextElement } from "@fcboard/element";
import { t } from "@fcboard/fcboard/i18n";

import type { FcboardTextElement } from "@fcboard/element/types";
import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { classroomCommands } from "./commands";
import { recognizeEmojiInk } from "./digitalInk";
import { insertElements } from "./board";
import { selectionSignature } from "./selection";

import type { ImagePlacement } from "./imageGeneration";
import type { InkInput } from "./digitalInk";
import type { ContentRect } from "./placement";

export type MagicChoice = { kind: "emoji"; text: string };
export type MagicCandidateInput = {
  candidates: readonly string[];
  loadCandidates?: (signal: AbortSignal) => Promise<readonly string[]>;
  bounds: ContentRect;
  signal: AbortSignal;
};

/** draw/mode/d.U consumes every real EMOJI candidate, excluding U+1F595. */
export const magicEmojiCandidates = (values: readonly unknown[]) =>
  [
    ...new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" &&
          value.length <= 40 &&
          /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/u.test(
            value,
          ) &&
          !value.includes("\u{1f595}"),
      ),
    ),
  ].slice(0, 30);

export const chooseMagicCandidate = (input: MagicCandidateInput) => {
  input.signal.throwIfAborted();
  return classroomCommands.execute({
    name: "magic.candidates",
    args: { ...input },
  }) as Promise<MagicChoice>;
};

/** Recognize real emoji candidates; no image generation is started. */
export const insertMagicInk = async (
  api: FcboardImperativeAPI,
  strokes: InkInput,
  signal: AbortSignal,
  placement: ImagePlacement & {
    bounds: ContentRect;
    clientBounds?: ContentRect;
    opacity?: number;
  },
  current: () => boolean,
) => {
  signal.throwIfAborted();
  const revision = classroomCommands.revision;
  const onDocument = classroomCommands.has("document.draw");
  let candidates: string[] = [];
  if (!current()) {
    throw new DOMException("Magic ink changed", "AbortError");
  }
  const state = api.getAppState();
  const bounds = placement.bounds;
  const zoom = state.zoom.value;
  const clientBounds = placement.clientBounds || {
    left: (bounds.left + state.scrollX) * zoom + (state.offsetLeft || 0),
    right: (bounds.right + state.scrollX) * zoom + (state.offsetLeft || 0),
    top: (bounds.top + state.scrollY) * zoom + (state.offsetTop || 0),
    bottom: (bounds.bottom + state.scrollY) * zoom + (state.offsetTop || 0),
  };
  const choice = await chooseMagicCandidate({
    candidates,
    loadCandidates: async (candidateSignal) => {
      candidates = magicEmojiCandidates(
        await recognizeEmojiInk(strokes, candidateSignal),
      );
      return candidates;
    },
    bounds: clientBounds,
    signal,
  });
  signal.throwIfAborted();
  if (
    !current() ||
    revision !== classroomCommands.revision ||
    onDocument !== classroomCommands.has("document.draw")
  ) {
    throw new DOMException("Magic ink changed", "AbortError");
  }
  if (!candidates.includes(choice.text)) {
    throw new Error("Invalid emoji choice");
  }
  if (
    !onDocument &&
    placement.sourceSignature &&
    selectionSignature(
      api
        .getSceneElements()
        .filter((element) => placement.replaceIds?.includes(element.id)),
    ) !== placement.sourceSignature
  ) {
    throw new DOMException("Magic ink changed", "AbortError");
  }
  const size = Math.max(
    1,
    Math.min(bounds.right - bounds.left, bounds.bottom - bounds.top),
  );
  const style = {
    x: bounds.left,
    y: bounds.top,
    text: choice.text,
    fontFamily: FONT_FAMILY.Helvetica,
    lineHeight: toBrandedType<FcboardTextElement["lineHeight"]>(1),
    strokeColor: "#000000",
    opacity: placement.opacity ?? 100,
    customData: { fcRecognizedSource: placement.replaceIds },
  };
  let emoji = newTextElement({ ...style, fontSize: size });
  // TextShape.getTextSize fits compound/flag emoji as well as a single glyph.
  const fit = Math.min(
    1,
    (bounds.right - bounds.left) / Math.max(1, emoji.width),
    (bounds.bottom - bounds.top) / Math.max(1, emoji.height),
  );
  if (fit > 0 && fit < 1) {
    emoji = newTextElement({ ...style, fontSize: size * fit });
  }
  const shape = {
    ...emoji,
    x: (bounds.left + bounds.right - emoji.width) / 2,
    y: (bounds.top + bounds.bottom - emoji.height) / 2,
  };
  if (onDocument) {
    await classroomCommands.execute({
      name: "document.draw",
      args: {
        lesson: "magic",
        progress: 1,
        shape,
        replaceIds: placement.replaceIds,
        sourceSignature: placement.sourceSignature,
        sourcePage: placement.sourcePage,
        signal,
      },
    });
  } else {
    insertElements(api, [shape], placement.replaceIds);
  }
};
