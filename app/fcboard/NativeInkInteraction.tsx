import { useEffect } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { getCommonBounds } from "@fcboard/element";
import { colorToHex } from "@fcboard/common";
import { t } from "@fcboard/fcboard/i18n";
import { whiteboardInkStyle } from "@fcboard/fcboard/whiteboardPen";
import { nativeInkPalettes } from "@fcboard/element/nativeInkColor";
import { rainbowInkStops } from "@fcboard/element/rainbowInk";

import type { FcboardImperativeAPI, UIOptions } from "@fcboard/fcboard/types";

import { classroomCommands, executeBoardCommand } from "./commands";
import { createNativeEraserBackend } from "./nativeEraser";
import { createNativeSceneRenderer } from "./nativeScene";

import "./NativeScene.scss";

type Contact = {
  owner: string;
  id: string;
  token: string;
  phase: "start" | "move" | "end" | "cancel";
  mode?: "pen" | "select" | "regionErase" | "erase";
  points: [number, number, number][];
  width: number;
  height: number;
  palm?: boolean;
  pointerType: string;
  nativeSequence?: number;
};
type PenAppearance = {
  pen: string;
  variation: number;
  touchPressure: boolean;
  rainbow?: { colors: string[]; positions: number[] };
  gradient?: { colors: readonly string[]; size: number; x: number; y: number };
};
const ink = registerPlugin<{
  configure(options: {
    owner: string;
    token: string;
    enabled: boolean;
    multiStroke: boolean;
    shortcutsEnabled: boolean;
    eraserMode: string;
    mode: "pen" | "select" | "regionErase" | "erase";
    x: number;
    y: number;
    width: number;
    height: number;
    viewportWidth: number;
    penWidth: number;
    unit: number;
    appearance: PenAppearance;
    thick?: {
      penWidth: number;
      unit: number;
      opacity: number;
      color: string;
      dashed: boolean;
      appearance: PenAppearance;
    };
    thickThreshold: number;
    opacity: number;
    color: string;
    dashed: boolean;
    palm: number;
    palmEnabled: boolean;
    eraserSize: number;
    blocked: number[][];
  }): Promise<void>;
  acknowledge(options: {
    owner: string;
    id: string;
    elementId?: string;
    complete?: boolean;
  }): Promise<void>;
  remove(options: { owner: string }): Promise<void>;
  addListener(
    event: "contact",
    listener: (contact: Contact) => void,
  ): Promise<{ remove(): Promise<void> }>;
  addListener(
    event: "shortcut",
    listener: (event: { owner: string; action: string }) => void,
  ): Promise<{ remove(): Promise<void> }>;
}>("FcboardNativeInk");

// CSS stores trailing alpha; Android Color expects #AARRGGBB.
const nativeColor = (value: string) => {
  const hex = colorToHex(value);
  return hex?.length === 9
    ? `#${hex.slice(7)}${hex.slice(1, 7)}`
    : hex || value;
};

const surfaceStamp = (api: FcboardImperativeAPI) => {
  const state = api.getAppState();
  return JSON.stringify([
    classroomCommands.revision,
    (classroomCommands.read("boards") as { active?: string } | undefined)
      ?.active,
    classroomCommands.has("document.draw"),
    state.activeTool.type,
    state.eraserMode,
    state.scrollX,
    state.scrollY,
    state.zoom.value,
    state.width,
    state.height,
    state.offsetLeft,
    state.offsetTop,
  ]);
};

/** Android owns high-frequency input and preview. Existing scene composition,
 * save/export/collaboration and history receive a single completed stroke. */
