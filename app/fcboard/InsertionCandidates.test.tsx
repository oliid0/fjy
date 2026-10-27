import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { newFreeDrawElement } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";
import { t } from "@excalidraw/excalidraw/i18n";

import { render } from "./test/render";
import { sceneAPI } from "./test/scene";
import {
  InsertionCandidates,
  chooseInsertionCandidate,
} from "./InsertionCandidates";
import {
  insertionDefaults,
  renderInsertion,
  readInsertions,
} from "./insertObjects";
import { observeInkAssistance } from "./inkAssistance";
import * as ocr from "./ocr";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("shows real candidates and commits the explicitly selected alternative", async () => {
  render(<InsertionCandidates />);
  let choice!: Promise<string>;
  act(() => {
    choice = chooseInsertionCandidate(
      ["你好", "你号"],
      { x: 100, y: 100 },
      new AbortController().signal,
    );
  });
  fireEvent.click(screen.getByRole("button", { name: "你号" }));
  expect(await choice).toBe("你号");
  expect(screen.queryByRole("toolbar")).toBeNull();
});

it.each(["cancel", "escape", "abort"])(
  "cancels %s without accepting a candidate",
  async (reason) => {
    render(<InsertionCandidates />);
    const controller = new AbortController();
    let failure!: Promise<unknown>;
    act(() => {
      failure = chooseInsertionCandidate(
        ["Hello", "Hallo"],
        { x: 100, y: 100 },
        controller.signal,
      ).catch((error) => error);
    });
    if (reason === "cancel") {
      fireEvent.click(
        screen.getByRole("button", { name: t("buttons.cancel") }),
      );
    } else if (reason === "escape") {
      fireEvent.keyDown(window, { key: "Escape" });
    } else {
      act(() => controller.abort());
    }
    expect(await failure).toMatchObject({ name: "AbortError" });
    expect(screen.queryByRole("toolbar")).toBeNull();
  },
);

it.each(["mindmap", "fourline"] as const)(
  "keeps %s ink until the user chooses, then replaces it atomically",
  async (kind) => {
    const api = sceneAPI();
    await renderInsertion(api, insertionDefaults(kind, { x: 100, y: 100 }));
    let notify = () => {};
    const state = {
      ...api.getAppState(),
      activeTool: { type: "freedraw" },
      cursorButton: "up",
    };
    vi.spyOn(api, "getAppState").mockReturnValue(
      state as ReturnType<typeof api.getAppState>,
    );
    api.onChange = (callback) => {
      notify = () => callback(api.getSceneElements(), api.getAppState(), {});
      return () => {};
    };
    const body = api
      .getSceneElements()
      .find((element) => element.type === "rectangle")!;
    const ink = newFreeDrawElement({
      type: "freedraw",
      x: body.x + 25,
      y: body.y + 20,
      points: [pointFrom(0, 0), pointFrom(30, 20)],
      simulatePressure: true,
    });
    vi.spyOn(ocr, "recognizeHandwriting").mockImplementation(
      async (
        _image,
        _signal,
        _progress,
        _kind,
        _accept,
        _strokes,
        _language,
        choose,
      ) => choose!(["Hello", "Hallo"]),
    );
    const error = vi.fn();
    const release = observeInkAssistance(api, vi.fn(), error);
    const view = render(<InsertionCandidates />);
    try {
      act(() => {
        api.updateScene({ elements: [...api.getSceneElements(), ink] });
        notify();
      });
      await screen.findByRole("button", { name: "Hallo" });
      expect(
        api.getSceneElements().some((element) => element.id === ink.id),
      ).toBe(true);
      expect(
        readInsertions(api)[0][kind === "fourline" ? "text" : "outline"] || "",
      ).not.toContain("Hallo");
      fireEvent.click(screen.getByRole("button", { name: "Hallo" }));
      await waitFor(() =>
        expect(
          readInsertions(api)[0][kind === "fourline" ? "text" : "outline"],
        ).toContain("Hallo"),
      );
      expect(
        api.getSceneElements().some((element) => element.id === ink.id),
      ).toBe(false);
      expect(error).not.toHaveBeenCalled();
    } finally {
      act(() => release());
      view.unmount();
    }
  },
);
