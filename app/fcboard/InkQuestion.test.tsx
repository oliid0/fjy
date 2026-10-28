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

it("keeps only search and expand controls, supports palm editing after success, and can search repeatedly", async () => {
  const recognize = vi
    .spyOn(ocr, "recognizeHandwriting")
    .mockResolvedValueOnce("first question")
    .mockResolvedValue("corrected question");
  const submit = vi.fn().mockResolvedValue(undefined);
  const { api, release, unmount } = setup(submit);
  try {
    expect(screen.getAllByRole("button")).toHaveLength(2);
    const { pointer } = writeQuestion();
    const send = screen.getByRole("button", {
      name: t("fcboard.send_question"),
    });
    fireEvent.click(send);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(send).toBeEnabled());
    const oldIds = submit.mock.calls[0][2] as string[];
    fireEvent.click(send);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1][2]).toEqual(oldIds);
    await waitFor(() => expect(send).toBeEnabled());
    pointer("pointerdown", 535, 335, {
      pointerType: "touch",
      width: 100,
      height: 100,
    });
    pointer("pointerup", 535, 335, {
      pointerType: "touch",
      width: 100,
      height: 100,
    });
    await waitFor(() => expect(send).toBeDisabled());
    await waitFor(() =>
      expect(
        api.getSceneElements().some((element) => oldIds.includes(element.id)),
      ).toBe(false),
    );
    writeQuestion();
    fireEvent.click(send);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(3));
    expect(submit.mock.calls[2][0]).toBe("corrected question");
    expect(recognize).toHaveBeenCalledTimes(3);
  } finally {
    unmount();
    release();
  }
});

it("restores question ink when a palm gesture is cancelled", async () => {
  const { release, unmount } = setup();
  try {
    const { pointer, svg } = writeQuestion();
    const before = svg.querySelector("path")!.getAttribute("d");
    pointer("pointerdown", 535, 335, {
      pointerType: "touch",
      width: 100,
      height: 100,
    });
    expect(svg.querySelectorAll("path")).toHaveLength(0);
    pointer("pointercancel", 535, 335);
    expect(svg.querySelector("path")!.getAttribute("d")).toBe(before);
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

it("does not resubmit a deleted question and palm-clears a failed question without erasing other notes", async () => {
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
    const { pointer } = questionFrame();
    pointer("pointerdown", 535, 335, {
      pointerType: "touch",
      width: 100,
      height: 100,
    });
    pointer("pointerup", 535, 335, {
      pointerType: "touch",
      width: 100,
      height: 100,
    });
    await waitFor(() => expect(send).toBeDisabled());
    writeQuestion();
    fireEvent.click(send);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(send).toBeEnabled());
    pointer("pointerdown", 535, 335, {
      pointerType: "touch",
      width: 100,
      height: 100,
    });
    pointer("pointerup", 535, 335, {
      pointerType: "touch",
      width: 100,
      height: 100,
    });
    await waitFor(() => expect(api.getSceneElements()).toEqual(original));
    expect(send).toBeDisabled();
  } finally {
    unmount();
    release();
  }
});
