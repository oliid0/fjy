import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { forwardEraseContact } from "./canvasContact";
import { classroomCommands } from "./commands";

import type { PointerEvent as ReactPointerEvent } from "react";

const setup = (boardTool: string, documentTool?: string) => {
  const host = document.createElement("div");
  host.innerHTML =
    '<div class="fcboard" data-fcboard-id="other"><canvas class="interactive"></canvas></div><div class="fcboard" data-fcboard-id="current"><canvas class="interactive"></canvas><svg class="fc-document-ink"></svg></div>';
  document.body.append(host);
  vi.spyOn(classroomCommands, "read").mockImplementation((name) =>
    name === "document" && documentTool ? { tool: documentTool } : undefined,
  );
  class Contact extends MouseEvent {
    pointerId: number;
    pointerType: string;
    width: number;
    height: number;
    constructor(type: string, init: PointerEventInit) {
      super(type, init);
      this.pointerId = init.pointerId!;
      this.pointerType = init.pointerType!;
      this.width = init.width!;
      this.height = init.height!;
    }
  }
  vi.stubGlobal("PointerEvent", Contact);
  const api = {
    id: "current",
    getAppState: () => ({
      activeTool: { type: boardTool },
      palmEraser: true,
      palmEraserThreshold: 36,
    }),
  } as unknown as FcboardImperativeAPI;
  const event = (size = 2) =>
    ({
      pointerId: 27,
      pointerType: "touch",
      clientX: 120,
      clientY: 240,
      button: 0,
      buttons: 1,
      width: size,
      height: size,
      pressure: 0.5,
      isPrimary: true,
      nativeEvent: { pointerType: "touch", width: size, height: size },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as ReactPointerEvent);
  return { api, event, host };
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("forwards a palm to its own editor with the actual contact identity and dimensions", () => {
  const { api, event, host } = setup("freedraw");
  const current = vi.fn();
  const other = vi.fn();
  host
    .querySelector('[data-fcboard-id="current"] canvas')!
    .addEventListener("pointerdown", current);
  host
    .querySelector('[data-fcboard-id="other"] canvas')!
    .addEventListener("pointerdown", other);
  const contact = event(80);
  expect(forwardEraseContact(api, contact)).toBe(true);
  expect(current.mock.calls[0][0]).toMatchObject({
    pointerId: 27,
    pointerType: "touch",
    clientX: 120,
    clientY: 240,
    width: 80,
    height: 80,
  });
  expect(other).not.toHaveBeenCalled();
  expect(contact.stopPropagation).toHaveBeenCalledTimes(1);
});

it("uses the visible document's eraser rather than the board pen and routes to document ink", () => {
  const { api, event, host } = setup("freedraw", "eraser");
  const ink = vi.fn();
  const board = vi.fn();
  host.querySelector(".fc-document-ink")!.addEventListener("pointerdown", ink);
  host
    .querySelector('[data-fcboard-id="current"] canvas')!
    .addEventListener("pointerdown", board);
  expect(forwardEraseContact(api, event())).toBe(true);
  expect(ink).toHaveBeenCalledTimes(1);
  expect(board).not.toHaveBeenCalled();
});

it("does not use a background board eraser to intercept a document pen contact", () => {
  const { api, event } = setup("eraser", "freedraw");
  const contact = event();
  expect(forwardEraseContact(api, contact)).toBe(false);
  expect(contact.preventDefault).not.toHaveBeenCalled();
});
