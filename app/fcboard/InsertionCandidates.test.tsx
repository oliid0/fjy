import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { newFreeDrawElement } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";
import { t } from "@fcboard/fcboard/i18n";

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

it("receives touches outside the non-interactive editor UI wrapper and clamps its measured size", async () => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-insertion-candidates")
        ? new DOMRect(0, 0, 360, 96)
        : original.call(this);
    },
  );
  const view = render(
    <div data-editor-ui style={{ pointerEvents: "none" }}>
      <InsertionCandidates />
    </div>,
  );
  let choice!: Promise<string>;
  act(() => {
    choice = chooseInsertionCandidate(
      ["Hello", "Hallo"],
      { x: innerWidth - 1, y: innerHeight + 300 },
      new AbortController().signal,
    );
  });
  const picker = screen.getByRole("toolbar");
  expect(picker.parentElement).toBe(document.body);
  expect(getComputedStyle(picker).pointerEvents).toBe("auto");
  expect(picker.style.left).toBe(`${innerWidth - 368}px`);
  expect(picker.style.top).toBe(`${innerHeight - 104}px`);
  fireEvent.click(screen.getByRole("button", { name: "Hallo" }));
  expect(await choice).toBe("Hallo");
  view.unmount();
});

it("settles a pending choice on toolbar action and accepts the following independent choice", async () => {
  render(<InsertionCandidates />);
  let failure!: Promise<unknown>;
  act(() => {
    failure = chooseInsertionCandidate(
      ["old"],
      { x: 100, y: 100 },
      new AbortController().signal,
    ).catch((error) => error);
  });
  act(() => {
    window.dispatchEvent(new CustomEvent("fcboard:toolbar-action"));
  });
  expect(await failure).toMatchObject({ name: "AbortError" });
  expect(screen.queryByRole("toolbar")).toBeNull();
  let next!: Promise<string>;
  act(() => {
    next = chooseInsertionCandidate(
      ["new"],
      { x: 100, y: 100 },
      new AbortController().signal,
    );
  });
  fireEvent.click(screen.getByRole("button", { name: "new" }));
  expect(await next).toBe("new");
});

it("queues independent region choices instead of cancelling a valid earlier result", async () => {
  render(<InsertionCandidates />);
  let first!: Promise<string>;
  let second!: Promise<string>;
  act(() => {
    first = chooseInsertionCandidate(
      ["first", "first alternate"],
      { x: 10, y: 100 },
      new AbortController().signal,
    );
    second = chooseInsertionCandidate(
      ["second", "second alternate"],
      { x: 300, y: 100 },
      new AbortController().signal,
    );
  });
  expect(screen.queryByRole("button", { name: "second" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "first alternate" }));
  expect(await first).toBe("first alternate");
  fireEvent.click(screen.getByRole("button", { name: "second alternate" }));
  expect(await second).toBe("second alternate");
  expect(screen.queryByRole("toolbar")).toBeNull();
});

it("aborts only the owning queued region and cancels all remaining choices on tool change", async () => {
  render(<InsertionCandidates />);
  const controller = new AbortController();
  let first!: Promise<unknown>;
  let second!: Promise<unknown>;
  let third!: Promise<unknown>;
  act(() => {
    first = chooseInsertionCandidate(
      ["first"],
      { x: 10, y: 100 },
      new AbortController().signal,
    ).catch((error) => error);
    second = chooseInsertionCandidate(
      ["second"],
      { x: 300, y: 100 },
      controller.signal,
    ).catch((error) => error);
    third = chooseInsertionCandidate(
      ["third"],
      { x: 500, y: 100 },
      new AbortController().signal,
    ).catch((error) => error);
    controller.abort();
  });
  expect(await second).toMatchObject({ name: "AbortError" });
  expect(screen.getByRole("button", { name: "first" })).toBeInTheDocument();
  act(() => window.dispatchEvent(new CustomEvent("fcboard:toolbar-action")));
  expect(await first).toMatchObject({ name: "AbortError" });
  expect(await third).toMatchObject({ name: "AbortError" });
  expect(screen.queryByRole("toolbar")).toBeNull();
});

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
      points: [pointFrom(0, 0), pointFrom(body.width + 240, body.height + 300)],
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
      await screen.findByRole("button", { name: "Hallo" }, { timeout: 2500 });
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
