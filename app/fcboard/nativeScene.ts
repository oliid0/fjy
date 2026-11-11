import { registerPlugin } from "@capacitor/core";
import rough from "roughjs/bin/rough";
import {
  applyDarkModeFilter,
  colorToHex,
  FRAME_STYLE,
  DEFAULT_REDUCED_GLOBAL_ALPHA,
} from "@fcboard/common";
import {
  getBoundTextElement,
  getCommonBounds,
  getElementAbsoluteCoords,
  getContainingFrame,
  isIframeLikeElement,
  getTargetFrame,
  shouldApplyFrameClip,
  isNonDeletedElement,
} from "@fcboard/element";
import { getFreeDrawSvgPath } from "@fcboard/element/shape";
import { isFactoryStroke, factoryInkDashes } from "@fcboard/element/factoryInk";
import { factoryNibPath } from "@fcboard/element/factoryNib";
import { nativeInkGradient } from "@fcboard/element/nativeInkColor";
import {
  rainbowInkCoordinates,
  rainbowInkStops,
} from "@fcboard/element/rainbowInk";
import { getRenderOpacity } from "@fcboard/element/renderElement";
import { renderStaticScene } from "@fcboard/fcboard/renderer/staticScene";
import { backgroundImage } from "@fcboard/fcboard/whiteboardBackground";

import type { FcboardElement } from "@fcboard/element/types";
import type { StaticSceneRenderConfig } from "@fcboard/fcboard/scene/types";
import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { classroomCommands } from "./commands";

type NativeNode = {
  id: string;
  order: string;
  version: number;
  nonce: number;
  through: number;
  ink: boolean;
  bounds: readonly number[];
  bitmap?: string;
  path?: string;
  nib?: string;
  transform?: number[];
  clip?: number[];
  color?: string;
  opacity?: number;
  strokeWidth?: number;
  dashes?: number[];
  dashOffset?: number;
  gradient?: {
    coordinates: readonly number[];
    colors: string[];
    positions: number[];
  };
};
const native = registerPlugin<{
  synchronize(options: {
    owner: string;
    epoch: number;
    revision: number;
    reset: boolean;
    viewportWidth: number;
    x: number;
    y: number;
    width: number;
    height: number;
    zoom: number;
    scrollX: number;
    scrollY: number;
    eraseThrough: number;
    background?: string;
    nodes: NativeNode[];
    removals: string[];
  }): Promise<void>;
  remove(options: { owner: string; epoch: number }): Promise<void>;
}>("FcboardNativeScene");

const nativeColor = (value: string) => {
  const hex = colorToHex(value);
  return hex?.length === 9
    ? `#${hex.slice(7)}${hex.slice(1, 7)}`
    : hex || value;
};

/** Canonical stroke geometry comes from the same traces used by Canvas/export.
 * Non-ink retains the actual editor renderer, including fonts, images and binds. */
