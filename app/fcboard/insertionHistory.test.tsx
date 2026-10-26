import { waitFor } from "@testing-library/react";
import { Excalidraw, CaptureUpdateAction } from "@excalidraw/excalidraw";
import { act, render } from "@excalidraw/excalidraw/tests/test-utils";
import { Keyboard } from "@excalidraw/excalidraw/tests/helpers/ui";
import { newFreeDrawElement } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  insertionDefaults,
  renderInsertion,
  readInsertions,
} from "./insertObjects";
import { observeInkAssistance } from "./inkAssistance";
import * as ocr from "./ocr";

it("undoes a handwriting conversion in the real editor without losing the surface or restarting recognition", async () => {
  let api!: ExcalidrawImperativeAPI;
  const view = await render(
    <Excalidraw
      handleKeyboardGlobally
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const recognize = vi
    .spyOn(ocr, "recognizeHandwriting")
    .mockResolvedValue("Hello");
  let release = () => {};
  try {
    await act(async () => {
      await renderInsertion(
        api,
        insertionDefaults("fourline", { x: 100, y: 100 }),
      );
      api.setActiveTool({ type: "freedraw" });
    });
    const body = api
      .getSceneElements()
      .find((item) => item.type === "rectangle")!;
    release = observeInkAssistance(api, vi.fn(), vi.fn());
    const ink = newFreeDrawElement({
      type: "freedraw",
      x: body.x + 12,
      y: body.y + 12,
      points: [pointFrom(0, 0), pointFrom(40, 30)],
      simulatePressure: true,
    });
    await act(async () => {
      api.updateScene({
        elements: [...api.getSceneElements(), ink],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });
    await waitFor(() => expect(readInsertions(api)[0].text).toBe("Hello"), {
      timeout: 2000,
    });
    expect(api.getSceneElements().some((item) => item.id === ink.id)).toBe(
      false,
    );
    Keyboard.undo();
    expect(api.getSceneElements().some((item) => item.id === ink.id)).toBe(
      true,
    );
    expect(api.getSceneElements().some((item) => item.id === body.id)).toBe(
      true,
    );
    expect(readInsertions(api)[0].text).toBeUndefined();
    Keyboard.redo();
    expect(readInsertions(api)[0].text).toBe("Hello");
    expect(recognize).toHaveBeenCalledTimes(1);
  } finally {
    release();
    recognize.mockRestore();
    view.unmount();
  }
});

it("undoes a language translation and its metadata together while preserving the original ink", async () => {
  const { languageStudy } = await import("./test/language");
  const ai = await import("./ai");
  const { readLanguageCard } = await import("./LanguagePanel");
  const { getLanguage } = await import("@excalidraw/excalidraw/i18n");
  let api!: ExcalidrawImperativeAPI;
  const view = await render(
    <Excalidraw
      handleKeyboardGlobally
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const recognize = vi
    .spyOn(ocr, "recognizeHandwriting")
    .mockResolvedValue(languageStudy.term);
  const chat = vi
    .spyOn(ai, "chat")
    .mockResolvedValue(
      JSON.stringify({ ...languageStudy, translation: "Hello." }),
    );
  let release = () => {};
  try {
    await act(async () => {
      api.setActiveTool({ type: "freedraw" });
      api.updateScene({ appState: { currentItemInkAssist: "language" } });
    });
    release = observeInkAssistance(api, vi.fn(), vi.fn());
    const ink = newFreeDrawElement({
      type: "freedraw",
      x: 100,
      y: 100,
      points: [pointFrom(0, 0), pointFrom(40, 30)],
      simulatePressure: true,
      customData: { fcInk: { version: 2, pen: "hard", assist: "language" } },
    });
    await act(async () => {
      api.updateScene({
        elements: [ink],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });
    await waitFor(
      () =>
        expect(readLanguageCard(api, ink.id)?.study.translation).toBe("Hello."),
      { timeout: 2500 },
    );
    const translated = api
      .getSceneElements()
      .filter((item) => item.id !== ink.id)
      .map((item) => item.id);
    expect(translated.length).toBeGreaterThan(0);
    expect(
      api.getSceneElements().find((item) => item.id === ink.id)?.customData
        ?.fcLanguage.targetLanguage,
    ).toBe(getLanguage().code);
    Keyboard.undo();
    expect(api.getSceneElements().map((item) => item.id)).toEqual([ink.id]);
    expect(api.getSceneElements()[0].customData?.fcLanguage).toBeUndefined();
    Keyboard.redo();
    expect(readLanguageCard(api, ink.id)?.study.translation).toBe("Hello.");
    expect(
      api
        .getSceneElements()
        .filter((item) => item.id !== ink.id)
        .map((item) => item.id),
    ).toEqual(translated);
    expect(chat).toHaveBeenCalledTimes(1);
  } finally {
    release();
    recognize.mockRestore();
    chat.mockRestore();
    view.unmount();
  }
});
