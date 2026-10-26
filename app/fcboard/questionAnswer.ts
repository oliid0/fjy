import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { newElementWith } from "@excalidraw/element";
import { t } from "@excalidraw/excalidraw/i18n";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { classroomCommands } from "./commands";

export type QuestionAnswer<T> = { owner: string; ids: string[]; folded?: T[] };

/** Hidden geometry lives on its question, so saving or undo never loses the answer. */
export const changeQuestionAnswer = <T extends { id: string }>(
  items: readonly T[],
  anchor: string,
  saved: QuestionAnswer<T> | undefined,
  answerIds?: string[],
): { items: readonly T[]; answer: QuestionAnswer<T> } => {
  if (!items.some((item) => item.id === anchor)) {
    throw new DOMException("Question changed", "AbortError");
  }
  if (answerIds) {
    return {
      items,
      answer: {
        owner: anchor,
        ids: items
          .filter((item) => item.id !== anchor && answerIds.includes(item.id))
          .map((item) => item.id),
      },
    };
  }
  if (!saved || saved.owner !== anchor) {
    throw new Error(t("fcboard.no_answer_to_collapse"));
  }
  if (saved.folded) {
    const current = new Set(items.map((item) => item.id));
    return {
      items: [
        ...items,
        ...saved.folded.filter((item) => !current.has(item.id)),
      ],
      answer: { owner: anchor, ids: saved.ids },
    };
  }
  const ids = new Set(saved.ids);
  const folded = items.filter((item) => ids.has(item.id));
  return {
    items: items.filter((item) => !ids.has(item.id)),
    answer: { owner: anchor, ids: folded.map((item) => item.id), folded },
  };
};

export const visibleObjectIds = (api: ExcalidrawImperativeAPI) => {
  const document = classroomCommands.read("document") as
    | { ink: { id: string }[] }
    | undefined;
  return (document ? document.ink || [] : api.getSceneElements()).map(
    (item) => item.id,
  );
};

export const updateQuestionAnswer = async (
  api: ExcalidrawImperativeAPI,
  anchor: string,
  ids?: string[],
) => {
  if (classroomCommands.has("document.draw")) {
    return classroomCommands.execute({
      name: "document.answer",
      args: { anchor, ids },
    }) as Promise<{ collapsed: boolean; count: number }>;
  }
  const current = api.getSceneElements();
  const source = current.find((item) => item.id === anchor);
  const next = changeQuestionAnswer(
    current,
    anchor,
    source?.customData?.fcQuestionAnswer as
      | QuestionAnswer<ExcalidrawElement>
      | undefined,
    ids,
  );
  api.updateScene({
    elements: next.items.map((item) =>
      item.id === anchor
        ? newElementWith(item, {
            customData: { ...item.customData, fcQuestionAnswer: next.answer },
          })
        : item,
    ),
    captureUpdate: ids
      ? CaptureUpdateAction.EVENTUALLY
      : CaptureUpdateAction.IMMEDIATELY,
  });
  return { collapsed: !!next.answer.folded, count: next.answer.ids.length };
};
