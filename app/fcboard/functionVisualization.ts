import type { DataURL } from "@fcboard/fcboard/types";

import { functionView } from "./math";
import { functionGeometry } from "./functionGeometry";

import type { Plot } from "./math";

export const plotSize = { width: 500, height: 440 };
export const functionColors = ["#2563eb", "#f97316", "#eab308"] as const;
export type FunctionStroke = {
  width?: number;
  strokeStyle?: "solid" | "dashed" | "dotted";
};
const ticks = (from: number, to: number) => {
  const raw = (to - from) / 8;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const step =
    (fraction > 5 ? 10 : fraction > 2 ? 5 : fraction > 1 ? 2 : 1) * power;
  const result: number[] = [];
  for (
    let value = Math.ceil(from / step) * step;
    value <= to && result.length < 20;
    value += step
  ) {
    result.push(Math.abs(value) < step * 1e-8 ? 0 : value);
  }
  return result;
};
export const graphNumber = (number: number) =>
  String(Number(number.toPrecision(6)));

/** One Canvas implementation paints both the TSX floating view and its saved
 * PNG. The transparent backing shows the actual board/document background. */
export const drawFunctionGraph = (
  context: CanvasRenderingContext2D,
  plot: Plot,
  color = functionColors[0] as string,
  size = plotSize,
  stroke: FunctionStroke = {},
) => {
  const data = functionGeometry(plot);
  const view = functionView(plot);
  const width = size.width - 60;
  const height = size.height - 40;
  const px = (x: number) =>
    40 + ((x - view.left) / (view.right - view.left)) * width;
  const py = (y: number) =>
    20 + ((view.top - y) / (view.top - view.bottom)) * height;
  const xAxis = Math.max(20, Math.min(height + 20, py(0)));
  const yAxis = Math.max(40, Math.min(width + 40, px(0)));
  context.clearRect(0, 0, size.width, size.height);
  context.save();
  context.setLineDash([]);
  context.font = "11px Arial, sans-serif";
  context.lineWidth = 1;
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  };
  context.strokeStyle = "#64748b";
  context.fillStyle = "#64748b";
  const xticks = ticks(view.left, view.right);
  const yticks = ticks(view.bottom, view.top);
  context.globalAlpha = 0.18;
  for (const x of xticks) {
    line(px(x), 20, px(x), 20 + height);
  }
  for (const y of yticks) {
    line(40, py(y), 40 + width, py(y));
  }
  context.globalAlpha = 1;
  line(40, xAxis, 40 + width, xAxis);
  line(yAxis, 20, yAxis, 20 + height);
  context.textAlign = "center";
  context.textBaseline = "top";
  for (const x of xticks) {
    line(px(x), xAxis - 3, px(x), xAxis + 3);
    if (x !== 0) {
      context.fillText(
        graphNumber(x),
        px(x),
        Math.min(size.height - 14, xAxis + 5),
      );
    }
  }
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (const y of yticks) {
    line(yAxis - 3, py(y), yAxis + 3, py(y));
    if (y !== 0) {
      context.fillText(graphNumber(y), Math.max(32, yAxis - 5), py(y));
    }
  }
  context.fillText("x", size.width - 3, Math.max(10, xAxis - 9));
  context.fillText("y", Math.max(16, yAxis - 8), 10);
  context.save();
  context.beginPath();
  context.rect(40, 20, width, height);
  context.clip();
  const lineWidth = Math.max(0.5, stroke.width ?? 2);
  context.lineWidth = lineWidth;
  // Match the existing ordinary shape dash patterns (element/shape.ts).
  context.setLineDash(
    stroke.strokeStyle === "dashed"
      ? [8, 8 + lineWidth]
      : stroke.strokeStyle === "dotted"
      ? [1.5, 6 + lineWidth]
      : [],
  );
  context.lineCap = "round";
  context.lineJoin = "round";
  data.curves.forEach((curve, index) => {
    context.strokeStyle = index ? functionColors[index] : color;
    for (const points of curve.lines) {
      context.beginPath();
      points.forEach(([x, y], i) => {
        if (!i) {
          context.moveTo(px(x), py(y));
        } else {
          context.lineTo(px(x), py(y));
        }
      });
      context.stroke();
    }
  });
  context.restore();
  const placed: { x: number; y: number; width: number; height: number }[] = [];
  const label = (text: string, x: number, y: number, fill: string) => {
    context.font = "12px Arial, sans-serif";
    const measured = context.measureText(text).width;
    const w = Math.min(measured, size.width - 8);
    const options = [
      [8, -20],
      [-w - 8, 6],
      [8, 8],
      [-w - 8, -20],
      [8, -38],
      [-w - 8, 24],
    ];
    const boxes = options.map(([dx, dy]) => ({
      x: Math.max(4, Math.min(size.width - w - 4, x + dx)),
      y: Math.max(2, Math.min(size.height - 16, y + dy)),
      width: w,
      height: 14,
    }));
    const box =
      boxes.find((box) =>
        placed.every(
          (other) =>
            box.x + box.width < other.x ||
            box.x > other.x + other.width ||
            box.y + box.height < other.y ||
            box.y > other.y + other.height,
        ),
      ) || boxes[0];
    placed.push(box);
    context.fillStyle = fill;
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText(text, box.x, box.y, w);
  };
  for (const point of data.intersections) {
    context.fillStyle = "#64748b";
    context.beginPath();
    context.arc(px(point.x), py(point.y), 3.5, 0, Math.PI * 2);
    context.fill();
    label(
      `${point.label} (${graphNumber(point.x)}, ${graphNumber(point.y)})`,
      px(point.x),
      py(point.y),
      "#64748b",
    );
  }
  data.curves.forEach((curve, index) => {
    const end = curve.lines.at(-1)?.at(-1);
    if (end) {
      label(
        `y = ${curve.expression}`,
        px(end[0]),
        py(end[1]),
        index ? functionColors[index] : color,
      );
    }
  });
  context.restore();
  return data;
};

