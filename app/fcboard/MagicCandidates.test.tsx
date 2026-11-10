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

it("keeps the sketch after AI failure and inserts the explicitly chosen native emoji only after Confirm", async () => {
  render(<InsertionCandidates />);
  const { api, source, placement } = sourceAPI();
  const capture = vi.fn();
  let pending!: Promise<void>;
  act(() => {
    pending = insertMagicInk(
      api,
      capture,
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
  const smile = await screen.findByRole("button", { name: "😊" });
  await screen.findByRole("alert");
  expect(native).toHaveBeenCalledWith(
    [
      [
        [100, 100],
        [220, 220],
      ],
    ],
    expect.any(AbortSignal),
  );
  expect(capture).not.toHaveBeenCalled();
  expect(api.getSceneElements()).toEqual([source]);
  const confirm = screen.getByRole("button", { name: t("buttons.confirm") });
  expect(confirm).toBeDisabled();
  fireEvent.click(smile);
  expect(api.updateScene).not.toHaveBeenCalled();
  fireEvent.click(confirm);
  await pending;
  expect(api.getSceneElements()).toHaveLength(1);
  expect(api.getSceneElements()[0]).toMatchObject({
    type: "text",
    text: "😊",
    customData: { fcRecognizedSource: [source.id], fcGenerated: true },
  });
  expect(api.updateScene).toHaveBeenCalledTimes(1);
  expect(api.addFiles).not.toHaveBeenCalled();
});

it("lets an emoji finish while the AI cell is still loading and cancels only that preview job", async () => {
  render(<InsertionCandidates />);
  let generationSignal!: AbortSignal;
  let pending!: ReturnType<typeof chooseMagicCandidate>;
  const controller = new AbortController();
  act(() => {
    pending = chooseMagicCandidate({
      candidates: ["😊", "🐶"],
      bounds,
      signal: controller.signal,
      generate: (signal) => {
        generationSignal = signal;
        return new Promise(() => {});
      },
    });
  });
  await act(async () => {});
  const imageButton = screen.getByRole("button", { name: t("fcboard.image") });
  expect(imageButton).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "😊" }));
  fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
  expect(await pending).toEqual({ kind: "emoji", text: "😊" });
  expect(generationSignal.aborted).toBe(true);
  expect(controller.signal.aborted).toBe(false);
});

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
      vi.fn(),
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

it("previews a generated image without touching files or ink, then inserts that same image without regenerating", async () => {
  saveSettings(
    { ...defaults, apiKey: "test", model: "vision", imageModel: "illustrator" },
    false,
  );
  const chat = vi.spyOn(ai, "chat");
  const generate = vi.spyOn(images, "generateImage").mockResolvedValue(image);
  render(<InsertionCandidates />);
  const { api, source, placement } = sourceAPI();
  let pending!: Promise<void>;
  act(() => {
    pending = insertMagicInk(
      api,
      async () => "data:image/png;base64,sketch",
      [[[100, 100]]],
      new AbortController().signal,
      placement,
      () => true,
    );
  });
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: t("fcboard.image") })
        .querySelector("img"),
    ).toHaveAttribute("src", image.dataURL),
  );
  expect(api.getSceneElements()).toEqual([source]);
  expect(api.addFiles).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.image") }));
  fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
  await pending;
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate).toHaveBeenCalledWith(
    expect.stringContaining("若没有文字要求，仅按图生图"),
    expect.any(AbortSignal),
    {
      referenceImage: "data:image/png;base64,sketch",
      transparent: true,
    },
  );
  expect(chat).not.toHaveBeenCalled();
  expect(api.addFiles).toHaveBeenCalledWith([
    expect.objectContaining({ dataURL: image.dataURL }),
  ]);
  expect(api.getSceneElements()[0]).toMatchObject({
    type: "image",
    x: 100,
    y: 100,
    width: 120,
    height: 120,
  });
});

it.each(["cancel", "escape", "abort", "page"])(
  "cancels on %s and discards a late AI completion",
  async (action) => {
    render(<InsertionCandidates />);
    const controller = new AbortController();
    let complete!: (value: images.GeneratedImage) => void;
    let pending!: Promise<unknown>;
    act(() => {
      pending = chooseMagicCandidate({
        candidates: ["😊"],
        bounds,
        signal: controller.signal,
        generate: () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      }).catch((error) => error);
    });
    await act(async () => {});
    if (action === "cancel") {
      fireEvent.click(
        screen.getByRole("button", { name: t("buttons.cancel") }),
      );
    } else if (action === "escape") {
      fireEvent.keyDown(window, { key: "Escape" });
    } else if (action === "abort") {
      act(() => controller.abort());
    } else {
      act(() => classroomCommands.invalidate());
    }
    expect(await pending).toMatchObject({ name: "AbortError" });
    await act(async () => complete(image));
    expect(
      screen.queryByRole("dialog", { name: t("fcboard.magic_pen") }),
    ).toBeNull();
  },
);

