import { t } from "@excalidraw/excalidraw/i18n";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import { getCommonBounds } from "@excalidraw/element";
import { DEFAULT_ELEMENT_PROPS, FONT_FAMILY } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { project3D, samplePlot, sampleInequality } from "./math";
import { classroomCommands } from "./commands";
import { currentSettings } from "./settings";
import { handwritingElements, inkLineHeight, inkLines } from "./handwriting";
import { findContentPosition, findVisibleContentPosition } from "./placement";
import { layoutBoardText } from "./textLayout";
import { fitPlot } from "./plotLayout";

import type { TextPlacement } from "./textLayout";

import type { Settings } from "./settings";

import type { InkStroke } from "./documents";

import type { Plot } from "./math";
import type { ContentRect } from "./placement";

const toolbarClearance = (api: ExcalidrawImperativeAPI) => {
  const state = api.getAppState();
  if (state.toolbarHidden) {
    return 16;
  }
  const toolbar = document.querySelector<HTMLElement>(
    `.excalidraw[data-excalidraw-id="${api.id}"] .fc-unified-toolbar`,
  );
  const rect = toolbar?.getBoundingClientRect();
  if (rect?.height) {
    return Math.max(16, state.height - rect.top + (state.offsetTop || 0) + 16);
  }
  return 84;
};

export const contentViewport = (api: ExcalidrawImperativeAPI) => {
  const state = api.getAppState();
  const gap = 16 / state.zoom.value;
  return {
    left: -state.scrollX + gap,
    top: -state.scrollY + gap,
    right: -state.scrollX + (state.width || 1280) / state.zoom.value - gap,
    bottom:
      -state.scrollY +
      ((state.height || 720) - toolbarClearance(api)) / state.zoom.value,
  };
};

export const contentPosition = (
  api: ExcalidrawImperativeAPI,
  preferred: { x: number; y: number },
  size: { width: number; height: number },
  excludeIds: readonly string[] = [],
) => {
  const state = api.getAppState();
  const zoom = state.zoom.value;
  const gap = 16 / zoom;
  return findContentPosition(
    preferred,
    size,
    {
      left: -state.scrollX + gap,
      top: -state.scrollY + gap,
      right: -state.scrollX + (state.width || 1280) / zoom - gap,
      bottom:
        -state.scrollY + ((state.height || 720) - toolbarClearance(api)) / zoom,
    },
    api
      .getSceneElements()
      .filter(
        (element) => !element.isDeleted && !excludeIds.includes(element.id),
      )
      .map((element) => {
        const [left, top, right, bottom] = getCommonBounds([element]);
        return { left, top, right, bottom };
      }),
    gap,
  );
};

export const insertionPoint = (
  api: ExcalidrawImperativeAPI,
  size = { width: 300, height: 180 },
) => {
  const state = api.getAppState();
  const selected = api
    .getSceneElements()
    .filter((el) => state.selectedElementIds[el.id]);
  if (selected.length) {
    const region =
      state.activeTool.type === "lasso" ? state.whiteboardSelection : undefined;
    if (
      region?.elementIds.length ===
        Object.keys(state.selectedElementIds).length &&
      region?.elementIds.every((id) => state.selectedElementIds[id])
    ) {
      return contentPosition(
        api,
        { x: region.bounds.right + 24, y: region.bounds.top },
        size,
      );
    }
    const [, top, right] = getCommonBounds(selected);
    return contentPosition(api, { x: right + 24, y: top }, size);
  }
  return contentPosition(
    api,
    {
      x: -state.scrollX + state.width / state.zoom.value / 3,
      y: -state.scrollY + state.height / state.zoom.value / 3,
    },
    size,
  );
};

export const answerPosition = (
  api: ExcalidrawImperativeAPI,
  source: readonly ExcalidrawElement[],
  width = 120,
  boundsOverride?: readonly [number, number, number, number],
) => {
  const bounds = boundsOverride || getCommonBounds(source);
  if (!bounds.every(Number.isFinite)) {
    throw new Error(t("fcboard.选区缺少有效边界，请重新圈选笔迹"));
  }
  const row = boundsOverride ? undefined : inkLines(source).at(-1);
  const state = api.getAppState();
  const left = -state.scrollX;
  const right = state.width / state.zoom.value - state.scrollX;
  const x = (row?.right ?? bounds[2]) + 16;
  const preferred =
    x + width < right - 16
      ? { x, y: row?.top ?? bounds[1] }
      : {
          x: Math.max(left + 16, Math.min(bounds[0], right - width - 16)),
          y: bounds[3] + 16,
        };
  return contentPosition(api, preferred, {
    width,
    height: row ? row.bottom - row.top : 32,
  });
};

