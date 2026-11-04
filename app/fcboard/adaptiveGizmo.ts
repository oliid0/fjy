import { convertToFcboardElements } from "@fcboard/fcboard";
import { getCommonBounds } from "@fcboard/element";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { contentViewport } from "./board";
import { classroomCommands } from "./commands";
import {
  compassGeometry,
  factoryGizmoShapes,
  gizmoLayout,
  gizmoPoint,
} from "./factoryGizmoShapes";

import type { ContentRect } from "./placement";
import type { Widget } from "./widgets";

export const gizmoViewport = (api: FcboardImperativeAPI) => {
  const document = classroomCommands.read("document.layout") as
    | { scale?: number; viewport: ContentRect }
    | undefined;
  return {
    scale: document?.scale || api.getAppState().zoom.value,
    viewport: document?.viewport || contentViewport(api),
  };
};

/** Keep controls separate from the physical tick grid, as the native layers do. */
export const compactGizmoControl = (
  widget: Widget,
  action: string,
): [number, number] | undefined => {
  const layout = widget.params.gizmo?.layout;
  if (!layout) {
    return;
  }
  const unit = widget.params.gizmo!.unit / widget.params.size;
  const actions =
    widget.kind === "protractor"
      ? ["delete", "rotate", "angle", "sector", "arc"]
      : widget.kind === "compass"
      ? ["delete", "rotate", "resize", "drawArc"]
      : ["delete", "rotate", "resize"];
  const index = actions.indexOf(action);
  if (index < 0) {
    return;
  }
  const body = gizmoLayout(widget.kind, widget.params.stretchX);
  const width =
    widget.kind === "compass"
      ? Math.max(192 * unit, compassGeometry(widget).radius + 50 * unit)
      : body.width;
  if (layout === "side") {
    const top =
      widget.kind === "compass"
        ? 300 - compassGeometry(widget).leg - 48 * unit
        : 0;
    return [
      width + (30 + Math.floor(index / 3) * 48) * unit,
      top + (24 + (index % 3) * 48) * unit,
    ];
  }
  return [((index + 0.5) * width) / actions.length, body.height + 30 * unit];
};

export const gizmoBounds = (widget: Widget): ContentRect => {
  const [left, top, right, bottom] = getCommonBounds(
    convertToFcboardElements(factoryGizmoShapes(widget)),
  );
  const points: [number, number][] = [
    [left + widget.position.x, top + widget.position.y],
    [right + widget.position.x, bottom + widget.position.y],
  ];
  const radius = (22 * (widget.params.gizmo?.unit ?? 1)) / widget.params.size;
  for (const action of [
    "delete",
    "rotate",
    "resize",
    "drawArc",
    "angle",
    "sector",
    "arc",
  ]) {
    const point = compactGizmoControl(widget, action);
    if (point) {
      for (const dx of [-radius, radius]) {
        for (const dy of [-radius, radius]) {
          points.push(gizmoPoint(widget, point[0] + dx, point[1] + dy));
        }
      }
    }
  }
  return {
    left: Math.min(...points.map(([x]) => x)),
    top: Math.min(...points.map(([, y]) => y)),
    right: Math.max(...points.map(([x]) => x)),
    bottom: Math.max(...points.map(([, y]) => y)),
  };
};

/** Reflow the body and controls once at insertion/orientation change, never per ink frame. */
export const adaptGizmo = (
  source: Widget,
  viewport: ContentRect,
  scale: number,
): Widget => {
  const width = (viewport.right - viewport.left) * scale;
  const height = (viewport.bottom - viewport.top) * scale;
  if (width >= 620 && height >= 440 && !source.params.gizmo?.layout) {
    return source;
  }
  const unit = 1 / scale;
  const side = height < 300 && width > height * 1.5;
  const usableWidth = Math.max(
    144,
    width - (side ? (source.kind === "protractor" ? 112 : 64) : 24),
  );
  const usableHeight = Math.max(144, height - (side ? 12 : 78));
  const widget: Widget = {
    ...source,
    params: {
      ...source.params,
      gizmo: {
        ...source.params.gizmo,
        unit,
        density: 1,
        layout: side ? "side" : "bottom",
      },
    },
  };
  widget.params.size = unit;
  if (widget.kind === "ruler" || widget.kind === "setSquare") {
    widget.params.stretchX =
      Math.min(
        600,
        usableWidth,
        widget.kind === "setSquare" ? usableHeight - 32 : Infinity,
      ) / 360;
  } else if (widget.kind === "protractor") {
    const diameter = Math.min(360, usableWidth, usableHeight * 2);
    widget.params.size = (diameter / 360) * unit;
    widget.params.gizmo = {
      ...widget.params.gizmo!,
      scaleUnit: widget.params.size / 0.7,
      needle: ((diameter / 2 - 24) * unit) / widget.params.size,
      ball: (14 * unit) / widget.params.size,
    };
  } else if (widget.kind === "compass") {
    const leg = Math.min(
      160,
      Math.max(70, usableHeight - 80),
      usableWidth / 1.5,
    );
    widget.params.gizmo = {
      ...widget.params.gizmo!,
      leg,
      opening: 2 * leg * Math.sin((25 * Math.PI) / 180) * 1.1,
    };
  }
  const bounds = gizmoBounds(widget);
  const dx = Math.max(
    viewport.left - bounds.left,
    Math.min(viewport.right - bounds.right, 0),
  );
  const dy = Math.max(
    viewport.top - bounds.top,
    Math.min(viewport.bottom - bounds.bottom, 0),
  );
  widget.position = { x: source.position.x + dx, y: source.position.y + dy };
  return widget;
};
