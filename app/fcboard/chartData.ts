import { getLanguage, t } from "@fcboard/fcboard/i18n";

export type ChartData = {
  type: "bar" | "line" | "pie";
  rows: { title: string; value: number }[];
  width: number;
  height: number;
};
export const chartColors = [
  "#3b82f6",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
];
export const chartValue = (draft: string) => {
  // ChartEditDialogFragment uses Float.parseFloat, not a partial numeric prefix.
  const value = Number(draft);
  return Number.isFinite(value) && value > 0 ? value : 0;
};
export const isChartData = (value: unknown): value is ChartData => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const { type, rows, width, height } = value as ChartData;
  return (
    ["bar", "line", "pie"].includes(type) &&
    Number.isFinite(width) &&
    width >= 200 &&
    width <= 4096 &&
    Number.isFinite(height) &&
    height >= 180 &&
    height <= 4096 &&
    Array.isArray(rows) &&
    rows.every(
      (row) =>
        row &&
        typeof row.title === "string" &&
        typeof row.value === "number" &&
        Number.isFinite(row.value) &&
        row.value >= 0,
    )
  );
};

/** ChartPreviewView: the preview and inserted image share this exact geometry. */
export const chartSvg = ({ type, rows, width, height }: ChartData) => {
  const xml = document.implementation.createDocument(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  const root = xml.documentElement;
  for (const [key, value] of Object.entries({
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    "font-family": "sans-serif",
  })) {
    root.setAttribute(key, String(value));
  }
  const add = (
    tag: string,
    attrs: Record<string, string | number>,
    text?: string,
  ) => {
    const node = xml.createElementNS(root.namespaceURI, tag);
    Object.entries(attrs).forEach(([key, value]) =>
      node.setAttribute(key, String(value)),
    );
    if (text !== undefined) {
      node.textContent = text;
    }
    root.append(node);
    return node;
  };
  const label = (
    text: string,
    x: number,
    y: number,
    color = "#111827",
    size = 11,
    anchor = "middle",
  ) =>
    add(
      "text",
      { x, y, fill: color, "font-size": size, "text-anchor": anchor },
      text,
    );
  const number = new Intl.NumberFormat(getLanguage().code, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const name = (index: number) =>
    rows[index].title || t("fcboard.chart.untitled");
  add("rect", { width, height, fill: "#ffffff" });
  const maximum = rows.reduce((max, row) => Math.max(max, row.value), 0);
  if (maximum <= 0) {
    label(t("fcboard.chart.noData"), width / 2, height / 2 + 6, "#9ca3af", 18);
  } else if (type === "pie") {
    // Scale by max before summing to keep even very large finite data finite.
    const total = rows.reduce((sum, row) => sum + row.value / maximum, 0);
    const cx = width * 0.68;
    const cy = height * 0.52;
    const radius = Math.min(width * 0.24, height * 0.3);
    let angle = -Math.PI / 2;
    rows.forEach((row, index) => {
      const color = chartColors[index % chartColors.length];
      add("rect", {
        x: 18,
        y: 18 + index * 24,
        width: 12,
        height: 12,
        rx: 2,
        fill: color,
      });
      label(name(index), 38, 29 + index * 24, "#374151", 12, "start");
      if (!row.value) {
        return;
      }
      const sweep = (row.value / maximum / total) * Math.PI * 2;
      if (sweep >= Math.PI * 2 - 1e-10) {
        add("circle", { cx, cy, r: radius, fill: color });
      } else {
        add("path", {
          d: `M${cx} ${cy} L${cx + Math.cos(angle) * radius} ${
            cy + Math.sin(angle) * radius
          } A${radius} ${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${
            cx + Math.cos(angle + sweep) * radius
          } ${cy + Math.sin(angle + sweep) * radius} Z`,
          fill: color,
        });
      }
      label(
        number.format(row.value),
        cx + Math.cos(angle + sweep / 2) * radius * 0.72,
        cy + Math.sin(angle + sweep / 2) * radius * 0.72 + 4,
      );
      angle += sweep;
    });
    add("circle", { cx, cy, r: radius * 0.52, fill: "#ffffff" });
  } else {
    const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(maximum)));
    const normalized = maximum / magnitude;
    // The original axis rounds to 2, 5 or 10 times the decimal magnitude.
    const axisMax = Math.min(
      Number.MAX_VALUE,
      (normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude,
    );
    const left = 52;
    const right = width - 20;
    const top = 24;
    const bottom = height - 42;
    for (let index = 0; index <= 4; index++) {
      const y = bottom - ((bottom - top) * index) / 4;
      add("line", {
        x1: left,
        x2: right,
        y1: y,
        y2: y,
        stroke: "#e5e7eb",
        "stroke-width": 1,
      });
      label(
        number.format(axisMax * (index / 4)),
        left - 6,
        y + 4,
        "#6b7280",
        11,
        "end",
      );
    }
    add("path", {
      d: `M${left} ${top}V${bottom}H${right}`,
      fill: "none",
      stroke: "#4b5563",
      "stroke-width": 1.3,
    });
    const slot = (right - left) / rows.length;
    const points = rows.map((row, index) => ({
      x: left + (index + 0.5) * slot,
      y: bottom - (row.value / axisMax) * (bottom - top),
    }));
    if (type === "line") {
      add("path", {
        d: points
          .map(({ x, y }, index) => `${index ? "L" : "M"}${x} ${y}`)
          .join(" "),
        fill: "none",
        stroke: "#2563eb",
        "stroke-width": 2.4,
      });
    }
    const measure = document.createElement("canvas").getContext("2d");
    if (measure) {
      measure.font = "12px sans-serif";
    }
    rows.forEach((row, index) => {
      const { x, y } = points[index];
      const color = chartColors[index % chartColors.length];
      if (type === "bar") {
        add("rect", {
          x: x - slot * 0.24,
          y,
          width: slot * 0.48,
          height: bottom - y,
          rx: 4,
          fill: color,
        });
      } else {
        add("circle", { cx: x, cy: y, r: 4.5, fill: color });
        add("circle", { cx: x, cy: y, r: 2.2, fill: "#ffffff" });
      }
      label(number.format(row.value), x, y - (type === "bar" ? 6 : 8));
      let title = name(index);
      if (measure && measure.measureText(title).width > slot - 4) {
        while (
          title.length &&
          measure.measureText(`${title}...`).width > slot - 4
        ) {
          title = title.slice(0, -1);
        }
        title = title ? `${title}...` : "";
      }
      label(title, x, bottom + 18, "#1f2937", 12);
    });
  }
  return new XMLSerializer().serializeToString(root);
};