export const NativeInkInteraction = ({
  api,
  inkProfile,
}: {
  api: FcboardImperativeAPI;
  inkProfile?: UIOptions["inkProfile"];
}) => {
  useEffect(() => {
    if (Capacitor.getPlatform() !== "android" || !api.nativeInk) {
      return;
    }
    let active = true;
    let failed = false;
    let frame = 0;
    let token = "";
    let configuredSurface = "";
    let previous = "";
    let uiDirty = true;
    let uiViewport = "";
    let uiBounds: number[][] = [];
    let uiBlocksInk = false;
    const contacts = new Map<string, NonNullable<Contact["mode"]>>();
    const eraser = createNativeEraserBackend(api.id);
    const objectBounds = new Map<string, readonly number[]>();
    const compositionBounds = new Map<string, readonly number[]>();
    const unregisterEraser = api.registerNativeEraserBackend?.(
      eraser.erase,
      (updated, removed) => {
        eraser.synchronize(updated, removed);
        for (const id of removed) {
          objectBounds.delete(id);
          compositionBounds.delete(id);
        }
        for (const element of updated) {
          if (element.isDeleted) {
            objectBounds.delete(element.id);
            compositionBounds.delete(element.id);
            continue;
          }
          const bounds = getCommonBounds([element]);
          objectBounds.set(element.id, bounds);
          if (
            element.customData?.fcInsertion ||
            element.customData?.fcQuestionInput ||
            element.customData?.fcQuestion
          ) {
            compositionBounds.set(element.id, bounds);
          } else {
            compositionBounds.delete(element.id);
          }
        }
      },
    );
    let eraserQueue = Promise.resolve();
    const apply = (
      contact: Contact,
      phase = contact.phase,
      restoreSelection = true,
    ) => {
      if (contact.mode === "erase") {
        return api.nativeEraserGesture!({
          ...contact,
          phase,
          restoreSelection,
        });
      }
      if (phase === "move") {
        throw new Error("Unexpected native pen movement");
      }
      if (contact.mode && contact.mode !== "pen") {
        api.nativeRegionGesture!({
          ...contact,
          mode: contact.mode,
          phase,
          restoreSelection,
        });
      } else {
        return api.nativeInk!({ ...contact, phase });
      }
    };
    const fail = (error: unknown) => {
      if (!active || failed) {
        return;
      }
      failed = true;
      void ink.remove({ owner: api.id }).catch(() => {});
      api.updateScene({
        appState: {
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
    };
    const scene = createNativeSceneRenderer(api, fail);
    const sync = () => {
      frame = 0;
      if (!active || failed) {
        return;
      }
      const state = api.getAppState();
      if (!state.width || !state.height) {
        return;
      }
      const style = whiteboardInkStyle(
        state,
        { width: 0, height: 0, pointerType: "touch" },
        inkProfile,
        1,
      );
      const threshold =
        state.whiteboardThickThreshold ?? inkProfile?.thickThreshold ?? 0;
      const dual =
        !!(state.whiteboardDualPen ?? inkProfile?.dualPen) &&
        Number.isFinite(threshold) &&
        threshold > 0;
      const thickStyle = dual
        ? whiteboardInkStyle(
            state,
            { width: threshold, height: threshold, pointerType: "touch" },
            inkProfile,
            1,
          )
        : style;
      const nativeStyle = (value: typeof style) =>
        ["hard", "dashed", "highlighter", "brush", "rainbow"].includes(
          value.customData.fcInk.pen,
        );
      const appearance = (value: typeof style): PenAppearance => {
        const data = value.customData.fcInk;
        return {
          pen: data.pen,
          variation: data.variation ?? 45,
          touchPressure: inkProfile?.touchPressure === true,
          ...(data.pen === "rainbow" && !data.gradient
            ? {
                rainbow: {
                  colors: rainbowInkStops.map((stop) => stop[1]),
                  positions: rainbowInkStops.map((stop) => stop[0]),
                },
              }
            : {}),
          ...(data.gradient
            ? {
                gradient: {
                  colors: nativeInkPalettes[data.gradient.palette],
                  size: data.gradient.size,
                  x: state.scrollX * state.zoom.value,
                  y: state.scrollY * state.zoom.value,
                },
              }
            : {}),
        };
      };
      const board = (
        classroomCommands.read("boards") as { active?: string } | undefined
      )?.active;
      const mode =
        ["selection", "lasso"].includes(state.activeTool.type) &&
        api.nativeRegionGesture
          ? "select"
          : state.activeTool.type === "eraser" &&
            state.eraserMode === "region" &&
            api.nativeRegionGesture
          ? "regionErase"
          : state.activeTool.type === "eraser" && api.nativeEraserGesture
          ? "erase"
          : "pen";
      const enabled =
        (mode !== "pen" ||
          (state.activeTool.type === "freedraw" &&
            nativeStyle(style) &&
            nativeStyle(thickStyle))) &&
        !state.viewModeEnabled &&
        !state.editingTextElement &&
        !classroomCommands.has("document.draw");
      configuredSurface = surfaceStamp(api);
      token = JSON.stringify([
        api.id,
        board,
        enabled,
        mode,
        state.scrollX,
        state.scrollY,
        state.zoom.value,
        state.currentItemPenMode,
        state.multiStroke,
        state.whiteboardPenTips,
        state.whiteboardPenWidths,
        state.whiteboardDualPen,
        threshold,
        state.currentItemInkAssist,
        state.currentItemStrokeColor,
        state.currentItemStrokeWidth,
        state.currentItemOpacity,
        state.whiteboardBrushVariation,
        state.whiteboardPenTip,
        state.eraserMode,
        state.eraserSize,
        state.palmEraser,
        state.palmEraserThreshold,
        state.width,
        state.height,
        state.offsetLeft,
        state.offsetTop,
      ]);
      const viewport = JSON.stringify([
        state.offsetLeft,
        state.offsetTop,
        state.width,
        state.height,
      ]);
      if (viewport !== uiViewport) {
        uiViewport = viewport;
        uiDirty = true;
      }
      if (enabled && uiDirty) {
        uiDirty = false;
        uiBounds = [];
        uiBlocksInk = false;
        for (const node of document.querySelectorAll<HTMLElement>(
          'button,input,textarea,select,[role="dialog"],[role="menu"],[role="listbox"],[contenteditable="true"],.MuiPaper-root,.MuiModal-root,.MuiPopper-root,.fc-editor-properties,.fc-properties-popover,.fc-combined-toolbox,.fc-resource-window,.fc-spotlight,.fc-curtain,iframe,[data-native-resource-object-id]',
        )) {
          // Kept-mounted MUI dialogs retain viewport bounds while hidden.
          // They must neither disable native input nor exclude the whole board.
          const visibility = getComputedStyle(node);
          if (
            visibility.display === "none" ||
            visibility.visibility !== "visible"
          ) {
            continue;
          }
          const box = node.getBoundingClientRect();
          if (
            box.width > 0 &&
            box.height > 0 &&
            box.right >= state.offsetLeft &&
            box.left <= state.offsetLeft + state.width &&
            box.bottom >= state.offsetTop &&
            box.top <= state.offsetTop + state.height
          ) {
            uiBounds.push([box.left, box.top, box.right, box.bottom]);
            if (
              node.matches(
                '.MuiModal-root,.MuiPopper-root,.fc-editor-properties,[role="menu"],[role="dialog"]',
              )
            ) {
              uiBlocksInk = true;
            }
          }
        }
      }
      const blocked: number[][] = enabled ? [...uiBounds] : [];
      // Table/label/question surfaces keep their existing live composition path.
      const exclusions = mode === "select" ? objectBounds : compositionBounds;
      for (const [left, top, right, bottom] of enabled
        ? exclusions.values()
        : []) {
        const padding = mode === "select" ? 12 : 0;
        blocked.push([
          (left + state.scrollX) * state.zoom.value +
            state.offsetLeft -
            padding,
          (top + state.scrollY) * state.zoom.value + state.offsetTop - padding,
          (right + state.scrollX) * state.zoom.value +
            state.offsetLeft +
            padding,
          (bottom + state.scrollY) * state.zoom.value +
            state.offsetTop +
            padding,
        ]);
      }
      // Selected contents/handles keep the existing move/resize path. Direct
      // object taps also pass through; blank-area lasso input stays native.
      const selected = state.whiteboardSelection?.bounds;
      if (mode === "select" && selected) {
        const padding = 20;
        blocked.push([
          (selected.left + state.scrollX) * state.zoom.value +
            state.offsetLeft -
            padding,
          (selected.top + state.scrollY) * state.zoom.value +
            state.offsetTop -
            padding,
          (selected.right + state.scrollX) * state.zoom.value +
            state.offsetLeft +
            padding,
          (selected.bottom + state.scrollY) * state.zoom.value +
            state.offsetTop +
            padding,
        ]);
      }
      const options: Parameters<typeof ink.configure>[0] = {
        owner: api.id,
        token,
        enabled: enabled && !uiBlocksInk && blocked.length <= 512,
        multiStroke: !state.currentItemInkAssist && state.multiStroke !== false,
        shortcutsEnabled:
          !uiBlocksInk &&
          !state.editingTextElement &&
          !document.activeElement?.closest(
            'input,textarea,select,[contenteditable="true"],[role="combobox"]',
          ),
        mode,
        eraserMode: state.eraserMode || "stroke",
        x: state.offsetLeft,
        y: state.offsetTop,
        width: state.width,
        height: state.height,
        viewportWidth: innerWidth,
        penWidth: style.strokeWidth,
        unit: style.customData.fcInk.unit || 1,
        appearance: appearance(style),
        thickThreshold: dual ? threshold : 0,
        ...(dual
          ? {
              thick: {
                penWidth: thickStyle.strokeWidth,
                unit: thickStyle.customData.fcInk.unit || 1,
                opacity: thickStyle.opacity / 100,
                color: nativeColor(thickStyle.strokeColor),
                dashed: thickStyle.strokeStyle === "dashed",
                appearance: appearance(thickStyle),
              },
            }
          : {}),
        opacity: style.opacity / 100,
        color: nativeColor(style.strokeColor),
        dashed: style.strokeStyle === "dashed",
        palm: state.palmEraserThreshold ?? inkProfile?.palmThreshold ?? 36,
        palmEnabled: state.palmEraser !== false && !!api.nativeEraserGesture,
        eraserSize: Math.max(
          12,
          Math.min(240, state.eraserSize ?? inkProfile?.eraserSize ?? 60),
        ),
        blocked: blocked.slice(0, 512),
      };
      const signature = JSON.stringify(options);
      if (signature === previous) {
        return;
      }
      previous = signature;
      void ink.configure(options).catch(fail);
    };
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(sync);
      }
    };
    const handleContact = async (contact: Contact) => {
      if (!active || contact.owner !== api.id || !contact.id) {
        return;
      }
      if (
        (contact.phase === "end" || contact.phase === "move") &&
        !contacts.has(contact.id)
      ) {
        void ink.acknowledge({ owner: api.id, id: contact.id }).catch(() => {});
        return;
      }
      let elementId: string | undefined;
      try {
        if (
          contact.phase === "cancel" ||
          contact.token !== token ||
          configuredSurface !== surfaceStamp(api)
        ) {
          await apply(
            contact,
            "cancel",
            configuredSurface === surfaceStamp(api),
          );
          contacts.delete(contact.id);
        } else {
          const result = apply(contact);
          if (typeof result === "string") {
            elementId = result;
          } else if (result) {
            await result;
          }
          if (contact.phase === "start") {
            contacts.set(contact.id, contact.mode || "pen");
          } else if (contact.phase !== "move") {
            contacts.delete(contact.id);
          }
        }
      } catch (error) {
        apply(contact, "cancel");
        fail(error);
      }
      if (contact.mode === "erase" && contact.phase !== "end") {
        void ink.acknowledge({ owner: api.id, id: contact.id }).catch(() => {});
      } else if (contact.phase === "end") {
        if (contact.mode === "erase" && contact.nativeSequence) {
          scene?.acknowledgeErase(contact.nativeSequence);
        }
        const acknowledge = () => {
          void ink
            .acknowledge({
              owner: api.id,
              id: contact.id,
              elementId,
              complete: true,
            })
            .catch(() => {});
        };
        if (elementId && scene) {
          // Native holds the preview until this exact canonical object is installed.
          acknowledge();
        } else {
          requestAnimationFrame(() => requestAnimationFrame(acknowledge));
        }
      }
    };
    const listener = ink.addListener("contact", (contact) => {
      // Native eraser start/move/end share one ordered transaction, while other
      // writers continue committing independently of the geometry worker.
      if (contact.mode === "erase") {
        eraserQueue = eraserQueue
          .then(() => handleContact(contact))
          .catch(fail);
      } else {
        void handleContact(contact).catch(fail);
      }
    });
    let shortcutQueue = Promise.resolve();
    const shortcutListener = ink.addListener("shortcut", (event) => {
      if (!event.action || event.owner !== api.id) {
        return;
      }
      shortcutQueue = shortcutQueue
        .then(async () => {
          if (!active || failed) {
            return;
          }
          const colors: Record<string, string> = {
            red: "#ff0000",
            blue: "#0000ff",
            green: "#00ff00",
            black: "#000000",
            white: "#ffffff",
          };
          if (colors[event.action]) {
            api.updateScene({
              appState: {
                currentItemStrokeColor: colors[event.action],
                currentItemInkAssist: undefined,
              },
            });
            api.setActiveTool({ type: "freedraw" });
          } else if (event.action === "lock" || event.action === "unlock") {
            api.setToast({
              message: t(
                event.action === "lock"
                  ? "fcboard.touch_locked"
                  : "fcboard.touch_unlocked",
              ),
            });
          } else if (event.action === "next" || event.action === "previous") {
            // Reuse the existing page navigation, including document pages,
            // first/last-page notices and the smart pointer's resize behavior.
            window.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: event.action === "next" ? "PageDown" : "PageUp",
                bubbles: true,
                cancelable: true,
              }),
            );
          } else {
            const name = (
              {
                new: "board.new",
                pages: "board.list",
                clear: "canvas.clear",
                split: "tools.split",
              } as Record<string, string>
            )[event.action];
            if (name) {
              await executeBoardCommand({
                name,
                ...(event.action === "split"
                  ? {
                      args: {
                        open: !document.querySelector(".fc-split-board"),
                        count: 2,
                      },
                    }
                  : {}),
              });
            }
          }
        })
        .catch((error) => {
          if (active) {
            api.updateScene({ appState: { errorMessage: String(error) } });
          }
        });
    });
    const scheduleUi = () => {
      uiDirty = true;
      schedule();
    };
    const observer = new MutationObserver(scheduleUi);
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    const stops = [
      api.onChange(schedule),
      classroomCommands.watch("document", schedule),
      classroomCommands.watch("boards", schedule),
      classroomCommands.onInvalidate(() => {
        token = "";
        previous = "";
        for (const [id, mode] of contacts) {
          apply(
            {
              id,
              mode,
              owner: api.id,
              token,
              phase: "cancel",
              points: [],
              width: 0,
              height: 0,
              pointerType: "touch",
            },
            "cancel",
            false,
          );
        }
        contacts.clear();
        void eraser.reset().catch(fail);
        scene?.reset();
        void ink.remove({ owner: api.id }).catch(() => {});
        schedule();
      }),
    ];
    addEventListener("resize", scheduleUi);
    addEventListener("scroll", scheduleUi, true);
    addEventListener("focusin", scheduleUi);
    addEventListener("focusout", scheduleUi);
    schedule();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      stops.forEach((stop) => stop());
      removeEventListener("resize", scheduleUi);
      removeEventListener("scroll", scheduleUi, true);
      removeEventListener("focusin", scheduleUi);
      removeEventListener("focusout", scheduleUi);
      for (const [id, mode] of contacts) {
        apply(
          {
            id,
            mode,
            owner: api.id,
            token,
            phase: "cancel",
            points: [],
            width: 0,
            height: 0,
            pointerType: "touch",
          },
          "cancel",
          false,
        );
      }
      unregisterEraser?.();
      scene?.dispose();
      void eraser.reset().catch(() => {});
      void listener.then((handle) => handle.remove()).catch(() => {});
      void shortcutListener.then((handle) => handle.remove()).catch(() => {});
      void ink.remove({ owner: api.id }).catch(() => {});
    };
  }, [api, inkProfile]);
  return null;
};
