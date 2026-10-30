import { Fcboard } from "@fcboard/fcboard";

import { act, render } from "@fcboard/fcboard/tests/test-utils";
import { Keyboard } from "@fcboard/fcboard/tests/helpers/ui";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { registerCanvasCommands } from "./canvasCommands";
import { classroomCommands } from "./commands";
import { updateQuestionAnswer } from "./questionAnswer";
import { handwritingText } from "./handwriting";

it("undoes mixed raw and dictated question writing as one real editor transaction", async () => {
  let api!: FcboardImperativeAPI;
  const view = await render(
    <Fcboard
      handleKeyboardGlobally
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const release = registerCanvasCommands(api);
  try {
    let ids: string[] = [];
    await act(async () => {
      const result = (await classroomCommands.execute({
        name: "canvas.ink",
        args: {
          strokes: [
            [
              [100, 100],
              [130, 130],
            ],
          ],
          text: "voice",
          bounds: { left: 90, top: 90, right: 690, bottom: 300 },
          select: false,
        },
      })) as { ids: string[] };
      ids = result.ids;
    });
    const question = [...api.getSceneElements()];
    expect(question.length).toBeGreaterThan(1);
    expect(handwritingText(question)).toEqual(["voice"]);
    expect(new Set(question.map((item) => item.groupIds[0])).size).toBe(1);
    Keyboard.undo();
    expect(api.getSceneElements()).toHaveLength(0);
    Keyboard.redo();
    expect(api.getSceneElements().map((item) => item.id)).toEqual(ids);
    expect(handwritingText(api.getSceneElements())).toEqual(["voice"]);
  } finally {
    release();
    view.unmount();
  }
});

it("undoes the visible answer directly and restores its fold controls on redo", async () => {
  let api!: FcboardImperativeAPI;
  const view = await render(
    <Fcboard
      handleKeyboardGlobally
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const release = registerCanvasCommands(api);
  try {
    let question!: { ids: string[] };
    await act(async () => {
      question = (await classroomCommands.execute({
        name: "canvas.ink",
        args: {
          strokes: [
            [
              [100, 100],
              [130, 130],
            ],
          ],
          select: false,
        },
      })) as { ids: string[] };
    });
    await act(async () => {
      await classroomCommands.execute({
        name: "canvas.text",
        args: { text: "answer", sourceIds: question.ids },
      });
    });
    const answers = api
      .getSceneElements()
      .filter((item) => !question.ids.includes(item.id))
      .map((item) => item.id);
    await act(async () => {
      await updateQuestionAnswer(api, question.ids[0], answers);
    });
    Keyboard.undo();
    expect(api.getSceneElements().map((item) => item.id)).toEqual(question.ids);
    Keyboard.redo();
    expect(
      api.getSceneElements().filter((item) => answers.includes(item.id)),
    ).toHaveLength(answers.length);
    await act(async () => {
      await updateQuestionAnswer(api, question.ids[0]);
    });
    expect(api.getSceneElements().map((item) => item.id)).toEqual(question.ids);
    Keyboard.undo();
    expect(
      api.getSceneElements().filter((item) => answers.includes(item.id)),
    ).toHaveLength(answers.length);
  } finally {
    release();
    view.unmount();
  }
});