const arrangeElements = <T extends ExcalidrawElement>(
  api: ExcalidrawImperativeAPI,
  elements: T[],
) => {
  if (!elements.length) {
    return elements;
  }
  const [left, top, right, bottom] = getCommonBounds(elements);
  const position = contentPosition(
    api,
    { x: left, y: top },
    { width: right - left, height: bottom - top },
  );
  return elements.map((element) => ({
    ...element,
    x: element.x + position.x - left,
    y: element.y + position.y - top,
  }));
};

export const revealNewContent = (
  api: ExcalidrawImperativeAPI,
  elements: readonly ExcalidrawElement[],
  context?: readonly ExcalidrawElement[],
) => {
  if (!elements.length) {
    return;
  }
  const state = api.getAppState();
  const [left, top, right, bottom] = getCommonBounds(elements);
  const zoom = state.zoom.value;
  const clearance = toolbarClearance(api);
  if (
    left >= -state.scrollX &&
    top >= -state.scrollY &&
    right <= -state.scrollX + state.width / zoom &&
    bottom <= -state.scrollY + (state.height - clearance) / zoom
  ) {
    return;
  }
  const selected =
    context ||
    api
      .getSceneElements()
      .filter((element) => state.selectedElementIds[element.id]);
  api.scrollToContent?.([...selected, ...elements], {
    fitToContent: true,
    minZoom: Math.min(0.5, zoom),
    maxZoom: zoom,
    animate: true,
    canvasOffsets: { top: 16, right: 16, bottom: clearance, left: 16 },
  });
};