export const functionGraphImage = (
  plot: Plot,
  color = functionColors[0] as string,
  stroke: FunctionStroke = {},
): DataURL => {
  const canvas = document.createElement("canvas");
  canvas.width = plotSize.width * 2;
  canvas.height = plotSize.height * 2;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("The function graph could not be rendered");
  }
  context.scale(2, 2);
  drawFunctionGraph(context, plot, color, plotSize, stroke);
  return canvas.toDataURL("image/png") as DataURL;
};

// The canvas graph uses this padding. Normalised coordinates keep pointer math
// correct after the saved image is resized or rotated.
export const functionGraphLocation = (u: number, v: number) => ({
  x: (u * plotSize.width - 40) / (plotSize.width - 60),
  y: 1 - (v * plotSize.height - 20) / (plotSize.height - 40),
});

export const zoomFunctionGraph = (
  plot: Plot,
  factor: number,
  from: { x: number; y: number },
  to = from,
): Plot => {
  const view = functionView(plot);
  factor = Math.max(0.05, Math.min(20, factor));
  const width = Math.min(
    2000,
    Math.max(0.0002, (view.right - view.left) / factor),
  );
  const height = Math.min(
    2000,
    Math.max(0.0002, (view.top - view.bottom) / factor),
  );
  const left = view.left + from.x * (view.right - view.left) - to.x * width;
  const bottom =
    view.bottom + from.y * (view.top - view.bottom) - to.y * height;
  if (
    ![left, bottom, left + width, bottom + height].every(
      (value) => Number.isFinite(value) && Math.abs(value) <= 1e6,
    )
  ) {
    return plot;
  }
  return {
    ...plot,
    range: Math.max(width, height) / 2,
    view: { left, right: left + width, bottom, top: bottom + height },
  };
};
