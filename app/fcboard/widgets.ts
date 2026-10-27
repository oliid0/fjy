import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import { pointFrom } from "@excalidraw/math";
import { getCommonBounds } from "@excalidraw/element";
import { t } from "@excalidraw/excalidraw/i18n";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";

import { factorySolidOutlines } from "./factorySolidOutlines";
import { classroomCommands } from "./commands";
import { contentPosition, contentViewport, revealNewContent } from "./board";
import { findVisibleContentPosition } from "./placement";
import { configureSolid, solidDefaults, solidShapes } from "./solids";
import { factoryGizmoShapes } from "./factoryGizmoShapes";
import {
  factoryFlatShape,
  rotateFactoryShapes,
  stretchFactoryShapes,
  validatedFactoryShape,
} from "./factoryShapeGeometry";

import type { InkStroke } from "./documents";
import type { SolidSettings } from "./solids";
import type { ContentRect } from "./placement";
import type { FactoryFlatShapeData } from "./factoryShapeGeometry";

export const teachingTools = {
  shape: "shape",
  ruler: "ruler",
  protractor: "protractor",
  compass: "compass",
  setSquare: "set_square",
  dice: "dice",
  timer: "timer",
  picker: "random_picker",
  cube: "cube",
  sphere: "sphere",
  cylinder: "cylinder",
  cone: "cone",
  prism: "prism",
  pyramid: "pyramid",
  frustum: "frustum",
  hemisphere: "hemisphere",
  pendulum: "pendulum",
  projectile: "projectile_motion",
} as const;
export type WidgetKind = keyof typeof teachingTools;
export const solidWidgetKinds = new Set<WidgetKind>([
  "cube",
  "sphere",
  "cylinder",
  "cone",
  "prism",
  "pyramid",
  "frustum",
  "hemisphere",
]);
export type WidgetParams = {
  running: boolean;
  started: number;
  elapsed: number;
  duration: number;
  length: number;
  gravity: number;
  angle: number;
  vx: number;
  vy: number;
  rotation: number;
  names: string;
  choice: string;
  size: number;
  sweep: number;
  stretchX: number;
  stretchY: number;
  strokeWidth: number;
  opacity: number;
  shape?: FactoryFlatShapeData;
  solid: SolidSettings;
};
export type Widget = {
  id: string;
  kind: WidgetKind;
  params: WidgetParams;
  position: { x: number; y: number };
};
export const widgetDefaults = (): WidgetParams => ({
  running: false,
  started: Date.now(),
  elapsed: 0,
  duration: 180,
  length: 1.5,
  gravity: 9.81,
  angle: 20,
  vx: 12,
  vy: 16,
  rotation: 0,
  names: "1,2,3,4,5,6",
  choice: "?",
  size: 1,
  sweep: 0,
  stretchX: 1,
  stretchY: 1,
  strokeWidth: 2,
  opacity: 100,
  solid: solidDefaults(),
});
export const widgetTime = (params: WidgetParams, now = Date.now()) =>
  params.elapsed +
  (params.running ? Math.max(0, now - params.started) / 1000 : 0);