export const insertElements = (
  api: ExcalidrawImperativeAPI,
  skeletons: ExcalidrawElementSkeleton[],
  replaceIds: string[] = [],
  arrange = false,
) => {
  let elements = convertToExcalidrawElements(
    skeletons.map((element) => ({
      ...element,
      customData: { ...element.customData, fcGenerated: true },
    })),
  );
  if (arrange) {
    elements = arrangeElements(api, elements);
  }
  api.updateScene({
    elements: [
      ...api.getSceneElements().filter((el) => !replaceIds.includes(el.id)),
      ...elements,
    ],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  if (arrange) {
    revealNewContent(api, elements);
  }
  return elements.map((el) => el.id);
};

export const insertText = (
  api: ExcalidrawImperativeAPI,
  text: string,
  position?: { x: number; y: number },
  customData?: Record<string, unknown>,
  styleSource?: readonly ExcalidrawElement[],
  presentation: Settings["answerStyle"] = currentSettings().answerStyle,
  placement: TextPlacement = {},
) => {
  const state = api.getAppState();
  const viewport = contentViewport(api);
  const sourceBounds = styleSource?.length
    ? getCommonBounds(styleSource)
    : undefined;
  let bounds =
    sourceBounds && sourceBounds.every(Number.isFinite)
      ? {
          left: Math.max(sourceBounds[0], placement.bounds?.left ?? -Infinity),
          top: Math.max(sourceBounds[1], placement.bounds?.top ?? -Infinity),
          right: Math.min(sourceBounds[2], placement.bounds?.right ?? Infinity),
          bottom: Math.min(
            sourceBounds[3],
            placement.bounds?.bottom ?? Infinity,
          ),
        }
      : placement.bounds;
  if (placement.mode === "inline" && styleSource?.length) {
    const last = inkLines(styleSource).at(-1);
    if (last) {
      bounds = {
        ...last,
        left: Math.max(last.left, bounds?.left ?? -Infinity),
        right: Math.min(last.right, bounds?.right ?? Infinity),
      };
    }
  }
  const gap = bounds
    ? Math.min(
        16 / state.zoom.value,
        Math.max(2 / state.zoom.value, (bounds.bottom - bounds.top) * 0.3),
      )
    : 16 / state.zoom.value;
  placement = { ...placement, bounds };
  position ||= bounds
    ? { x: bounds.left, y: bounds.bottom + gap }
    : { x: viewport.left, y: viewport.top };
  if (![position.x, position.y].every(Number.isFinite)) {
    throw new Error(t("fcboard.选区缺少有效边界，请重新圈选笔迹"));
  }
  const textSource = styleSource?.find((element) => element.type === "text");
  const inkSource = styleSource?.find((element) => element.type === "freedraw");
  const source = textSource || inkSource;
  const size =
    textSource?.type === "text"
      ? textSource.fontSize
      : inkSource && styleSource
      ? Math.min(
          inkLineHeight(styleSource, 1 / state.zoom.value),
          bounds && placement.sourceLines
            ? (bounds.bottom - bounds.top) / placement.sourceLines
            : Infinity,
        ) / 1.25
      : (state.currentItemFontSize || 24) / state.zoom.value;
  const fontFamily =
    presentation === "handwritten"
      ? FONT_FAMILY.Excalifont
      : presentation === "text"
      ? FONT_FAMILY.Helvetica
      : textSource?.type === "text"
      ? textSource.fontFamily
      : inkSource
      ? FONT_FAMILY.Excalifont
      : state.currentItemFontFamily || FONT_FAMILY.Helvetica;
  const excluded = new Set(
    placement.mode === "replace"
      ? styleSource?.map((element) => element.id)
      : [],
  );
  const obstacles = api
    .getSceneElements()
    .filter((element) => !element.isDeleted && !excluded.has(element.id))
    .map((element) => {
      const [left, top, right, bottom] = getCommonBounds([element]);
      return { left, top, right, bottom };
    });
  let elements: ExcalidrawElement[] | undefined;
  for (let attempt = 0; attempt < 24; attempt++) {
    const layout = layoutBoardText(
      text,
      size * 0.9 ** attempt,
      fontFamily,
      viewport,
      obstacles,
      position,
      gap,
      placement,
    );
    if (!layout) {
      break;
    }
    const ink =
      presentation === "handwritten" || (presentation === "match" && inkSource)
        ? handwritingElements(text, {
            x: 0,
            y: 0,
            height: layout.fontSize * 1.25,
            color:
              source?.strokeColor || state.currentItemStrokeColor || "#000000",
            width:
              ((inkSource?.strokeWidth ||
                (((state.currentItemStrokeWidth ||
                  DEFAULT_ELEMENT_PROPS.strokeWidth) /
                  DEFAULT_ELEMENT_PROPS.strokeWidth) *
                  4) /
                  (window.devicePixelRatio || 1) /
                  state.zoom.value) *
                layout.fontSize) /
              size,
            opacity: source?.opacity ?? state.currentItemOpacity ?? 100,
            maxWidth: viewport.right - layout.x,
            source: styleSource,
            customData,
          })
        : null;
    if (ink) {
      const [left, top, right, bottom] = getCommonBounds(ink);
      const point = findVisibleContentPosition(
        layout,
        { width: right - left, height: bottom - top },
        { ...viewport, left: layout.x, top: layout.y },
        obstacles,
        gap,
      );
      if (!point) {
        continue;
      }
      elements = ink.map((element) => ({
        ...element,
        x: element.x + point.x - left,
        y: element.y + point.y - top,
      }));
    } else {
      elements = convertToExcalidrawElements([
        {
          type: "text",
          ...layout,
          strokeColor: source?.strokeColor || state.currentItemStrokeColor,
          opacity: source?.opacity ?? state.currentItemOpacity ?? 100,
          textAlign:
            textSource?.type === "text"
              ? textSource.textAlign
              : state.currentItemTextAlign || "left",
          customData,
        },
      ]);
    }
    break;
  }
  if (!elements) {
    throw new Error(t("fcboard.当前可见区域没有足够空间，请留出书写区域"));
  }
  api.updateScene({
    elements: [
      ...api.getSceneElements().filter((element) => !excluded.has(element.id)),
      ...elements.map((element) => ({
        ...element,
        customData: { ...element.customData, fcGenerated: true },
      })),
    ],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return elements.map((element) => element.id);
};

export const drawAxes = async (
  api: ExcalidrawImperativeAPI,
  selectionSource?: string,
) => {
  const origin = classroomCommands.has("document.insertion")
    ? { x: 60, y: 60 }
    : insertionPoint(api, { width: 450, height: 450 });
  const x = origin.x + 200;
  const y = origin.y + 200;
  const group = crypto.randomUUID();
  const color = api.getAppState().currentItemStrokeColor || "#000000";
  const shapes: ExcalidrawElementSkeleton[] = [
    {
      type: "arrow",
      x: x - 200,
      y,
      points: [pointFrom(0, 0), pointFrom(410, 0)],
      endArrowhead: "arrow",
    },
    {
      type: "arrow",
      x,
      y: y + 200,
      points: [pointFrom(0, 0), pointFrom(0, -410)],
      endArrowhead: "arrow",
    },
    {
      type: "text",
      x: x + 212,
      y: y - 10,
      text: "x",
      fontSize: 16,
      fontFamily: 2,
    },
    {
      type: "text",
      x: x + 10,
      y: y - 218,
      text: "y",
      fontSize: 16,
      fontFamily: 2,
    },
    {
      type: "text",
      x: x + 6,
      y: y + 6,
      text: "0",
      fontSize: 14,
      fontFamily: 2,
    },
  ];
  for (let tick = -4; tick <= 4; tick++) {
    if (!tick) {
      continue;
    }
    shapes.push(
      {
        type: "line",
        x: x + tick * 40,
        y,
        points: [pointFrom(0, 0), pointFrom(0, -5)],
      },
      {
        type: "text",
        x: x + tick * 40 - 5,
        y: y + 8,
        text: String(tick),
        fontSize: 12,
        fontFamily: 2,
      },
      {
        type: "line",
        x,
        y: y - tick * 40,
        points: [pointFrom(0, 0), pointFrom(5, 0)],
      },
      {
        type: "text",
        x: x + 8,
        y: y - tick * 40 - 8,
        text: String(tick),
        fontSize: 12,
        fontFamily: 2,
      },
    );
  }
  const objects = shapes.map((shape) => ({
    ...shape,
    id: crypto.randomUUID(),
    strokeColor: color,
    strokeWidth: 1.3,
    roughness: 0,
    groupIds: [group],
    customData: {
      fcAxes: { x, y, unit: 40 },
      fcSelectionSource: selectionSource,
    },
  }));
  if (classroomCommands.has("document.insertion")) {
    return classroomCommands.execute({
      name: "document.insertion",
      args: { id: group, shapes: objects },
    });
  }
  const ids = insertElements(api, objects);
  revealNewContent(
    api,
    api.getSceneElements().filter((element) => ids.includes(element.id)),
  );
  return ids;
};

export const insertCube = (api: ExcalidrawImperativeAPI) => {
  const origin = insertionPoint(api, { width: 200, height: 195 });
  const vertices = [
    [0, 50],
    [140, 50],
    [140, 190],
    [0, 190],
    [55, 0],
    [195, 0],
    [195, 140],
    [55, 140],
  ];
  const edges = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  return insertElements(
    api,
    edges.map(([a, b]) => ({
      type: "line",
      x: origin.x + vertices[a][0],
      y: origin.y + vertices[a][1],
      points: [
        pointFrom(0, 0),
        pointFrom(
          vertices[b][0] - vertices[a][0],
          vertices[b][1] - vertices[a][1],
        ),
      ],
      roughness: 0,
      strokeWidth: 2,
      strokeStyle: [6, 7, 11].includes(
        edges.findIndex((edge) => edge[0] === a && edge[1] === b),
      )
        ? "dashed"
        : "solid",
    })),
  );
};

export const drawPlot = (
  api: ExcalidrawImperativeAPI,
  plot: Plot,
  position: { x: number; y: number },
  replaceIds: string[] = [],
  sourceSignature?: string,
  keepTool = false,
) => {
  const lines = samplePlot(plot);
  const scale = 200 / plot.range;
  const skeletons: ExcalidrawElementSkeleton[] = [
    {
      type: "arrow",
      x: position.x - 220,
      y: position.y,
      points: [pointFrom(0, 0), pointFrom(450, 0)],
      roughness: 0,
      endArrowhead: "arrow",
    },
    {
      type: "arrow",
      x: position.x,
      y: position.y + 220,
      points: [pointFrom(0, 0), pointFrom(0, -450)],
      roughness: 0,
      endArrowhead: "arrow",
    },
    {
      type: "text",
      x: position.x + 230,
      y: position.y,
      text: "x",
      fontFamily: 2,
    },
    {
      type: "text",
      x: position.x + 8,
      y: position.y - 245,
      text: plot.surface ? "z" : "y",
      fontFamily: 2,
    },
    {
      type: "text",
      x: position.x - 220,
      y: position.y + 240,
      text: `${plot.surface ? "z" : "y"} ${plot.relation || "="} ${
        plot.expression
      }`,
      fontSize: 18,
      fontFamily: 2,
    },
  ];
  if (plot.surface) {
    const start = project3D(-220, 0, 0);
    const delta = project3D(450, 0, 0);
    skeletons[0] = {
      type: "arrow",
      x: position.x + start[0],
      y: position.y + start[1],
      points: [pointFrom(0, 0), pointFrom(delta[0], delta[1])],
      roughness: 0,
      endArrowhead: "arrow",
    };
    const xLabel = project3D(245, 0, 0);
    skeletons[2] = {
      type: "text",
      x: position.x + xLabel[0],
      y: position.y + xLabel[1],
      text: "x",
      fontFamily: 2,
    };
    const yStart = project3D(0, -220, 0);
    const yDelta = project3D(0, 450, 0);
    const yLabel = project3D(0, 245, 0);
    skeletons.push(
      {
        type: "arrow",
        x: position.x + yStart[0],
        y: position.y + yStart[1],
        points: [pointFrom(0, 0), pointFrom(yDelta[0], yDelta[1])],
        roughness: 0,
        endArrowhead: "arrow",
      },
      {
        type: "text",
        x: position.x + yLabel[0],
        y: position.y + yLabel[1],
        text: "y",
        fontFamily: 2,
      },
    );
  } else {
    for (let tick = -4; tick <= 4; tick++) {
      if (!tick) {
        continue;
      }
      skeletons.push(
        {
          type: "text",
          x: position.x + tick * 50 - 8,
          y: position.y + 5,
          text: String((tick * plot.range) / 4),
          fontSize: 12,
          fontFamily: 2,
        },
        {
          type: "text",
          x: position.x + 5,
          y: position.y - tick * 50,
          text: String((tick * plot.range) / 4),
          fontSize: 12,
          fontFamily: 2,
        },
      );
    }
  }
  for (const polygon of sampleInequality(plot)) {
    const first = polygon[0];
    skeletons.push({
      type: "line",
      x: position.x + first[0] * scale,
      y: position.y + first[1] * scale,
      points: polygon.map(([x, y]) =>
        pointFrom((x - first[0]) * scale, (y - first[1]) * scale),
      ),
      roughness: 0,
      strokeWidth: 0,
      strokeColor: "#2563eb",
      backgroundColor: "#2563eb",
      fillStyle: "solid",
      opacity: 15,
    });
  }
  for (const line of lines) {
    const first = line[0];
    skeletons.push({
      type: "line",
      x: position.x + first[0] * scale,
      y: position.y + first[1] * scale,
      points: line.map((p) =>
        pointFrom((p[0] - first[0]) * scale, (p[1] - first[1]) * scale),
      ),
      roughness: 0,
      strokeColor: "#2563eb",
      strokeWidth: 2,
      strokeStyle:
        plot.relation === ">" || plot.relation === "<" ? "dashed" : "solid",
    });
  }
  const documentLayout = classroomCommands.read("document.layout") as
    | {
        viewport: ContentRect;
        obstacles: (ContentRect & { id: string })[];
        scale: number;
      }
    | undefined;
  const fitted = fitPlot(
    skeletons,
    position,
    documentLayout?.viewport || contentViewport(api),
    documentLayout
      ? documentLayout.obstacles.filter(
          (obstacle) => !replaceIds.includes(obstacle.id),
        )
      : api
          .getSceneElements()
          .filter((element) => !replaceIds.includes(element.id))
          .map((element) => {
            const [left, top, right, bottom] = getCommonBounds([element]);
            return { left, top, right, bottom };
          }),
    8 / (documentLayout?.scale || api.getAppState().zoom.value),
  );
  const plotId = crypto.randomUUID();
  const shapes = fitted.shapes.map((shape) => ({
    strokeColor: api.getAppState().currentItemStrokeColor,
    ...shape,
    id: crypto.randomUUID(),
    groupIds: [plotId],
    customData: {
      fcSelectionSource: sourceSignature,
      fcPlot: {
        id: plotId,
        plot,
        position: fitted.center,
        origin: { x: shape.x || 0, y: shape.y || 0 },
      },
    },
  }));
  if (classroomCommands.has("document.plot")) {
    void classroomCommands.execute({
      name: "document.plot",
      args: { shapes, replaceIds, keepTool },
    });
    return shapes.map((shape) => shape.id);
  }
  const ids = insertElements(api, shapes, replaceIds);
  return ids;
};

export const selectedPlot = (api: ExcalidrawImperativeAPI) => {
  const document = classroomCommands.read("document") as
    | { ink: InkStroke[]; selection: string[] }
    | undefined;
  if (document) {
    const stroke = document.ink.find(
      (stroke) => document.selection.includes(stroke.id) && stroke.plot,
    );
    if (!stroke?.plot) {
      return null;
    }
    return {
      plot: stroke.plot.plot,
      ids: document.ink
        .filter((item) => item.plot?.id === stroke.plot!.id)
        .map((item) => item.id),
      position: {
        x:
          stroke.plot.position.x +
          (stroke.anchor?.x ?? stroke.points[0][0]) -
          stroke.plot.origin.x,
        y:
          stroke.plot.position.y +
          (stroke.anchor?.y ?? stroke.points[0][1]) -
          stroke.plot.origin.y,
      },
    };
  }
  const elements = api.getSceneElements();
  const selected = elements.find(
    (el) =>
      api.getAppState().selectedElementIds[el.id] && el.customData?.fcPlot,
  );
  const metadata = selected?.customData?.fcPlot;
  if (
    !selected ||
    !metadata ||
    typeof metadata.id !== "string" ||
    typeof metadata.plot?.expression !== "string" ||
    typeof metadata.plot.surface !== "boolean" ||
    !["x", "y", "z", "a", "b", "c", "range"].every((key) =>
      Number.isFinite(metadata.plot[key]),
    ) ||
    ![
      metadata.position?.x,
      metadata.position?.y,
      metadata.origin?.x,
      metadata.origin?.y,
    ].every(Number.isFinite)
  ) {
    return null;
  }
  return {
    plot: metadata.plot as Plot,
    ids: elements
      .filter((el) => el.customData?.fcPlot?.id === metadata.id)
      .map((el) => el.id),
    position: {
      x: metadata.position.x + selected.x - metadata.origin.x,
      y: metadata.position.y + selected.y - metadata.origin.y,
    },
  };
};

export const validateShapes = (value: unknown): ExcalidrawElementSkeleton[] => {
  if (!Array.isArray(value) || !value.length || value.length > 160) {
    throw new Error(t("fcboard.AI 图形数据无效"));
  }
  return value.map((shape) => {
    if (
      !shape ||
      !["rectangle", "ellipse", "diamond", "line", "arrow", "text"].includes(
        shape.type,
      ) ||
      !Number.isFinite(shape.x) ||
      !Number.isFinite(shape.y) ||
      Math.abs(shape.x) > 3000 ||
      Math.abs(shape.y) > 3000
    ) {
      throw new Error(t("fcboard.AI 返回了无效图形坐标"));
    }
    if (
      shape.strokeColor !== undefined &&
      (typeof shape.strokeColor !== "string" ||
        !/^#[a-f0-9]{3}(?:[a-f0-9]{3})?$/i.test(shape.strokeColor))
    ) {
      throw new Error(t("fcboard.颜色无效"));
    }
    const base = {
      type: shape.type,
      x: shape.x,
      y: shape.y,
      roughness: 0,
      strokeWidth: 2,
      ...(shape.strokeColor ? { strokeColor: shape.strokeColor } : {}),
    };
    if (shape.type === "text") {
      if (typeof shape.text !== "string" || shape.text.length > 4000) {
        throw new Error(t("fcboard.AI 返回了无效文本"));
      }
      return {
        ...base,
        type: "text",
        text: shape.text,
        fontSize: 22,
        fontFamily: 2,
      };
    }
    if (
      !Number.isFinite(shape.width) ||
      !Number.isFinite(shape.height) ||
      Math.abs(shape.width) > 2000 ||
      Math.abs(shape.height) > 2000
    ) {
      throw new Error(t("fcboard.AI 图形尺寸无效"));
    }
    return { ...base, width: shape.width, height: shape.height };
  });
};
