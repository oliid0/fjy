import { FONT_FAMILY, toBrandedType } from "@fcboard/common";
import { newTextElement } from "@fcboard/element";
import { t } from "@fcboard/fcboard/i18n";

import type { FcboardTextElement } from "@fcboard/element/types";
import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { classroomCommands } from "./commands";
import { recognizeEmojiInk } from "./digitalInk";
import { selectionImagePrompt } from "./selectionImagePrompt";
import { generateImage, insertImageResult } from "./imageGeneration";
import { insertElements } from "./board";
import { selectionSignature } from "./selection";
import { currentSettings } from "./settings";

import type { GeneratedImage, ImagePlacement } from "./imageGeneration";
import type { InkInput } from "./digitalInk";
import type { ContentRect } from "./placement";

export type MagicChoice =
  | { kind: "emoji"; text: string }
  | { kind: "image"; image: GeneratedImage };
export type MagicCandidateInput = {
  candidates: readonly string[];
  loadCandidates?: (signal: AbortSignal) => Promise<readonly string[]>;
  bounds: ContentRect;
  signal: AbortSignal;
  generate: (signal: AbortSignal) => Promise<GeneratedImage>;
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

/** Open immediately. Optional emoji recognition is independent; the first cell
 * sends its screenshot straight to the image API and cannot alter source ink. */
export const insertMagicInk = async (
  api: FcboardImperativeAPI,
  capture: () => Promise<string>,
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
  let referenceImage: string | undefined;
  let snapshot: Promise<string> | undefined;
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
    generate: async (request) => {
      const settings = currentSettings();
      if (!settings.apiKey.trim()) {
        throw new Error(
          t(
            "fcboard.set_an_api_key_and_a_vision_model_or_endpoint_id_in_ai_settings",
          ),
        );
      }
      referenceImage = await (snapshot ||= capture());
      request.throwIfAborted();
      if (!referenceImage.startsWith("data:image/")) {
        throw new Error(
          t("fcboard.no_content_recognized_select_the_area_again"),
        );
      }
      return generateImage(selectionImagePrompt("magic"), request, {
        referenceImage,
        transparent: true,
      });
    },
  });
  signal.throwIfAborted();
  if (
    !current() ||
    revision !== classroomCommands.revision ||
    onDocument !== classroomCommands.has("document.draw")
  ) {
    throw new DOMException("Magic ink changed", "AbortError");
  }
  if (choice.kind === "image") {
    await insertImageResult(api, choice.image, signal, {
      ...placement,
      referenceImage,
    });
    return;
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
