import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { t } from "@fcboard/fcboard/i18n";
import { newElementWith } from "@fcboard/element";
import { convertToFcboardElements } from "@fcboard/fcboard";

import { InkQuestion } from "./InkQuestion";
import { registerCanvasCommands } from "./canvasCommands";
import { questionPosition } from "./questionInk";
import { framedQuestion, questionFrames } from "./questionFrame";
import { render } from "./test/render";
import { sceneAPI } from "./test/scene";
import { writeQuestion } from "./test/question";
import * as ocr from "./ocr";
import * as ai from "./ai";

beforeEach(() => {
  vi.spyOn(ocr, "warmHandwriting").mockResolvedValue(undefined);
  vi.spyOn(ai, "boardContext").mockResolvedValue({
    elements: [],
    text: "",
    image: "data:image/png;base64,framed" as never,
  });
});
afterEach(() => vi.restoreAllMocks());
const setup = (onSubmit = vi.fn().mockResolvedValue(undefined)) => {
  const api = sceneAPI();
  const listeners = new Set<() => void>();
  const update = vi.mocked(api.updateScene).getMockImplementation()!;
  vi.mocked(api.updateScene).mockImplementation((args) => {
    update(args);
    listeners.forEach((notify) => notify());
  });
  api.onChange = (listener) => {
    const notify = () =>
      listener(api.getSceneElements(), api.getAppState(), {});
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  };
  const release = registerCanvasCommands(api);
  const view = render(
    <InkQuestion
      api={api}
      placement={questionPosition(api)}
      onSubmit={onSubmit}
    />,
  );
  return { api, release, ...view };
};
it("uses a blue transparent native rectangle and no writing layer or collapse control", async () => {
  const { api, release, unmount } = setup();
  try {
    const frame = await screen.findByRole("dialog", {
      name: t("fcboard.handwritten_question"),
    });
    expect(questionFrames(api)).toHaveLength(1);
    expect(
      api
        .getSceneElements()
        .find((element) => element.customData?.fcQuestionFrame),
    ).toMatchObject({
      type: "rectangle",
      backgroundColor: "transparent",
      strokeColor: "#1976d2",
    });
    expect(frame.style.pointerEvents).toBe("none");
    expect(frame.querySelector('svg[viewBox="0 0 600 144"]')).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: t("fcboard.collapse_answer") }),
    ).toBeNull();
  } finally {
    unmount();
    release();
  }
});
it("reads current raw canvas ink, excludes the border, and never duplicates or removes the input", async () => {
  const recognize = vi
    .spyOn(ocr, "recognizeHandwriting")
    .mockResolvedValue("出十道物理题");
  const submit = vi.fn().mockResolvedValue(undefined);
  const { api, release, unmount } = setup(submit);
  try {
    const { ids } = await writeQuestion();
    const before = [...api.getSceneElements()];
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.send_question") }),
    );
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0]).toBe("出十道物理题");
    expect(submit.mock.calls[0][2]).toEqual(ids);
    expect(submit.mock.calls[0][3]).toMatchObject({
      text: "出十道物理题",
      image: "data:image/png;base64,framed",
    });
    expect(recognize.mock.calls[0][5]).toHaveLength(1);
    expect(api.getSceneElements()).toEqual(before);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: t("fcboard.send_question") }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.send_question") }),
    );
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(api.getSceneElements()).toEqual(before);
  } finally {
    unmount();
    release();
  }
});
it("moves and resizes only the native border over existing text and reads the newly enclosed requirement", async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  const { api, release, unmount } = setup(submit);
  try {
    await screen.findByRole("dialog", {
      name: t("fcboard.handwritten_question"),
    });
    const frame = api
      .getSceneElements()
      .find((element) => element.customData?.fcQuestionFrame)!;
    const text = convertToFcboardElements([
      { type: "text", x: 100, y: 100, text: "出十道数学题", fontSize: 20 },
    ])[0];
    const outside = convertToFcboardElements([
      { type: "text", x: 900, y: 300, text: "不得加入这个要求" },
    ])[0];
    act(() =>
      api.updateScene({
        elements: [...api.getSceneElements(), text, outside].map((element) =>
          element.id === frame.id
            ? newElementWith(element, { x: 80, y: 80, width: 400, height: 160 })
            : element,
        ),
      }),
    );
    expect(framedQuestion(api, frame.id).ids).toEqual([text.id]);
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.send_question") }),
    );
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0]).toBe(
      text.type === "text" ? text.originalText : "",
    );
    expect(submit.mock.calls[0][2]).toEqual([text.id]);
    expect(
      api.getSceneElements().find((element) => element.id === text.id),
    ).toBe(text);
    act(() =>
      api.updateScene({
        elements: api
          .getSceneElements()
          .filter((element) => element.id !== text.id),
      }),
    );
    expect(framedQuestion(api, frame.id).hasContent).toBe(false);
    expect(questionFrames(api)).toHaveLength(1);
  } finally {
    unmount();
    release();
  }
});
it("aborts stale recognition when its real source changes or the controls unmount", async () => {
  let finish!: (text: string) => void;
  const recognize = vi.spyOn(ocr, "recognizeHandwriting").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const submit = vi.fn();
  const { api, release, unmount } = setup(submit);
  const { ids } = await writeQuestion();
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.send_question") }),
  );
  await waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
  act(() =>
    api.updateScene({
      elements: api
        .getSceneElements()
        .filter((element) => !ids.includes(element.id)),
    }),
  );
  await act(async () => {
    finish("迟到要求");
  });
  expect(recognize.mock.calls[0][1].aborted).toBe(true);
  expect(submit).not.toHaveBeenCalled();
  unmount();
  release();
});
it("keeps the real input after a failed generation so search can retry", async () => {
  vi.spyOn(ocr, "recognizeHandwriting").mockResolvedValue("出题要求");
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(undefined);
  const { api, release, unmount } = setup(submit);
  try {
    await writeQuestion();
    const before = [...api.getSceneElements()];
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
    expect(api.getSceneElements()).toEqual(before);
  } finally {
    unmount();
    release();
  }
});
