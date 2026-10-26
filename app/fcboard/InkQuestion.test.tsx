import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { t } from "@excalidraw/excalidraw/i18n";
import { getCommonBounds } from "@excalidraw/element";

import { InkQuestion } from "./InkQuestion";
import { registerCanvasCommands } from "./canvasCommands";
import { classroomCommands } from "./commands";
import { questionPosition } from "./questionInk";
import { render } from "./test/render";
import { sceneAPI } from "./test/scene";
import { questionFrame, writeQuestion } from "./test/question";
import * as ocr from "./ocr";
import * as dictation from "./dictation";
import { handwritingText } from "./handwriting";

beforeEach(() => {
  vi.spyOn(ocr, "warmHandwriting").mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

const setup = (onSubmit = vi.fn().mockResolvedValue(undefined)) => {
  const api = sceneAPI();
  const release = registerCanvasCommands(api);
  const close = vi.fn();
  const view = render(
    <InkQuestion
      api={api}
      placement={questionPosition(api)}
      onSubmit={onSubmit}
      onClose={close}
    />,
  );
  return { api, release, close, ...view };
};

it("submits every raw sample, persists the question at its displayed coordinates and writes below it", async () => {
  const recognize = vi
    .spyOn(ocr, "recognizeHandwriting")
    .mockResolvedValue("1+1=");
  const api = sceneAPI();
  const release = registerCanvasCommands(api);
  const submit = vi.fn(
    async (_text: string, _signal: AbortSignal, sourceIds?: string[]) => {
      await classroomCommands.execute({
        name: "canvas.text",
        args: { text: "2", presentation: "handwritten", sourceIds },
      });
    },
  );
  const view = render(
    <InkQuestion
      api={api}
      placement={questionPosition(api)}
      onSubmit={submit}
      onClose={vi.fn()}
    />,
  );
  try {
    expect(screen.queryByRole("textbox")).toBeNull();
    writeQuestion();
    expect(recognize).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.send_question") }),
    );
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(recognize.mock.calls[0][5]).toEqual([
      [
        [20, 20],
        [25, 25],
        [30, 35],
        [40, 45],
        [50, 50],
      ],
    ]);
    const written = api
      .getSceneElements()
      .filter((el) => el.type === "freedraw");
    const question = written.find((el) => !el.customData?.fcGenerated)!;
    expect(question).toMatchObject({ x: 520, y: 320 });
    expect(question.groupIds).toHaveLength(1);
    const answer = written.filter((el) => el.customData?.fcGenerated);
    expect(answer.length).toBeGreaterThan(0);
    expect(getCommonBounds(answer)[1]).toBeGreaterThanOrEqual(
      getCommonBounds([question])[3],
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: t("fcboard.collapse_answer") }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.collapse_answer") }),
    );
    await waitFor(() =>
      expect(
        api
          .getSceneElements()
          .some((element) => answer.some((item) => item.id === element.id)),
      ).toBe(false),
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.expand_answer") }),
    );
    await waitFor(() =>
      expect(
        api
          .getSceneElements()
          .filter((element) => answer.some((item) => item.id === element.id)),
      ).toHaveLength(answer.length),
    );
  } finally {
    view.unmount();
    release();
  }
});

it("rolls back a cancelled live stroke and keeps completed writing", async () => {
  const { release, unmount } = setup();
  try {
    const { svg, pointer } = writeQuestion();
    pointer("pointerdown", 600, 360);
    pointer("pointermove", 620, 380);
    expect(svg.querySelectorAll("path")).toHaveLength(2);
    pointer("pointercancel", 620, 380);
    expect(svg.querySelectorAll("path")).toHaveLength(1);
    pointer("pointerdown", 600, 360);
    fireEvent(window, new Event("blur"));
    expect(svg.querySelectorAll("path")).toHaveLength(1);
  } finally {
    unmount();
    release();
  }
});

