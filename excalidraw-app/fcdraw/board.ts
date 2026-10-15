import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import { getCommonBounds } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";

import { samplePlot } from "./math";

import type { Plot } from "./math";

export const insertionPoint = (api: ExcalidrawImperativeAPI) => {
  const state = api.getAppState();
  const selected = api
    .getSceneElements()
    .filter((el) => state.selectedElementIds[el.id]);
  if (selected.length) {
    const [, top, right] = getCommonBounds(selected);
    return { x: right + 24, y: top };
  }
  return {
    x: -state.scrollX + state.width / state.zoom.value / 3,
    y: -state.scrollY + state.height / state.zoom.value / 3,
  };
};

export const insertElements = (
  api: ExcalidrawImperativeAPI,
  skeletons: ExcalidrawElementSkeleton[],
  replaceIds: string[] = [],
) => {
  const elements = convertToExcalidrawElements(
    skeletons.map((element) => ({
      ...element,
      customData: { ...element.customData, fcGenerated: true },
    })),
  );
  api.updateScene({
    elements: [
      ...api.getSceneElements().filter((el) => !replaceIds.includes(el.id)),
      ...elements,
    ],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return elements.map((el) => el.id);
};

export const insertText = (
  api: ExcalidrawImperativeAPI,
  text: string,
  position = insertionPoint(api),
) =>
  insertElements(api, [
    { type: "text", ...position, text, fontSize: 24, fontFamily: 2 },
  ]);

export const insertCube = (api: ExcalidrawImperativeAPI) => {
  const origin = insertionPoint(api);
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
) => {
  const lines = samplePlot(plot);
  const scale = 200 / plot.range;
  const skeletons: ExcalidrawElementSkeleton[] = [
    {
      type: "arrow",
      x: position.x - 220,
      y: position.y,
      width: 450,
      height: 0,
      roughness: 0,
      endArrowhead: "arrow",
    },
    {
      type: "arrow",
      x: position.x,
      y: position.y + 220,
      width: 0,
      height: -450,
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
      text: `${plot.surface ? "z" : "y"} = ${plot.expression}`,
      fontSize: 18,
      fontFamily: 2,
    },
  ];
  if (plot.surface) {
    skeletons.push(
      {
        type: "arrow",
        x: position.x,
        y: position.y,
        points: [pointFrom(0, 0), pointFrom(-180, 90)],
        roughness: 0,
        endArrowhead: "arrow",
      },
      {
        type: "text",
        x: position.x - 200,
        y: position.y + 90,
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
    });
  }
  const ids = insertElements(api, skeletons, replaceIds);
  return ids;
};

export const validateShapes = (value: unknown): ExcalidrawElementSkeleton[] => {
  if (!Array.isArray(value) || !value.length || value.length > 160) {
    throw new Error("AI 图形数据无效");
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
      throw new Error("AI 返回了无效图形坐标");
    }
    const base = {
      type: shape.type,
      x: shape.x,
      y: shape.y,
      roughness: 0,
      strokeWidth: 2,
    };
    if (shape.type === "text") {
      if (typeof shape.text !== "string" || shape.text.length > 4000) {
        throw new Error("AI 返回了无效文本");
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
      throw new Error("AI 图形尺寸无效");
    }
    return { ...base, width: shape.width, height: shape.height };
  });
};