export const nativeSceneNode = (
  element: FcboardElement,
  config: StaticSceneRenderConfig,
  through = -1,
): NativeNode | undefined => {
  if (!isNonDeletedElement(element) || !config.elementsMap.has(element.id)) {
    return;
  }
  if (
    element.type === "text" &&
    element.containerId &&
    config.elementsMap.has(element.containerId)
  ) {
    return;
  }
  const label = getBoundTextElement(element, config.elementsMap);
  const bounds = getCommonBounds(label ? [element, label] : [element]);
  const base: NativeNode = {
    id: element.id,
    order: `${isIframeLikeElement(element) ? "~" : ""}${
      element.index || element.id
    }`,
    version: element.version,
    nonce: element.versionNonce,
    through,
    ink: element.type === "freedraw" && !element.locked,
    bounds,
  };
  if (
    element.type === "freedraw" &&
    element.backgroundColor === "transparent"
  ) {
    const [x1, y1, x2, y2] = getElementAbsoluteCoords(
      element,
      config.elementsMap,
    );
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const factory = isFactoryStroke(element);
    const gradient = nativeInkGradient(element);
    const rainbow = gradient ? null : rainbowInkCoordinates(element);
    const stops = gradient?.stops || (rainbow ? rainbowInkStops : undefined);
    const frame = getContainingFrame(element, config.elementsMap);
    const clipping = getTargetFrame(
      element,
      config.elementsMap,
      config.appState,
    );
    return {
      ...base,
      path: getFreeDrawSvgPath(element),
      nib: factory ? factoryNibPath(element) : "",
      transform: [
        cx,
        cy,
        (x2 - x1) / 2 - (element.x - x1),
        (y2 - y1) / 2 - (element.y - y1),
        element.angle,
      ],
      ...(clipping &&
      config.appState.frameRendering.enabled &&
      shouldApplyFrameClip(
        element,
        clipping,
        config.appState,
        config.elementsMap,
      )
        ? {
            clip: [
              clipping.x,
              clipping.y,
              clipping.width,
              clipping.height,
              FRAME_STYLE.radius / config.appState.zoom.value,
            ],
          }
        : {}),
      color: nativeColor(
        config.appState.theme === "dark"
          ? applyDarkModeFilter(element.strokeColor)
          : element.strokeColor,
      ),
      opacity: getRenderOpacity(
        element,
        frame,
        config.renderConfig.elementsPendingErasure,
        config.renderConfig.pendingFlowchartNodes,
        config.appState.openDialog?.name === "elementLinkSelector" &&
          !config.appState.selectedElementIds[element.id] &&
          !config.appState.hoveredElementIds[element.id]
          ? DEFAULT_REDUCED_GLOBAL_ALPHA
          : 1,
      ),
      strokeWidth: factory ? element.strokeWidth : 0,
      ...(factory && element.strokeStyle !== "solid"
        ? {
            dashes: factoryInkDashes(element),
            dashOffset: element.customData?.fcInk?.dashOffset || 0,
          }
        : {}),
      ...(stops
        ? {
            gradient: {
              coordinates: gradient?.coordinates || rainbow!,
              colors: stops.map((stop) => nativeColor(stop[1])),
              positions: stops.map((stop) => stop[0]),
            },
          }
        : {}),
    };
  }
  const state = config.appState;
  const margin = 32 / state.zoom.value;
  const left = Math.max(bounds[0] - margin, -state.scrollX);
  const top = Math.max(bounds[1] - margin, -state.scrollY);
  const right = Math.min(
    bounds[2] + margin,
    -state.scrollX + state.width / state.zoom.value,
  );
  const bottom = Math.min(
    bounds[3] + margin,
    -state.scrollY + state.height / state.zoom.value,
  );
  if (right <= left || bottom <= top) {
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(
    1,
    Math.ceil((right - left) * state.zoom.value * config.scale),
  );
  canvas.height = Math.max(
    1,
    Math.ceil((bottom - top) * state.zoom.value * config.scale),
  );
  try {
    renderStaticScene({
      ...config,
      canvas,
      rc: rough.canvas(canvas),
      visibleElements: [element],
      appState: {
        ...state,
        width: canvas.width / config.scale,
        height: canvas.height / config.scale,
        scrollX: -left,
        scrollY: -top,
        viewBackgroundColor: null,
        whiteboardBackground: undefined,
      },
      renderConfig: {
        ...config.renderConfig,
        renderGrid: false,
        pendingFlowchartNodes: null,
      },
    });
    return {
      ...base,
      bounds: [left, top, right, bottom],
      bitmap: canvas.toDataURL("image/png"),
    };
  } finally {
    canvas.width = canvas.height = 1;
  }
};

const background = (config: StaticSceneRenderConfig) => {
  const canvas = document.createElement("canvas");
  canvas.width = config.canvas.width;
  canvas.height = config.canvas.height;
  try {
    renderStaticScene({
      ...config,
      canvas,
      rc: rough.canvas(canvas),
      visibleElements: [],
      renderConfig: { ...config.renderConfig, pendingFlowchartNodes: null },
    });
    return canvas.toDataURL("image/png");
  } finally {
    canvas.width = canvas.height = 1;
  }
};

/** The display bridge consumes committed object deltas, never eraser MOVE points.
 * Android keeps its bitmap tiles through acknowledgements and editor idle time. */
export const createNativeSceneRenderer = (
  api: FcboardImperativeAPI,
  onError: (error: unknown) => void,
) => {
  if (!api.onSceneMutation || !api.registerNativeSceneRenderer) {
    return;
  }
  let alive = true;
  let failed = false;
  let ready = false;
  let busy = false;
  let scheduled = false;
  let epoch = Date.now();
  let revision = 0;
  let reset = true;
  let view = "";
  let paint = "";
  let bg = "";
  let latest: StaticSceneRenderConfig | undefined;
  let eraseThrough = 0;
  const sources = new Map<string, FcboardElement>();
  const dirty = new Map<string, number>();
  const removals = new Set<string>();
  const bitmaps = new Set<string>();
  const imageStates = new Map<string, unknown>();
  const queue = () => {
    if (!scheduled && !busy && alive && !failed) {
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        void flush();
      });
    }
  };
  const stopMutations = api.onSceneMutation((updated, removed, through) => {
    for (const id of removed) {
      sources.delete(id);
      dirty.delete(id);
      bitmaps.delete(id);
      removals.add(id);
    }
    for (const element of updated) {
      if (element.isDeleted) {
        sources.delete(element.id);
        dirty.delete(element.id);
        bitmaps.delete(element.id);
        removals.add(element.id);
      } else {
        sources.set(element.id, element);
        dirty.set(element.id, through ?? -1);
        removals.delete(element.id);
      }
      if (element.type === "text" && element.containerId) {
        dirty.set(element.containerId, -1);
      }
      if (element.type === "frame" || element.type === "magicframe") {
        for (const child of sources.values()) {
          if (child.frameId === element.id) {
            dirty.set(child.id, -1);
          }
        }
      }
    }
  });
  const deactivate = () => {
    ready = false;
    document.documentElement.classList.remove("fc-native-scene");
  };
  const flush = async () => {
    const config = latest;
    if (
      !alive ||
      failed ||
      busy ||
      !config ||
      !config.appState.width ||
      !config.appState.height ||
      classroomCommands.has("document.draw")
    ) {
      return;
    }
    busy = true;
    const stamp = epoch;
    try {
      const state = config.appState;
      const viewport = JSON.stringify([
        state.width,
        state.height,
        state.offsetLeft,
        state.offsetTop,
        state.scrollX,
        state.scrollY,
        state.zoom.value,
        config.scale,
        innerWidth,
      ]);
      const changedView = viewport !== view;
      const pigment = JSON.stringify([
        state.theme,
        state.frameRendering,
        state.openDialog?.name === "elementLinkSelector"
          ? state.selectedElementIds
          : null,
        state.openDialog?.name === "elementLinkSelector"
          ? state.hoveredElementIds
          : null,
        api.getAppState().editingTextElement?.id,
        state.frameToHighlight?.id,
      ]);
      if (changedView || pigment !== paint || reset) {
        for (const id of sources.keys()) {
          if (!dirty.has(id)) {
            dirty.set(id, -1);
          }
        }
      }
      for (const id of bitmaps) {
        const element = sources.get(id);
        if (element?.type === "image" && element.fileId) {
          const image = config.renderConfig.imageCache.get(element.fileId);
          if (imageStates.get(id) !== image) {
            imageStates.set(id, image);
            dirty.set(id, -1);
          }
        }
      }
      const backgroundKey = JSON.stringify([
        viewport,
        state.theme,
        state.viewBackgroundColor,
        state.whiteboardBackground,
        !!(
          state.whiteboardBackground &&
          backgroundImage(state.whiteboardBackground)
        ),
        state.gridSize,
        state.gridStep,
        config.renderConfig.renderGrid,
      ]);
      const activate = () => {
        if (!ready) {
          ready = true;
          document.documentElement.classList.add("fc-native-scene");
          stopRenderer.invalidate();
        }
      };
      if (
        !dirty.size &&
        !removals.size &&
        backgroundKey === bg &&
        !reset &&
        !eraseThrough
      ) {
        activate();
        return;
      }
      const nodes: NativeNode[] = [];
      const deleted = new Set(removals);
      for (const [id, through] of dirty) {
        const source = sources.get(id);
        const node = source && nativeSceneNode(source, config, through);
        if (node) {
          nodes.push(node);
          if (node.bitmap) {
            bitmaps.add(id);
          } else {
            bitmaps.delete(id);
          }
        } else {
          deleted.add(id);
        }
      }
      dirty.clear();
      removals.clear();
      const request = ++revision;
      const acknowledged = eraseThrough;
      eraseThrough = 0;
      await native.synchronize({
        owner: api.id,
        epoch: stamp,
        revision: request,
        reset,
        viewportWidth: innerWidth,
        x: state.offsetLeft,
        y: state.offsetTop,
        width: state.width,
        height: state.height,
        zoom: state.zoom.value,
        scrollX: state.scrollX,
        scrollY: state.scrollY,
        eraseThrough: acknowledged,
        ...(backgroundKey !== bg || reset
          ? { background: background(config) }
          : {}),
        nodes,
        removals: [...deleted],
      });
      if (!alive || stamp !== epoch) {
        return;
      }
      reset = false;
      view = viewport;
      paint = pigment;
      bg = backgroundKey;
      activate();
    } catch (error) {
      if (alive && stamp === epoch) {
        failed = true;
        deactivate();
        void native.remove({ owner: api.id, epoch }).catch(() => {});
        stopRenderer.invalidate();
        onError(error);
      }
    } finally {
      busy = false;
      if (dirty.size || removals.size || eraseThrough || latest !== config) {
        queue();
      }
    }
  };
  const stopRenderer = api.registerNativeSceneRenderer((config) => {
    latest = config;
    if (classroomCommands.has("document.draw")) {
      deactivate();
      return false;
    }
    queue();
    return ready && !failed;
  });
  const stopDocument = classroomCommands.watch("document", () => {
    if (classroomCommands.has("document.draw")) {
      deactivate();
    }
    stopRenderer.invalidate();
  });
  const fonts = () => {
    for (const id of bitmaps) {
      dirty.set(id, -1);
    }
    queue();
  };
  document.fonts?.addEventListener?.("loadingdone", fonts);
  return {
    acknowledgeErase(sequence: number) {
      eraseThrough = Math.max(eraseThrough, sequence);
      queue();
    },
    reset() {
      epoch++;
      reset = true;
      view = paint = bg = "";
      latest = undefined;
      eraseThrough = 0;
      deactivate();
      for (const id of sources.keys()) {
        dirty.set(id, -1);
      }
      void native.remove({ owner: api.id, epoch }).catch(onError);
    },
    dispose() {
      alive = false;
      deactivate();
      stopMutations();
      stopDocument();
      stopRenderer();
      document.fonts?.removeEventListener?.("loadingdone", fonts);
      void native.remove({ owner: api.id, epoch: ++epoch }).catch(() => {});
    },
  };
};
