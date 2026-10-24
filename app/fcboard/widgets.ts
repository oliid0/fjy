import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import { pointFrom } from "@excalidraw/math";
import { getCommonBounds } from "@excalidraw/element";
import { t } from "@excalidraw/excalidraw/i18n";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";

import { project3D } from "./math";
import { classroomCommands } from "./commands";
import { contentPosition, revealNewContent } from "./board";
import { configureSolid, solidDefaults, solidShapes } from "./solids";

import type { InkStroke } from "./documents";
import type { SolidSettings } from "./solids";

export const teachingTools = {
  ruler: "直尺",
  protractor: "量角器",
  dice: "骰子",
  timer: "计时器",
  picker: "随机抽取",
  cube: "立方体",
  sphere: "球体",
  cylinder: "圆柱",
  cone: "圆锥",
  prism: "棱柱",
  pyramid: "棱锥",
  frustum: "圆台",
  pendulum: "单摆",
  projectile: "抛体运动",
} as const;
export type WidgetKind = keyof typeof teachingTools;
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
        throw new Error(t("fcboard.教学工具参数 {{key}} 超出范围", { key }));
      }
      next[key] = value;
    }
  }
  if (changes.running !== undefined) {
    if (typeof changes.running !== "boolean") {
      throw new Error(t("fcboard.播放状态无效"));
    }
    next.running = changes.running;
  }
  for (const key of ["names", "choice"] as const) {
    if (changes[key] !== undefined) {
      if (
        typeof changes[key] !== "string" ||
        (changes[key] as string).length > (key === "names" ? 5000 : 120)
      ) {
        throw new Error(t("fcboard.抽取内容过长"));
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
  if (kind === "ruler") {
    result.push({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 360,
      height: 65,
      roughness: 0,
      backgroundColor: "#e0edff",
      fillStyle: "solid",
      opacity: 75,
    });
    for (let i = 0; i <= 60; i++) {
      const x = i * 6;
      result.push(
        line(
          x,
          0,
          [
            [0, 0],
            [0, i % 10 === 0 ? 25 : i % 5 === 0 ? 18 : 10],
          ],
          "#17243c",
        ),
      );
      if (i % 10 === 0) {
        result.push(label(x + 2, 30, String(i / 10), 14));
      }
    }
  } else if (kind === "protractor") {
    result.push(
      line(
        0,
        0,
        Array.from({ length: 91 }, (_, index) => {
          const angle = (index / 90) * Math.PI;
          return [140 - Math.cos(angle) * 140, 140 - Math.sin(angle) * 140];
        }),
        "#17243c",
      ),
      line(
        0,
        140,
        [
          [0, 0],
          [280, 0],
        ],
        "#17243c",
      ),
    );
    for (let degrees = 0; degrees <= 180; degrees += 10) {
      const angle = (degrees / 180) * Math.PI;
      result.push(
        line(
          140,
          140,
          [
            [Math.cos(angle) * 140, -Math.sin(angle) * 140],
            [Math.cos(angle) * 126, -Math.sin(angle) * 126],
          ],
          "#17243c",
        ),
      );
      if (degrees % 30 === 0) {
        result.push(
          label(
            130 + Math.cos(angle) * 105,
            133 - Math.sin(angle) * 105,
            `${degrees}°`,
            14,
          ),
        );
      }
    }
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
          ? t("fcboard.时间到")
          : params.running
          ? t("fcboard.计时中")
          : t("fcboard.计时器"),
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
    const rotate = (x: number, y: number, z: number) => {
      const angle = (params.rotation / 180) * Math.PI;
      const point = project3D(
        x * Math.cos(angle) - y * Math.sin(angle),
        x * Math.sin(angle) + y * Math.cos(angle),
        z,
      );
      return [point[0] * params.size + 140, point[1] * params.size + 130];
    };
    const path = (vertices: number[][]) => {
      const points = vertices.map(([x, y, z]) => rotate(x, y, z));
      const first = points[0];
      result.push(
        line(
          first[0],
          first[1],
          points.map((p) => [p[0] - first[0], p[1] - first[1]]),
        ),
      );
    };
    const ring = (radius: number, height: number) =>
      Array.from({ length: 65 }, (_, index) => [
        Math.cos((index / 64) * 2 * Math.PI) * radius,
        Math.sin((index / 64) * 2 * Math.PI) * radius,
        height,
      ]);
    if (kind === "cube") {
      result.push(
        ...solidShapes(
          kind,
          params.solid || solidDefaults(),
          params.size,
          params.rotation,
        ),
      );
    } else if (kind === "sphere") {
      for (let lat = -2; lat <= 2; lat++) {
        const angle = (lat * Math.PI) / 6;
        path(ring(90 * Math.cos(angle), 90 * Math.sin(angle)));
      }
      for (let lng = 0; lng < 6; lng++) {
        path(
          Array.from({ length: 65 }, (_, index) => {
            const t = (index / 64) * 2 * Math.PI;
            const p = (lng / 6) * Math.PI;
            return [
              90 * Math.cos(t) * Math.cos(p),
              90 * Math.cos(t) * Math.sin(p),
              90 * Math.sin(t),
            ];
          }),
        );
      }
    } else if (kind === "cylinder") {
      result.push(
        ...solidShapes(
          kind,
          params.solid || solidDefaults(),
          params.size,
          params.rotation,
        ),
      );
    } else if (kind === "cone" || kind === "frustum") {
      const top = kind === "cone" ? 0 : kind === "frustum" ? 40 : 75;
      path(ring(75, -65));
      if (top) {
        path(ring(top, 65));
      }
      for (const angle of [0, Math.PI]) {
        path([
          [75 * Math.cos(angle), 75 * Math.sin(angle), -65],
          [top * Math.cos(angle), top * Math.sin(angle), 65],
        ]);
      }
    } else {
      const vertices = Array.from({ length: 6 }, (_, index) => [
        Math.cos((index / 6) * 2 * Math.PI) * 85,
        Math.sin((index / 6) * 2 * Math.PI) * 85,
        -60,
      ]);
      path([...vertices, vertices[0]]);
      const top =
        kind === "pyramid"
          ? [[0, 0, 85]]
          : vertices.map(([x, y]) => [x, y, 85]);
      if (top.length > 1) {
        path([...top, top[0]]);
      }
      vertices.forEach((vertex, index) =>
        path([vertex, top[kind === "pyramid" ? 0 : index]]),
      );
    }
  }
  return result;
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
) => {
  const existing = api.getSceneElements();
  if (
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
      strokeColor: api.getAppState().currentItemStrokeColor,
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
    void classroomCommands.execute({
      name: "document.widget",
      args: { widget, shapes: elements, remember },
    });
    return elements;
  }
  api.updateScene({
    elements: [
      ...existing.filter((el) => el.customData?.fcWidget?.id !== widget.id),
      ...elements,
    ],
    captureUpdate: remember
      ? CaptureUpdateAction.IMMEDIATELY
      : CaptureUpdateAction.NEVER,
  });
  if (
    !existing.some((element) => element.customData?.fcWidget?.id === widget.id)
  ) {
    revealNewContent(api, elements);
  }
  return elements;
};
