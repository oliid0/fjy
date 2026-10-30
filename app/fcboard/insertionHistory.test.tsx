import { waitFor } from "@testing-library/react";
import { Fcboard, CaptureUpdateAction } from "@fcboard/fcboard";

import { newFreeDrawElement } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";

import { Keyboard } from "@fcboard/fcboard/tests/helpers/ui";
import { act, fireEvent, render } from "@fcboard/fcboard/tests/test-utils";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import {
  insertionDefaults,
  renderInsertion,
  readInsertions,
} from "./insertObjects";
import { observeInkAssistance } from "./inkAssistance";
import * as ocr from "./ocr";

it.each([false, true])(
  "commits one table stroke and its cell growth in one undo with unified toolbar %s",
  async (unifiedToolbar) => {
    let api!: FcboardImperativeAPI;
    const view = await render(
      <Fcboard
        handleKeyboardGlobally
        UIOptions={{ unifiedToolbar }}
        onMount={({ excalidrawAPI }) => {
          api = excalidrawAPI;
        }}
      />,
    );
    let release = () => {};
    try {
      await act(async () => {
        await renderInsertion(
          api,
          insertionDefaults("table", { x: 100, y: 100 }),
        );
        api.setActiveTool({ type: "freedraw" });
      });
      const body = api
        .getSceneElements()
        .find((element) => element.type === "rectangle")!;
      release = observeInkAssistance(api, vi.fn(), vi.fn());
      const canvas = view.container.querySelector("canvas.interactive")!;
      const pointer = (
        type: string,
        x: number,
        y: number,
        extra: Record<string, unknown> = {},
      ) =>
        fireEvent(
          canvas,
          Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
            clientX: x,
            clientY: y,
            pointerId: 1,
            pointerType: "pen",
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            pressure: type === "pointerup" ? 0 : 0.6,
            width: 1,
            height: 1,
            ...extra,
          }),
        );
      pointer("pointerdown", body.x + 25, body.y + 25);
      pointer("pointermove", body.x + 200, body.y + 70);
      if (unifiedToolbar) {
        pointer("pointerdown", 800, 400, { pointerId: 2, isPrimary: false });
        pointer("pointermove", 820, 420, { pointerId: 2, isPrimary: false });
      }
      pointer("pointerup", body.x + 250, body.y + 115, {
        getCoalescedEvents: () => [
          { clientX: body.x + 240, clientY: body.y + 105, pressure: 0.3 },
        ],
      });
      const ink = api
        .getSceneElements()
        .find((element) => element.type === "freedraw")!;
      expect(readInsertions(api)[0].width).toBe(510);
      expect(
        api.getSceneElements().find((element) => element.id === ink.id)
          ?.customData?.fcInsertion.inkCell,
      ).toBe(0);
      expect(ink.type === "freedraw" && ink.points.slice(-2)).toEqual([
        pointFrom(215, 80),
        pointFrom(225, 90),
      ]);
      expect(ink.type === "freedraw" && ink.pressures.slice(-2)).toEqual([
        0.3, 0,
      ]);
      if (unifiedToolbar) {
        pointer("pointerup", 850, 450, { pointerId: 2, isPrimary: false });
        const other = api
          .getSceneElements()
          .find(
            (element) => element.type === "freedraw" && element.id !== ink.id,
          )!;
        Keyboard.undo();
        expect(
          api.getSceneElements().some((element) => element.id === other.id),
        ).toBe(false);
        expect(readInsertions(api)[0].width).toBe(510);
      }
      Keyboard.undo();
      expect(readInsertions(api)[0].width).toBe(360);
      expect(
        api.getSceneElements().some((element) => element.id === ink.id),
      ).toBe(false);
      Keyboard.redo();
      expect(readInsertions(api)[0].width).toBe(510);
      expect(
        api.getSceneElements().find((element) => element.id === ink.id),
      ).toMatchObject({ type: "freedraw", points: ink.points });
    } finally {
      release();
      view.unmount();
    }
  },
);

it("undoes a handwriting conversion in the real editor without losing the surface or restarting recognition", async () => {
  let api!: FcboardImperativeAPI;
  const view = await render(
    <Fcboard
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
  const { getLanguage } = await import("@fcboard/fcboard/i18n");
  let api!: FcboardImperativeAPI;
  const view = await render(
    <Fcboard
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