export const configureWidget = (
  params: WidgetParams,
  changes: Record<string, unknown>,
): WidgetParams => {
  const next = { ...params };
  if (changes.shape !== undefined) {
    next.shape = validatedFactoryShape(changes.shape);
  }
  if (changes.solid !== undefined) {
    next.solid = configureSolid(params.solid || solidDefaults(), changes.solid);
  }
  const limits = {
    duration: [1, 7200],
    length: [0.2, 5],
    gravity: [0.1, 30],
    angle: [0, 30],
    vx: [1, 50],
    vy: [1, 50],
    rotation: [-180, 180],
    size: [0.3, 2],
    sweep: [-360, 360],
    stretchX: [0.01, 100],
    stretchY: [0.01, 100],
    strokeWidth: [0.1, 240],
    opacity: [0, 100],
    elapsed: [0, 1e9],
    started: [0, 1e15],
  };
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    if (changes[key] !== undefined) {
      const value = changes[key];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < limits[key][0] ||
        value > limits[key][1]
      ) {
        throw new Error(
          t("fcboard.teaching_tool_parameter_key_is_out_of_range", { key }),
        );
      }
      next[key] = value;
    }
  }
  if (changes.running !== undefined) {
    if (typeof changes.running !== "boolean") {
      throw new Error(t("fcboard.invalid_playback_state"));
    }
    next.running = changes.running;
  }
  for (const key of ["names", "choice"] as const) {
    if (changes[key] !== undefined) {
      if (
        typeof changes[key] !== "string" ||
        (changes[key] as string).length > (key === "names" ? 5000 : 120)
      ) {
        throw new Error(t("fcboard.selection_content_is_too_long"));
      }
      next[key] = changes[key] as string;
    }
  }
  return next;
};
const line = (
  x: number,
  y: number,
  points: number[][],
  color = "#245bd6",
): ExcalidrawElementSkeleton => ({
  type: "line",
  x: x + points[0][0],
  y: y + points[0][1],
  points: points.map(([a, b]) => pointFrom(a - points[0][0], b - points[0][1])),
  roughness: 0,
  strokeColor: color,
  strokeWidth: 2,
});
const label = (
  x: number,
  y: number,
  text: string,
  fontSize = 18,
): ExcalidrawElementSkeleton => ({
  type: "text",
  x,
  y,
  text,
  fontSize,
  fontFamily: 2,
});
const ellipse = (
  x: number,
  y: number,
  width: number,
  height: number,
): ExcalidrawElementSkeleton => ({
  type: "ellipse",
  x,
  y,
  width,
  height,
  roughness: 0,
  strokeWidth: 2,
});
export const projectilePoint = (
  vx: number,
  vy: number,
  gravity: number,
  time: number,
): [number, number] => [vx * time, vy * time - (gravity * time * time) / 2];

export const widgetShapes = (
  widget: Widget,
  now = Date.now(),
): ExcalidrawElementSkeleton[] => {
  const { kind, params } = widget;
  const result: ExcalidrawElementSkeleton[] = [];
  if (kind === "shape") {
    const shape = params.shape || {
      kind: "rectangle" as const,
      start: [0, 0] as [number, number],
      end: [180, 120] as [number, number],
      fill: false,
      width: 2,
      opacity: 100,
    };
    return rotateFactoryShapes(
      factoryFlatShape(shape.kind, shape.start, shape.end, {
        color: params.solid.stroke,
        width: shape.width,
        opacity: shape.opacity,
        fill: shape.fill,
      }),
      params.rotation,
      params.size,
    );
  } else if (
    kind === "ruler" ||
    kind === "protractor" ||
    kind === "compass" ||
    kind === "setSquare"
  ) {
    return factoryGizmoShapes(widget);
  } else if (kind === "timer") {
    const remaining = Math.ceil(
      Math.max(0, params.duration - widgetTime(params, now)),
    );
    result.push(
      label(
        0,
        0,
        `${Math.floor(remaining / 60)
          .toString()
          .padStart(2, "0")}:${(remaining % 60).toString().padStart(2, "0")}`,
        64,
      ),
    );
    result.push(
      label(
        4,
        84,
        remaining <= 0
          ? t("fcboard.time_is_up")
          : params.running
          ? t("fcboard.running")
          : t("fcboard.timer"),
        16,
      ),
    );
  } else if (kind === "dice" || kind === "picker") {
    result.push(
      {
        type: "rectangle",
        x: 0,
        y: 0,
        width: kind === "dice" ? 140 : 260,
        height: 140,
        roughness: 0,
        roundness: { type: 3 },
      },
      label(40, 42, params.choice, 42),
    );
  } else if (kind === "pendulum") {
    const theta =
      (params.angle / 180) *
      Math.PI *
      Math.cos(
        Math.sqrt(params.gravity / params.length) * widgetTime(params, now),
      );
    const x = 140 + 125 * Math.sin(theta);
    const y = 16 + 125 * Math.cos(theta);
    result.push(
      line(
        80,
        0,
        [
          [0, 0],
          [120, 0],
        ],
        "#17243c",
      ),
      line(
        140,
        0,
        [
          [0, 0],
          [x - 140, y],
        ],
        "#17243c",
      ),
      {
        ...ellipse(x - 12, y - 12, 24, 24),
        backgroundColor: "#245bd6",
        fillStyle: "solid",
      },
      label(
        0,
        184,
        `L=${params.length.toFixed(1)} m   g=${params.gravity.toFixed(2)} m/s²`,
        16,
      ),
    );
  } else if (kind === "projectile") {
    const flight = (2 * params.vy) / params.gravity;
    const range = params.vx * flight;
    const scale = 300 / Math.max(1, range);
    const points = Array.from({ length: 81 }, (_, index) =>
      projectilePoint(
        params.vx,
        params.vy,
        params.gravity,
        (index / 80) * flight,
      ),
    ).map(([x, y]) => [x * scale, -y * scale]);
    const t = Math.min(flight, widgetTime(params, now));
    const [x, y] = projectilePoint(params.vx, params.vy, params.gravity, t);
    result.push(
      line(
        0,
        180,
        [
          [0, 0],
          [320, 0],
        ],
        "#17243c",
      ),
      line(0, 180, points),
      {
        ...ellipse(x * scale - 7, 180 - y * scale - 7, 14, 14),
        backgroundColor: "#dc2626",
        fillStyle: "solid",
      },
      label(
        0,
        212,
        `vₓ=${params.vx.toFixed(1)}  vᵧ=${params.vy.toFixed(1)} m/s`,
        16,
      ),
    );
  } else {
    result.push(
      ...(kind === "cube" || kind === "cylinder"
        ? solidShapes(
            kind,
            params.solid || solidDefaults(),
            params.size,
            params.rotation,
          )
        : factorySolidOutlines(
            kind,
            params.solid || solidDefaults(),
            params.size,
            params.rotation,
          )),
    );
  }
  return stretchFactoryShapes(result, params.stretchX, params.stretchY).map(
    (shape) => ({
      ...shape,
      ...(solidWidgetKinds.has(kind)
        ? { strokeWidth: params.strokeWidth, opacity: params.opacity }
        : {}),
    }),
  );
};