it("does not write or send a late recognition after the question closes", async () => {
  let finish!: (value: string) => void;
  const recognize = vi
    .spyOn(ocr, "recognizeHandwriting")
    .mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  const submit = vi.fn();
  const { api, release, unmount } = setup(submit);
  writeQuestion();
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.send_question") }),
  );
  await waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
  unmount();
  await act(async () => finish("过期问题"));
  expect(recognize.mock.calls[0][1].aborted).toBe(true);
  expect(submit).not.toHaveBeenCalled();
  expect(api.updateScene).not.toHaveBeenCalled();
  release();
});

it("dictates without executing and flushes the last stable words only on send", async () => {
  const stop = vi.fn();
  const cancel = vi.fn();
  let text!: (value: string) => void;
  vi.spyOn(dictation, "startDictation").mockImplementation(async (onText) => {
    text = onText;
    stop.mockImplementation(async () => onText("牛顿定律"));
    return { stop, cancel };
  });
  const submit = vi.fn().mockResolvedValue(undefined);
  const { api, release, unmount } = setup(submit);
  try {
    questionFrame();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.dictate_question") }),
    );
    await waitFor(() =>
      expect(dictation.startDictation).toHaveBeenCalledTimes(1),
    );
    act(() => text("请讲解"));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText("请讲解")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.send_question") }),
    );
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        "请讲解 牛顿定律",
        expect.any(AbortSignal),
        expect.arrayContaining([expect.any(String)]),
      ),
    );
    expect(stop).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    const question = api
      .getSceneElements()
      .find(
        (element) =>
          element.type === "text" && element.originalText === "请讲解 牛顿定律",
      )!;
    expect(question).toMatchObject({ fontFamily: 5 });
    const bounds = getCommonBounds([question]);
    expect(bounds[0]).toBeGreaterThanOrEqual(500);
    expect(bounds[1]).toBeGreaterThanOrEqual(300);
    expect(bounds[2]).toBeLessThanOrEqual(1100);
    expect(bounds[3]).toBeLessThanOrEqual(444);
    expect(screen.queryByText("请讲解 牛顿定律")).toBeNull();
  } finally {
    unmount();
    release();
  }
});

it("cancels a microphone that connects after the question has closed", async () => {
  let connect!: (handle: {
    stop: () => Promise<void>;
    cancel: () => Promise<void>;
  }) => void;
  const cancel = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(dictation, "startDictation").mockImplementation(
    () => new Promise((resolve) => (connect = resolve)),
  );
  const { release, unmount } = setup();
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.dictate_question") }),
  );
  await waitFor(() =>
    expect(dictation.startDictation).toHaveBeenCalledTimes(1),
  );
  unmount();
  await act(async () => connect({ stop: vi.fn(), cancel }));
  expect(cancel).toHaveBeenCalledTimes(1);
  release();
});

it("anchors and folds a real answer to a voice-only handwritten question", async () => {
  vi.spyOn(dictation, "startDictation").mockImplementation(async (onText) => ({
    stop: async () => onText("1+1="),
    cancel: vi.fn(),
  }));
  const submit = vi.fn(
    async (_text: string, _signal: AbortSignal, sourceIds?: string[]) => {
      await classroomCommands.execute({
        name: "canvas.text",
        args: { text: "2", presentation: "handwritten", sourceIds },
      });
    },
  );
  const { api, release, unmount } = setup(submit);
  try {
    questionFrame();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.dictate_question") }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: t("fcboard.dictate_question") }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.send_question") }),
    );
    const fold = screen.getByRole("button", {
      name: t("fcboard.collapse_answer"),
    });
    await waitFor(() => expect(fold).toBeEnabled());
    const sourceIds = submit.mock.calls[0][2]!;
    const question = api
      .getSceneElements()
      .filter((element) => sourceIds.includes(element.id));
    expect(handwritingText(question)).toEqual(["1+1="]);
    expect(new Set(question.map((element) => element.groupIds[0])).size).toBe(
      1,
    );
    const answer = api
      .getSceneElements()
      .filter(
        (element) =>
          element.type === "freedraw" && !sourceIds.includes(element.id),
      );
    expect(handwritingText(answer)).toEqual(["2"]);
    expect(getCommonBounds(answer)[1]).toBeGreaterThanOrEqual(
      getCommonBounds(question)[3],
    );
    fireEvent.click(fold);
    await waitFor(() =>
      expect(
        api
          .getSceneElements()
          .some((element) => answer.some((item) => item.id === element.id)),
      ).toBe(false),
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.expand_answer") }),
    );
    await waitFor(() =>
      expect(
        handwritingText(
          api
            .getSceneElements()
            .filter((element) => answer.some((item) => item.id === element.id)),
        ),
      ).toEqual(["2"]),
    );
  } finally {
    unmount();
    release();
  }
});

