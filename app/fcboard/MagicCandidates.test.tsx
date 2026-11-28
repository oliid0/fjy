import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { newFreeDrawElement } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";
import { t } from "@fcboard/fcboard/i18n";
import { CaptureUpdateAction, Fcboard } from "@fcboard/fcboard";
import { render as renderEditor } from "@fcboard/fcboard/tests/test-utils";
import {
  EditorJotaiProvider,
  editorJotaiStore,
} from "@fcboard/fcboard/editor-jotai";

import type { DataURL } from "@fcboard/fcboard/types";

import { render } from "./test/render";
import { sceneAPI } from "./test/scene";
import { InsertionCandidates } from "./InsertionCandidates";
import { chooseMagicCandidate, insertMagicInk } from "./magicPen";
import { selectionSignature } from "./selection";
import { classroomCommands } from "./commands";
import { defaults, saveSettings } from "./settings";
import * as images from "./imageGeneration";
import * as ai from "./ai";

const native = vi.hoisted(() => vi.fn());
vi.mock("./digitalInk", async (original) => ({
  ...(await original<typeof import("./digitalInk")>()),
  recognizeEmojiInk: native,
}));
const image: images.GeneratedImage = {
  dataURL: "data:image/png;base64,preview" as DataURL,
  mimeType: "image/png",
  width: 100,
  height: 100,
};
const bounds = { left: 100, top: 100, right: 220, bottom: 220 };
beforeEach(() => {
  native.mockResolvedValue(["😊", "🙂", "😄"]);
  saveSettings({ ...defaults, apiKey: "", imageModel: "" }, false);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  native.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});
const sourceAPI = () => {
  const api = sceneAPI();
  const source = newFreeDrawElement({
    type: "freedraw",
    x: 100,
    y: 100,
    points: [pointFrom(0, 0), pointFrom(120, 120)],
    simulatePressure: true,
  });
  api.updateScene({ elements: [source] });
  vi.mocked(api.updateScene).mockClear();
  return {
    api,
    source,
    placement: {
      bounds,
      replaceIds: [source.id],
      sourceSignature: selectionSignature([source]),
    },
  };
};

it("replaces main-board ink with the chosen emoji as one undoable change in the actual editor", async () => {
  await renderEditor(
    <EditorJotaiProvider store={editorJotaiStore}>
      <Fcboard UIOptions={{ unifiedToolbar: true }} />
      <InsertionCandidates />
    </EditorJotaiProvider>,
  );
  const api = window.h.app.api;
  const { source } = sourceAPI();
  act(() =>
    api.updateScene({
      elements: [source],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    }),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = insertMagicInk(
      api,
      [[[100, 100]]],
      new AbortController().signal,
      {
        bounds,
        replaceIds: [source.id],
        sourceSignature: selectionSignature([source]),
      },
      () => true,
    );
  });
  fireEvent.click(await screen.findByRole("button", { name: "😊" }));
  fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
  await act(async () => pending);
  expect(api.getSceneElements()).toHaveLength(1);
  expect(api.getSceneElements()[0]).toMatchObject({ type: "text", text: "😊" });
  fireEvent.click(screen.getByTestId("button-undo"));
  expect(api.getSceneElements()).toHaveLength(1);
  expect(api.getSceneElements()[0]).toMatchObject({
    id: source.id,
    type: "freedraw",
    x: source.x,
    y: source.y,
    points: source.points,
    strokeColor: source.strokeColor,
  });
});

it("only loads real emoji candidates and never starts a cloud generation job", async () => {
  const generate = vi.spyOn(images, "generateImage");
  const chat = vi.spyOn(ai, "chat");
  render(<InsertionCandidates />);
  const { api, placement } = sourceAPI();
  let pending!: Promise<void>;
  act(() => {
    pending = insertMagicInk(
      api,
      [
        [
          [100, 100],
          [220, 220],
        ],
      ],
      new AbortController().signal,
      placement,
      () => true,
    );
  });
  expect(screen.queryByRole("button", { name: t("fcboard.image") })).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "😊" }));
  expect(api.updateScene).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
  await act(async () => pending);
  expect(api.getSceneElements()[0]).toMatchObject({ type: "text", text: "😊" });
  expect(generate).not.toHaveBeenCalled();
  expect(chat).not.toHaveBeenCalled();
});

it.each(["cancel", "escape", "abort", "page"])(
  "preserves source ink after %s and cancels candidate recognition",
  async (action) => {
    const controller = new AbortController();
    let signal!: AbortSignal;
    native.mockImplementation((_ink, request) => {
      signal = request;
      return new Promise(() => {});
    });
    render(<InsertionCandidates />);
    const { api, source, placement } = sourceAPI();
    let pending!: Promise<unknown>;
    act(() => {
      pending = insertMagicInk(
        api,
        [[[100, 100]]],
        controller.signal,
        placement,
        () => true,
      ).catch((error) => error);
    });
    await waitFor(() => expect(signal).toBeDefined());
    if (action === "cancel")
      fireEvent.click(
        screen.getByRole("button", { name: t("buttons.cancel") }),
      );
    else if (action === "escape") fireEvent.keyDown(window, { key: "Escape" });
    else
      act(() =>
        action === "abort"
          ? controller.abort()
          : classroomCommands.invalidate(),
      );
    expect(await pending).toMatchObject({ name: "AbortError" });
    expect(signal.aborted).toBe(true);
    expect(api.getSceneElements()).toEqual([source]);
  },
);

it("shows a classifier error without adding a paid generation fallback", async () => {
  native.mockRejectedValue(new Error("emoji engine unavailable"));
  render(<InsertionCandidates />);
  const { api, source, placement } = sourceAPI();
  let pending!: Promise<unknown>;
  act(() => {
    pending = insertMagicInk(
      api,
      [[[100, 100]]],
      new AbortController().signal,
      placement,
      () => true,
    ).catch((error) => error);
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "emoji engine unavailable",
  );
  fireEvent.click(screen.getByRole("button", { name: t("buttons.cancel") }));
  await pending;
  expect(api.getSceneElements()).toEqual([source]);
});