it("keeps separate regions queued when later AI finishes first and failure leaves the first region's emoji choices usable", async () => {
  render(<InsertionCandidates />);
  let fail!: (error: Error) => void;
  let second!: (value: images.GeneratedImage) => void;
  let firstChoice!: ReturnType<typeof chooseMagicCandidate>;
  let secondChoice!: ReturnType<typeof chooseMagicCandidate>;
  act(() => {
    firstChoice = chooseMagicCandidate({
      candidates: ["😊"],
      bounds,
      signal: new AbortController().signal,
      generate: () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    });
    secondChoice = chooseMagicCandidate({
      candidates: ["🐶"],
      bounds,
      signal: new AbortController().signal,
      generate: () =>
        new Promise((resolve) => {
          second = resolve;
        }),
    });
  });
  await act(async () => {});
  await act(async () => {
    second(image);
    fail(new Error("first image failed"));
  });
  expect(screen.getByRole("button", { name: "😊" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "🐶" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "😊" }));
  fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
  expect(await firstChoice).toEqual({ kind: "emoji", text: "😊" });
  expect(screen.getByRole("button", { name: "🐶" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: t("buttons.confirm") }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.image") }));
  fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
  expect(await secondChoice).toEqual({ kind: "image", image });
});

it("retries only the failed AI cell while preserving real emoji choices", async () => {
  render(<InsertionCandidates />);
  const generate = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(image);
  let pending!: ReturnType<typeof chooseMagicCandidate>;
  act(() => {
    pending = chooseMagicCandidate({
      candidates: ["😊"],
      bounds,
      signal: new AbortController().signal,
      generate,
    });
  });
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.image") }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: t("fcboard.image") })
        .querySelector("img"),
    ).toBeInTheDocument(),
  );
  expect(generate).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "😊" }));
  fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
  expect(await pending).toEqual({ kind: "emoji", text: "😊" });
});

it("does not replace changed source ink even when a candidate was already selected", async () => {
  render(<InsertionCandidates />);
  const { api, source, placement } = sourceAPI();
  let current = true;
  let pending!: Promise<unknown>;
  act(() => {
    pending = insertMagicInk(
      api,
      vi.fn(),
      [[[100, 100]]],
      new AbortController().signal,
      placement,
      () => current,
    ).catch((error) => error);
  });
  fireEvent.click(await screen.findByRole("button", { name: "😊" }));
  current = false;
  fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
  expect(await pending).toMatchObject({ name: "AbortError" });
  expect(api.getSceneElements()).toEqual([source]);
  expect(api.updateScene).not.toHaveBeenCalled();
});

it("starts and completes the image cell before a slow native emoji classifier and cancels that classifier on confirm", async () => {
  saveSettings(
    { ...defaults, apiKey: "test", imageModel: "illustrator" },
    false,
  );
  let emojiSignal!: AbortSignal;
  let completeEmoji!: (values: string[]) => void;
  native.mockImplementation((_ink, signal) => {
    emojiSignal = signal;
    return new Promise<string[]>((resolve) => {
      completeEmoji = resolve;
    });
  });
  const generate = vi.spyOn(images, "generateImage").mockResolvedValue(image);
  const chat = vi.spyOn(ai, "chat");
  const capture = vi.fn().mockResolvedValue("data:image/png;base64,sketch");
  render(<InsertionCandidates />);
  const { api, placement } = sourceAPI();
  let pending!: Promise<void>;
  act(() => {
    pending = insertMagicInk(
      api,
      capture,
      [[[100, 100]]],
      new AbortController().signal,
      placement,
      () => true,
    );
  });
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: t("fcboard.image") })
        .querySelector("img"),
    ).toHaveAttribute("src", image.dataURL),
  );
  expect(generate).toHaveBeenCalledTimes(1);
  expect(capture).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.image") }));
  fireEvent.click(screen.getByRole("button", { name: t("buttons.confirm") }));
  await pending;
  expect(emojiSignal.aborted).toBe(true);
  expect(api.getSceneElements()[0].type).toBe("image");
  await act(async () => completeEmoji(["😊"]));
  expect(screen.queryByRole("button", { name: "😊" })).toBeNull();
  expect(chat).not.toHaveBeenCalled();
});