it("replaces a revised mixed question atomically and reuses it on an unchanged retry", async () => {
  vi.spyOn(ocr, "recognizeHandwriting").mockResolvedValue("why");
  vi.spyOn(dictation, "startDictation").mockImplementation(async (onText) => ({
    stop: async () => onText("example"),
    cancel: vi.fn(),
  }));
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(undefined);
  const { api, release, unmount } = setup(submit);
  try {
    writeQuestion();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.dictate_question") }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: t("fcboard.dictate_question") }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    const send = screen.getByRole("button", {
      name: t("fcboard.send_question"),
    });
    fireEvent.click(send);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("offline"),
    );
    const oldIds = submit.mock.calls[0][2] as string[];
    expect(submit.mock.calls[0][0]).toBe("why\nexample");
    writeQuestion();
    fireEvent.click(send);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(send).toBeEnabled());
    const ids = submit.mock.calls[1][2] as string[];
    expect(
      api.getSceneElements().some((element) => oldIds.includes(element.id)),
    ).toBe(false);
    expect(
      api.getSceneElements().filter((element) => ids.includes(element.id))
        .length,
    ).toBeGreaterThan(2);
    fireEvent.click(send);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(3));
    expect(submit.mock.calls[2][2]).toEqual(ids);
    expect(
      api.getSceneElements().filter((element) => ids.includes(element.id)),
    ).toHaveLength(ids.length);
  } finally {
    unmount();
    release();
  }
});

it("retains a failed question for retry without inserting its strokes twice", async () => {
  vi.spyOn(ocr, "recognizeHandwriting").mockResolvedValue("问题");
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(undefined);
  const { api, release, unmount } = setup(submit);
  try {
    writeQuestion();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.send_question") }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("offline"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.send_question") }),
    );
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(
      api.getSceneElements().filter((el) => el.type === "freedraw"),
    ).toHaveLength(1);
  } finally {
    unmount();
    release();
  }
});

it("does not resubmit a deleted question and clears a failed question without erasing other notes", async () => {
  vi.spyOn(ocr, "recognizeHandwriting").mockResolvedValue("question");
  const submit = vi.fn().mockRejectedValue(new Error("offline"));
  const { api, release, unmount } = setup(submit);
  const original = [...api.getSceneElements()];
  try {
    writeQuestion();
    const send = screen.getByRole("button", {
      name: t("fcboard.send_question"),
    });
    fireEvent.click(send);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("offline"),
    );
    const ids = submit.mock.calls[0][2] as string[];
    api.updateScene({
      elements: api.getSceneElements().filter((item) => !ids.includes(item.id)),
    });
    fireEvent.click(send);
    await waitFor(() => expect(send).toBeEnabled());
    expect(submit).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.clear_question") }),
    );
    await waitFor(() => expect(send).toBeDisabled());
    writeQuestion();
    fireEvent.click(send);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.clear_question") }),
    );
    await waitFor(() => expect(api.getSceneElements()).toEqual(original));
    expect(send).toBeDisabled();
  } finally {
    unmount();
    release();
  }
});
