import { isPalmContact } from "@fcboard/fcboard/eraser/stroke";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { classroomCommands } from "./commands";

import type { PointerEvent as ReactPointerEvent } from "react";

/** Floating tools must not swallow the board's palm or pen-side eraser contact. */
export const forwardEraseContact = (
  api: FcboardImperativeAPI,
  event: ReactPointerEvent,
) => {
  const state = api.getAppState();
  const currentDocument = classroomCommands.read("document") as
    | { tool?: string }
    | undefined;
  const configuration = classroomCommands.read("canvas") as
    | { configuration?: { eraser?: { palmThreshold?: number } } }
    | undefined;
  const palm =
    state.palmEraser !== false &&
    isPalmContact(
      event.nativeEvent,
      state.palmEraserThreshold ??
        configuration?.configuration?.eraser?.palmThreshold ??
        36,
    );
  const side =
    event.pointerType === "pen" &&
    (event.button === 5 || !!(event.buttons & 34));
  if (
    !palm &&
    !side &&
    (currentDocument?.tool || state.activeTool.type) !== "eraser"
  ) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  const editor = Array.from(
    document.querySelectorAll<HTMLElement>(".fcboard[data-fcboard-id]"),
  ).find((element) => element.dataset.fcboardId === api.id);
  const target = editor?.querySelector(
    currentDocument ? ".fc-document-ink" : "canvas.interactive",
  );
  if (target && typeof PointerEvent !== "undefined") {
    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        clientX: event.clientX,
        clientY: event.clientY,
        button: event.button,
        buttons: event.buttons,
        width: event.width,
        height: event.height,
        pressure: event.pressure,
      }),
    );
  }
  return true;
};
