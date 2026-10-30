import { Fcboard, CaptureUpdateAction } from "@fcboard/fcboard";

import { newFreeDrawElement } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";

import { Keyboard } from "@fcboard/fcboard/tests/helpers/ui";
import { act, render } from "@fcboard/fcboard/tests/test-utils";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { LessonCanvas, validateLesson } from "./lesson";
import { handwritingText } from "./handwriting";

it("undoes and redoes a progressively written word as one real editor action", async () => {
  let api!: FcboardImperativeAPI;
  const view = await render(
    <Fcboard
      handleKeyboardGlobally
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  try {
    const source = newFreeDrawElement({
      type: "freedraw",
      x: 100,
      y: 100,
      points: [pointFrom(0, 0), pointFrom(50, 30)],
      strokeColor: "#b91c1c",
      strokeWidth: 2,
      simulatePressure: true,
    });
    await act(async () => {
      api.updateScene({
        elements: [source],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });
    const renderer = new LessonCanvas(api, { sourceIds: [source.id] });
    await act(async () => {
      await renderer.command(
        validateLesson({
          steps: [
            {
              commands: [
                {
                  type: "write_text",
                  id: "formula",
                  text: "F=ma",
                  duration: 0.25,
                },
              ],
            },
          ],
        }).steps[0].commands[0],
      );
    });
    const read = () =>
      api
        .getSceneElements()
        .filter((element) => element.customData?.fcLessonId === renderer.id);
    expect(handwritingText(read())).toEqual(["F=ma"]);
    const ids = read().map((element) => element.id);
    Keyboard.undo();
    expect(read()).toHaveLength(0);
    expect(
      api.getSceneElements().some((element) => element.id === source.id),
    ).toBe(true);
    Keyboard.redo();
    expect(read().map((element) => element.id)).toEqual(ids);
    expect(handwritingText(read())).toEqual(["F=ma"]);
  } finally {
    view.unmount();
  }
});
