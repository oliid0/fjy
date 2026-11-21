import { useEffect } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  CaptureUpdateAction,
  getCommonBounds,
  getSelectedElements,
  isIframeLikeElement,
} from "@fcboard/element";
import { colorToHex, MIN_FONT_SIZE } from "@fcboard/common";
import { t } from "@fcboard/fcboard/i18n";
import { whiteboardInkStyle } from "@fcboard/fcboard/whiteboardPen";
import { nativeInkPalettes } from "@fcboard/element/nativeInkColor";
import { rainbowInkStops } from "@fcboard/element/rainbowInk";

import type { FcboardElement } from "@fcboard/element/types";

import type { FcboardImperativeAPI, UIOptions } from "@fcboard/fcboard/types";

import { classroomCommands, executeBoardCommand } from "./commands";
import { transformBoardElement } from "./canvasTransform";
import { createNativeEraserBackend } from "./nativeEraser";
import { createNativeSceneRenderer } from "./nativeScene";

import "./NativeScene.scss";

type Contact = {
  owner: string;
  id: string;
  token: string;
  phase: "start" | "move" | "end" | "cancel";
  mode?: "pen" | "select" | "regionErase" | "erase" | "transform";
  transform?: {
    scale: number;
    dx: number;
    dy: number;
    anchorX: number;
    anchorY: number;
  };
  points: [number, number, number][];
  width: number;
  height: number;
  palm?: boolean;
  pointerType: string;
  nativeSequence?: number;
  cuts?: import("@fcboard/fcboard/eraser/stroke").NativeInkCut[];
};
type PenAppearance = {
  pen: string;
  variation: number;
  touchPressure: boolean;
  rainbow?: { colors: string[]; positions: number[] };
  gradient?: { colors: readonly string[]; size: number; x: number; y: number };
};
const ink = registerPlugin<{
  ready(options: { owner: string; fallback: boolean }): Promise<void>;
  configure(options: {
    owner: string;
    token: string;
    inputSpace: string;
    enabled: boolean;
    overlayPreview?: boolean;
    multiStroke: boolean;
    recognitionEnabled: boolean;
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
    selectionBounds?: number[];
    selectionKey?: string;
    selectionMinScale?: number;
    selectionResize?: boolean;
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

const boardControls =
  'button,input,textarea,select,[aria-modal="true"],[role="dialog"],[role="menu"],[role="listbox"],[contenteditable="true"],.MuiPaper-root,.MuiModal-root,.fc-editor-properties,.fc-properties-popover,.fc-factory-color-wheel,.fc-combined-toolbox,.fc-resource-window,.fc-spotlight,.fc-curtain,iframe,[data-native-resource-object-id]';

const surfaceStamp = (api: FcboardImperativeAPI) => {
  const state = api.getAppState();
  return JSON.stringify([
    classroomCommands.revision,
    (classroomCommands.read("boards") as { active?: string } | undefined)
      ?.active,
    classroomCommands.has("document.draw"),
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
    let configuredTool = "";
    let previous = "";
    let uiDirty = true;
    let uiViewport = "";
    let uiBounds: number[][] = [];
    let uiBlocksInk = false;
    let inputReady = false;
    let startupReport: boolean | undefined;
    const reportStartup = (fallback = false) => {
      if (
        !active ||
        startupReport === true ||
        startupReport === fallback ||
        api.getAppState().isLoading ||
        !document.querySelector(".fc-unified-toolbar")
      ) {
        return;
      }
      startupReport = fallback;
      void ink.ready({ owner: api.id, fallback }).catch((error) => {
        if (startupReport === fallback) {
          startupReport = undefined;
        }
        console.error("[startup-ready]", error);
      });
    };
    const contacts = new Map<
      string,
      { mode: NonNullable<Contact["mode"]>; token: string; surface: string }
    >();
    const eraser = createNativeEraserBackend(api.id);
    const compositionBounds = new Map<string, readonly number[]>();
    const selectionElements = new Map<string, FcboardElement>();
    const unregisterEraser = api.registerNativeEraserBackend?.(
      eraser.erase,
      (updated, removed) => {
        eraser.synchronize(updated, removed);
        for (const id of removed) {
          compositionBounds.delete(id);
          selectionElements.delete(id);
        }
        for (const element of updated) {
          if (element.isDeleted) {
            compositionBounds.delete(element.id);
            selectionElements.delete(element.id);
            continue;
          }
          selectionElements.set(element.id, element);
          if (element.customData?.fcInsertion) {
            compositionBounds.set(element.id, getCommonBounds([element]));
          } else {
            compositionBounds.delete(element.id);
          }
        }
      },
      eraser.clip,
    );
    const selections = new Map<
      string,
      {
        ids: string[];
        versions: number[];
        region: NonNullable<
          ReturnType<typeof api.getAppState>["whiteboardSelection"]
        >;
      }
    >();
    let contactQueue = Promise.resolve();
    let queuedContacts = 0;
    let generation = 0;
    const apply = (
      contact: Contact,
      phase = contact.phase,
      restoreSelection = true,
    ) => {
      if (contact.mode === "transform") {
        const clear = () =>
          document.documentElement.classList.remove(
            "fc-native-selection-transform",
          );
        if (phase === "start") {
          const state = api.getAppState();
          if (state.whiteboardSelection) {
            const selected = getSelectedElements(
              api.getSceneElements(),
              state,
              { includeBoundTextElement: true, includeElementsInFrames: true },
            );
            selections.set(contact.id, {
              ids: selected.map((element) => element.id),
              versions: selected.map((element) => element.version),
              region: state.whiteboardSelection,
            });
            document.documentElement.classList.add(
              "fc-native-selection-transform",
            );
          }
          return;
        }
        const original = selections.get(contact.id);
        selections.delete(contact.id);
        if (phase === "cancel" || !original || !contact.transform) {
          clear();
          return;
        }
        const transform = contact.transform;
        const state = api.getAppState();
        const elements = api.getSceneElements();
        const current = new Map(
          elements.map((element) => [element.id, element]),
        );
        if (
          original.ids.some(
            (id, index) =>
              current.get(id)?.version !== original.versions[index],
          )
        ) {
          clear();
          return scene?.acknowledgeSelection(contact.id);
        }
        if (
          !Object.values(transform).every(Number.isFinite) ||
          transform.scale < 0.1 ||
          transform.scale > 10
        ) {
          throw new Error("Invalid native selection transform");
        }
        const anchor = {
          x:
            (transform.anchorX - state.offsetLeft) / state.zoom.value -
            state.scrollX,
          y:
            (transform.anchorY - state.offsetTop) / state.zoom.value -
            state.scrollY,
        };
        // Android's float round-trip can fall just below the exact font-size limit.
        const scale =
          transform.scale === 1
            ? 1
            : original.ids.reduce((value, id) => {
                const element = current.get(id);
                return element?.type === "text"
                  ? Math.max(value, MIN_FONT_SIZE / element.fontSize)
                  : value;
              }, transform.scale);
        const dx = transform.dx / state.zoom.value;
        const dy = transform.dy / state.zoom.value;
        const point = (x: number, y: number) =>
          [
            anchor.x + (x - anchor.x) * scale + dx,
            anchor.y + (y - anchor.y) * scale + dy,
          ] as const;
        const [left, top] = point(
          original.region.bounds.left,
          original.region.bounds.top,
        );
        const [right, bottom] = point(
          original.region.bounds.right,
          original.region.bounds.bottom,
        );
        const ids = new Set(original.ids);
        try {
          api.updateScene({
            elements: elements.map((element) =>
              ids.has(element.id)
                ? transformBoardElement(element, anchor, scale, dx, dy)
                : element,
            ),
            appState: {
              whiteboardSelection: {
                ...original.region,
                bounds: { left, top, right, bottom },
                path: original.region.path?.map(([x, y]) =>
                  point(x, y),
                ) as typeof original.region.path,
              },
            },
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          });
        } catch (error) {
          clear();
          throw error;
        }
        return scene?.acknowledgeSelection(contact.id).finally(clear);
      }
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
      generation++;
      for (const [id, { mode }] of contacts) {
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
        );
      }
      contacts.clear();
      scene?.dispose();
      void ink.remove({ owner: api.id }).catch(() => {});
      api.updateScene({
        appState: {
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      requestAnimationFrame(() => reportStartup(true));
    };
    const scene = createNativeSceneRenderer(api, fail);
    const sync = () => {
      frame = 0;
      if (!active) {
        return;
      }
      if (failed) {
        reportStartup(true);
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
      const overlayPreview = !!api.getSceneProjection?.();
      configuredSurface = surfaceStamp(api);
      configuredTool = state.activeTool.type;
      token = JSON.stringify([
        api.id,
        generation,
        board,
        enabled,
        overlayPreview,
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
          boardControls,
        )) {
          const visibility = getComputedStyle(node);
          if (
            visibility.display === "none" ||
            visibility.visibility !== "visible" ||
            visibility.pointerEvents === "none" ||
            node.closest(".MuiModal-hidden,[hidden]")
          ) {
            continue;
          }
          const box = node.getBoundingClientRect();
          if (
            box.width <= 0 ||
            box.height <= 0 ||
            box.right <= state.offsetLeft ||
            box.left >= state.offsetLeft + state.width ||
            box.bottom <= state.offsetTop ||
            box.top >= state.offsetTop + state.height
          ) {
            continue;
          }
          // MUI Modal also powers Menu and Popover, whose viewport layer
          // handles outside clicks. Popper has no such layer.
          if (node.matches('[aria-modal="true"],.MuiModal-root')) {
            uiBlocksInk = true;
          }
          // A panel's rectangle already covers its controls, including large
          // scrollable lists. Keep portalled or overflowing controls separately.
          if (
            !uiBounds.some(
              ([left, top, right, bottom]) =>
                left <= box.left &&
                top <= box.top &&
                right >= box.right &&
                bottom >= box.bottom,
            )
          ) {
            uiBounds.push([box.left, box.top, box.right, box.bottom]);
          }
        }
      }
      const blocked: number[][] = enabled ? [...uiBounds] : [];
      // Table, label and question surfaces retain their live composition path.
      // Only on-screen boxes can intercept a contact.
      if (enabled && mode === "pen") {
        for (const [left, top, right, bottom] of compositionBounds.values()) {
          const x = (left + state.scrollX) * state.zoom.value;
          const y = (top + state.scrollY) * state.zoom.value;
          const endX = (right + state.scrollX) * state.zoom.value;
          const endY = (bottom + state.scrollY) * state.zoom.value;
          if (endX > 0 && x < state.width && endY > 0 && y < state.height) {
            blocked.push([
              x + state.offsetLeft,
              y + state.offsetTop,
              endX + state.offsetLeft,
              endY + state.offsetTop,
            ]);
          }
        }
      }
      const selected = state.whiteboardSelection?.bounds;
      const contents =
        mode === "select" && selected
          ? getSelectedElements(selectionElements, state, {
              includeBoundTextElement: true,
              includeElementsInFrames: true,
            })
          : [];
      const selectionBounds =
        mode === "select" && selected
          ? [
              (selected.left + state.scrollX) * state.zoom.value +
                state.offsetLeft,
              (selected.top + state.scrollY) * state.zoom.value +
                state.offsetTop,
              (selected.right + state.scrollX) * state.zoom.value +
                state.offsetLeft,
              (selected.bottom + state.scrollY) * state.zoom.value +
                state.offsetTop,
            ]
          : undefined;
      const movesHtml = contents.some(isIframeLikeElement);
      if (movesHtml && selectionBounds) {
        const [left, top, right, bottom] = selectionBounds;
        // The live iframe and blue frame must move on the same board gesture.
        // Only this selection's handles and interior use the browser editor.
        blocked.push([left - 20, top - 20, right + 20, bottom + 20]);
      }
      const options: Parameters<typeof ink.configure>[0] = {
        owner: api.id,
        token,
        inputSpace: configuredSurface,
        overlayPreview,
        enabled: enabled && !uiBlocksInk && blocked.length <= 512,
        multiStroke: !state.currentItemInkAssist && state.multiStroke !== false,
        recognitionEnabled:
          !!state.currentItemInkAssist || compositionBounds.size > 0,
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
        selectionBounds: movesHtml ? undefined : selectionBounds,
        selectionKey: contents
          .map((element) => element.id)
          .sort()
          .join("\u0000"),
        selectionMinScale: contents.reduce(
          (minimum, element) =>
            Math.max(
              minimum,
              element.type === "text" ? MIN_FONT_SIZE / element.fontSize : 0.1,
            ),
          0.1,
        ),
        selectionResize: contents.every(
          (element) => element.customData?.fcInsertion?.kind !== "table",
        ),
      };
      const signature = JSON.stringify(options);
      if (signature === previous) {
        if (inputReady) {
          reportStartup();
        }
        return;
      }
      previous = signature;
      void ink.configure(options).then(() => {
        inputReady = true;
        reportStartup();
      }, fail);
    };
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(sync);
      }
    };
    const handleContact = async (contact: Contact, received = generation) => {
      if (
        !active ||
        failed ||
        received !== generation ||
        contact.owner !== api.id ||
        !contact.id
      ) {
        return;
      }
      if (
        (contact.phase === "end" || contact.phase === "move") &&
        !contacts.has(contact.id)
      ) {
        void ink.acknowledge({ owner: api.id, id: contact.id }).catch(() => {});
        return;
      }
      const opened = contacts.get(contact.id);
      const surface = opened?.surface ?? configuredSurface;
      const current = () =>
        contact.token === (opened?.token ?? token) &&
        (opened || configuredTool === api.getAppState().activeTool.type) &&
        surface === surfaceStamp(api);
      let elementId: string | undefined;
      try {
        if (contact.phase === "cancel" || !current()) {
          await apply(contact, "cancel", surface === surfaceStamp(api));
          contacts.delete(contact.id);
        } else {
          // Register before waiting: invalidation must be able to cancel even
          // the first geometry request, not only an acknowledged contact.
          if (contact.phase === "start") {
            contacts.set(contact.id, {
              mode: contact.mode || "pen",
              token: contact.token,
              surface,
            });
          }
          const applied = apply(contact);
          const result = applied instanceof Promise ? await applied : applied;
          if (typeof result === "string") {
            elementId = result;
            if (
              contact.mode === "pen" &&
              contact.phase === "end" &&
              result === contact.id &&
              !contact.cuts?.length
            ) {
              scene?.finishedInk(result, contact.nativeSequence ?? 0);
            }
          }
          if (!active || failed || received !== generation) {
            return;
          }
          if (!current()) {
            apply(contact, "cancel", surface === surfaceStamp(api));
            contacts.delete(contact.id);
            return;
          }
          if (
            contact.mode === "erase" &&
            contact.phase !== "start" &&
            contact.nativeSequence
          ) {
            // Empty hits also complete vector reconciliation. Do not retain an
            // unbounded history of cuts during a long sweep over empty space.
            scene?.acknowledgeErase(contact.nativeSequence);
          }
          if (contact.phase !== "start" && contact.phase !== "move") {
            contacts.delete(contact.id);
          }
        }
      } catch (error) {
        if (!active || received !== generation) {
          return;
        }
        apply(contact, "cancel");
        fail(error);
      }
      if (contact.mode === "erase" && contact.phase !== "end") {
        void ink.acknowledge({ owner: api.id, id: contact.id }).catch(() => {});
      } else if (contact.phase === "end") {
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
        if (elementId && scene && !api.getSceneProjection?.()) {
          // Native holds the preview until this exact canonical object is installed.
          acknowledge();
        } else {
          requestAnimationFrame(() => requestAnimationFrame(acknowledge));
        }
      }
    };
    const projectionTaps = new Map<string, Contact["points"][number]>();
    const listener = ink.addListener("contact", (contact) => {
      if (contact.owner === api.id) {
        if (
          contact.phase === "start" &&
          !contact.palm &&
          contact.mode !== "transform" &&
          contact.points[0] &&
          api.getSceneProjection?.()
        ) {
          projectionTaps.set(contact.id, contact.points[0]);
        }
        const first = projectionTaps.get(contact.id);
        if (
          first &&
          (contact.phase === "cancel" ||
            contact.points.some(
              ([x, y]) => Math.hypot(x - first[0], y - first[1]) > 10,
            ))
        ) {
          projectionTaps.delete(contact.id);
        } else if (first && contact.phase === "end") {
          projectionTaps.delete(contact.id);
          window.dispatchEvent(
            new CustomEvent("fcboard:projection-tap", {
              detail: { owner: api.id, clientX: first[0], clientY: first[1] },
            }),
          );
        }
      }
      // A crossed pen must settle between the surrounding eraser batches.
      // Unaffected writers and selection retain their synchronous entry path.
      if (
        contact.mode === "erase" ||
        (contact.phase === "end" &&
          (queuedContacts > 0 || contact.cuts?.length))
      ) {
        const received = generation;
        queuedContacts++;
        contactQueue = contactQueue
          .then(() => handleContact(contact, received))
          .catch(fail)
          .finally(() => {
            queuedContacts--;
          });
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
    const observer = new MutationObserver((records) => {
      if (
        records.some((record) => {
          const target = record.target;
          if (
            target instanceof SVGElement ||
            target instanceof HTMLCanvasElement
          ) {
            return false;
          }
          if (record.type === "attributes") {
            return (
              [
                "style",
                "class",
                "hidden",
                "open",
                "aria-hidden",
                "aria-modal",
              ].includes(record.attributeName || "") &&
              target instanceof HTMLElement &&
              (!!target.closest(boardControls) ||
                !!target.querySelector(boardControls))
            );
          }
          return (
            (target instanceof HTMLElement &&
              !!target.closest(boardControls)) ||
            [...record.addedNodes, ...record.removedNodes].some(
              (node) =>
                node instanceof HTMLElement &&
                (node.matches(boardControls) ||
                  !!node.querySelector(boardControls)),
            )
          );
        })
      ) {
        scheduleUi();
      }
    });
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
        generation++;
        contactQueue = Promise.resolve();
        token = "";
        previous = "";
        for (const [id, { mode }] of contacts) {
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
        eraser.synchronize([...selectionElements.values()], []);
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
      generation++;
      document.documentElement.classList.remove(
        "fc-native-selection-transform",
      );
      cancelAnimationFrame(frame);
      observer.disconnect();
      stops.forEach((stop) => stop());
      removeEventListener("resize", scheduleUi);
      removeEventListener("scroll", scheduleUi, true);
      removeEventListener("focusin", scheduleUi);
      removeEventListener("focusout", scheduleUi);
      for (const [id, { mode }] of contacts) {
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