export const readWidgets = (api: ExcalidrawImperativeAPI): Widget[] => {
  const seen = new Set<string>();
  const document = classroomCommands.read("document") as
    | { ink: InkStroke[] }
    | undefined;
  const elements = document
    ? document.ink
        .filter((stroke) => stroke.widget)
        .map((stroke) => ({
          x: stroke.anchor?.x ?? stroke.points[0][0],
          y: stroke.anchor?.y ?? stroke.points[0][1],
          customData: { fcWidget: stroke.widget },
        }))
    : api.getSceneElements();
  return elements.flatMap((element) => {
    const value = element.customData?.fcWidget;
    if (
      !value ||
      typeof value.id !== "string" ||
      seen.has(value.id) ||
      !(value.kind in teachingTools) ||
      !value.params ||
      !value.position ||
      !value.origin
    ) {
      return [];
    }
    if (
      ![
        value.position.x,
        value.position.y,
        value.origin.x,
        value.origin.y,
      ].every(Number.isFinite)
    ) {
      return [];
    }
    seen.add(value.id);
    try {
      return [
        {
          id: value.id,
          kind: value.kind,
          params: configureWidget(widgetDefaults(), value.params),
          position: {
            x: value.position.x + element.x - value.origin.x,
            y: value.position.y + element.y - value.origin.y,
          },
        } as Widget,
      ];
    } catch {
      return [];
    }
  });
};

