import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import { getCommonBounds } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";

import { project3D, samplePlot } from "./math";
import { classroomCommands } from "./commands";

import type { InkStroke } from "./documents";

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
  customData?: Record<string, unknown>,
) =>
  insertElements(api, [
    {
      type: "text",
      ...position,
      text,
      fontSize: api.getAppState().currentItemFontSize || 24,
      fontFamily: api.getAppState().currentItemFontFamily || 2,
      strokeColor: api.getAppState().currentItemStrokeColor,
      opacity: api.getAppState().currentItemOpacity ?? 100,
      textAlign: api.getAppState().currentItemTextAlign || "left",
      customData,
    },
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
  sourceSignature?: string,
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
      text: `${plot.surface ? "z" : "y"} = ${plot.expression}`,
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
  const plotId = crypto.randomUUID();
  const shapes = skeletons.map((shape) => ({
    ...shape,
    id: crypto.randomUUID(),
    groupIds: [plotId],
    customData: {
      fcSelectionSource: sourceSignature,
      fcPlot: {
        id: plotId,
        plot,
        position,
        origin: { x: shape.x || 0, y: shape.y || 0 },
      },
    },
  }));
  if (classroomCommands.has("document.plot")) {
    void classroomCommands.execute({
      name: "document.plot",
      args: { shapes, replaceIds },
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