export const renderWidget = (
  api: ExcalidrawImperativeAPI,
  widget: Widget,
  remember = true,
  transaction: {
    before?: readonly InkStroke[];
    preview?: boolean;
    exact?: boolean;
    onDocumentCommit?: (commit: Promise<unknown>) => void;
  } = {},
) => {
  const document = classroomCommands.read("document") as
    | { ink: InkStroke[]; pen?: { color: string } }
    | undefined;
  const existing = document ? [] : api.getSceneElements();
  const isSolid = solidWidgetKinds.has(widget.kind);
  const found = document
    ? document.ink.some((stroke) => stroke.widget?.id === widget.id)
    : existing.some(
        (element) => element.customData?.fcWidget?.id === widget.id,
      );
  if (isSolid) {
    const layout = document
      ? (classroomCommands.read("document.layout") as
          | { viewport: ContentRect; obstacles: ContentRect[] }
          | undefined)
      : undefined;
    if (document && !layout) {
      throw new DOMException(
        "Document viewport unavailable",
        "InvalidStateError",
      );
    }
    const viewport = layout?.viewport || contentViewport(api);
    widget = {
      ...widget,
      params: { ...widget.params, solid: { ...widget.params.solid, fit: 1 } },
    };
    const [left, top, right, bottom] = getCommonBounds(
      convertToExcalidrawElements(widgetShapes(widget)),
    );
    const fit = Math.min(
      1,
      (viewport.right - viewport.left) / (right - left),
      (viewport.bottom - viewport.top) / (bottom - top),
    );
    if (!Number.isFinite(fit) || fit < 0.001) {
      throw new Error(
        t(
          "fcboard.there_is_not_enough_visible_space_leave_some_room_for_writing",
        ),
      );
    }
    widget.params.solid.fit = fit;
    const bounds = getCommonBounds(
      convertToExcalidrawElements(widgetShapes(widget)),
    );
    const width = bounds[2] - bounds[0];
    const height = bounds[3] - bounds[1];
    let point = {
      x: Math.max(
        viewport.left,
        Math.min(viewport.right - width, widget.position.x + bounds[0]),
      ),
      y: Math.max(
        viewport.top,
        Math.min(viewport.bottom - height, widget.position.y + bounds[1]),
      ),
    };
    if (transaction.exact) {
      point = {
        x: widget.position.x + bounds[0],
        y: widget.position.y + bounds[1],
      };
    }
    if (!found && !transaction.exact) {
      const obstacles =
        layout?.obstacles ||
        existing
          .filter((element) => !element.isDeleted)
          .map((element) => {
            const [left, top, right, bottom] = getCommonBounds([element]);
            return { left, top, right, bottom };
          });
      const position = findVisibleContentPosition(
        point,
        { width, height },
        viewport,
        obstacles,
        8,
      );
      if (!position) {
        throw new Error(
          t(
            "fcboard.there_is_not_enough_visible_space_leave_some_room_for_writing",
          ),
        );
      }
      point = position;
    }
    widget = {
      ...widget,
      position: { x: point.x - bounds[0], y: point.y - bounds[1] },
    };
  }
  if (
    !isSolid &&
    !transaction.exact &&
    !classroomCommands.has("document.widget") &&
    !existing.some((element) => element.customData?.fcWidget?.id === widget.id)
  ) {
    const [left, top, right, bottom] = getCommonBounds(
      convertToExcalidrawElements(widgetShapes(widget)),
    );
    const point = contentPosition(
      api,
      { x: widget.position.x + left, y: widget.position.y + top },
      { width: right - left, height: bottom - top },
    );
    widget = { ...widget, position: { x: point.x - left, y: point.y - top } };
  }
  const elements = convertToExcalidrawElements(
    widgetShapes(widget).map((shape, index) => ({
      strokeColor: document
        ? document.pen?.color
        : api.getAppState().currentItemStrokeColor,
      ...shape,
      id: `${widget.id}-${index}`,
      x: widget.position.x + (shape.x || 0),
      y: widget.position.y + (shape.y || 0),
      groupIds: [widget.id],
      version:
        (existing.find((el) => el.id === `${widget.id}-${index}`)?.version ||
          0) + 1,
      customData: {
        ...shape.customData,
        fcGenerated: true,
        fcWidget: {
          ...widget,
          origin: {
            x: widget.position.x + (shape.x || 0),
            y: widget.position.y + (shape.y || 0),
          },
        },
      },
    })),
    { regenerateIds: false },
  );
  if (classroomCommands.has("document.widget")) {
    const commit = classroomCommands.execute({
      name: "document.widget",
      args: { widget, shapes: elements, remember, before: transaction.before },
    });
    transaction.onDocumentCommit?.(commit);
    return elements;
  }
  api.updateScene({
    elements: [
      ...existing.filter((el) => el.customData?.fcWidget?.id !== widget.id),
      ...elements,
    ],
    captureUpdate: transaction.preview
      ? CaptureUpdateAction.EVENTUALLY
      : remember
      ? CaptureUpdateAction.IMMEDIATELY
      : CaptureUpdateAction.NEVER,
    ...(existing.some(
      (element) =>
        element.customData?.fcWidget?.id === widget.id &&
        api.getAppState().selectedElementIds[element.id],
    )
      ? {
          appState: {
            selectedElementIds: Object.fromEntries([
              ...Object.entries(api.getAppState().selectedElementIds).filter(
                ([id, selected]) =>
                  selected &&
                  !existing.some(
                    (element) =>
                      element.id === id &&
                      element.customData?.fcWidget?.id === widget.id,
                  ),
              ),
              ...elements.map((element) => [element.id, true] as const),
            ]),
          },
        }
      : {}),
  });
  if (
    !existing.some((element) => element.customData?.fcWidget?.id === widget.id)
  ) {
    revealNewContent(api, elements);
  }
  return elements;
};
