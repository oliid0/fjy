export const functionPresets = [
  { id: 1, key: "linear", expression: "x" },
  { id: 2, key: "quadratic", expression: "x^2" },
  { id: 3, key: "hyperbola", expression: "1/x" },
  { id: 4, key: "exponential", expression: "2^x" },
  { id: 5, key: "logarithm", expression: "ln(x)" },
  { id: 6, key: "trigonometric", expression: "sin(x)" },
] as const;
export type FunctionItem = {
  id: number;
  name: string;
  expression: string;
  color: string;
};
export type GraphTransform = { unit: number; x: number; y: number };
export type FunctionGraphData = GraphTransform & {
  width: number;
  height: number;
  functions: FunctionItem[];
};
export const defaultGraphTransform: GraphTransform = { unit: 42, x: 0, y: 0 };
const colorPool = [
  "#0b5fff",
  "#7c3aed",
  "#dc2626",
  "#059669",
  "#0891b2",
  "#ec4899",
  "#65a30d",
  "#d97706",
  "#2563eb",
  "#9333ea",
  "#0f766e",
  "#ca8a04",
];
export const nextFunctionColor = (items: FunctionItem[]) => {
  const used = new Set(items.map((item) => item.color));
  const available = colorPool.find((color) => !used.has(color));
  if (available) {
    return available;
  }
  // FunctionGraphDialogFragment.generateExtraUniqueColor: hue i*37, S=.78,V=.92.
  for (let i = 0; i < 720; i++) {
    const hue = (i * 37) % 360;
    const sector = hue / 60;
    const chroma = 0.92 * 0.78;
    const secondary = chroma * (1 - Math.abs((sector % 2) - 1));
    const rgb =
      sector < 1
        ? [chroma, secondary, 0]
        : sector < 2
        ? [secondary, chroma, 0]
        : sector < 3
        ? [0, chroma, secondary]
        : sector < 4
        ? [0, secondary, chroma]
        : sector < 5
        ? [secondary, 0, chroma]
        : [chroma, 0, secondary];
    const color = `#${rgb
      .map((channel) =>
        Math.round((channel + 0.92 - chroma) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
    if (!used.has(color)) {
      return color;
    }
  }
  return "#000000";
};

type Evaluator = (x: number) => number;
/** FunctionExpressionEvaluator's grammar, compiled once instead of reparsing per sample. */
export const compileSourceFunction = (input: string): Evaluator => {
  if (!input || input.length > 500) {
    return () => NaN;
  }
  const parse = (source: string): Evaluator => {
    if (!source) {
      return () => NaN;
    }
    while (source.startsWith("(") && source.endsWith(")")) {
      let depth = 0;
      let outer = true;
      for (let index = 0; index < source.length; index++) {
        depth += source[index] === "(" ? 1 : source[index] === ")" ? -1 : 0;
        if (depth === 0 && index < source.length - 1) {
          outer = false;
          break;
        }
      }
      if (!outer || depth !== 0) {
        break;
      }
      source = source.slice(1, -1);
    }
    for (const operators of ["+-", "*/", "^"]) {
      let depth = 0;
      for (let index = source.length - 1; index > 0; index--) {
        const symbol = source[index];
        depth += symbol === ")" ? 1 : symbol === "(" ? -1 : 0;
        if (
          depth ||
          !operators.includes(symbol) ||
          ((symbol === "+" || symbol === "-") &&
            "+-*/^(".includes(source[index - 1]))
        ) {
          continue;
        }
        const left = parse(source.slice(0, index));
        const right = parse(source.slice(index + 1));
        return (x) => {
          const a = left(x);
          const b = right(x);
          return symbol === "+"
            ? a + b
            : symbol === "-"
            ? a - b
            : symbol === "*"
            ? a * b
            : symbol === "/"
            ? Math.abs(b) < 1e-7
              ? NaN
              : a / b
            : Math.pow(a, b);
        };
      }
    }
    const functions: Record<string, Evaluator> = {
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      ln: (x) => (x > 0 ? Math.log(x) : NaN),
      log: (x) => (x > 0 ? Math.log10(x) : NaN),
      log10: (x) => (x > 0 ? Math.log10(x) : NaN),
      sqrt: (x) => (x >= 0 ? Math.sqrt(x) : NaN),
      abs: Math.abs,
    };
    const call = source.match(/^(sin|cos|tan|ln|log10|log|sqrt|abs)\((.*)\)$/);
    if (call) {
      const argument = parse(call[2]);
      return (x) => functions[call[1]](argument(x));
    }
    if (source.startsWith("-")) {
      const value = parse(source.slice(1));
      return (x) => -value(x);
    }
    if (source === "x") {
      return (x) => x;
    }
    const constant =
      source === "pi"
        ? Math.PI
        : source === "e"
        ? Math.E
        : /^[+]?((\d+(\.\d*)?)|(\.\d+))(e[+-]?\d+)?$/.test(source)
        ? Number(source)
        : NaN;
    return () => constant;
  };
  return parse(
    input
      .trim()
      .toLowerCase()
      .replace(/y=/g, "")
      .replace(/ /g, "")
      .replace(/（/g, "(")
      .replace(/）/g, ")"),
  );
};
export const validSourceFunction = (expression: string) => {
  const value = compileSourceFunction(expression);
  return [-2, 0, 2].some((x) => Number.isFinite(value(x)));
};
export type SampledFunction = {
  color: string;
  points: ({ x: number; y: number } | null)[];
};
export const sampleSourceFunction = (item: FunctionItem): SampledFunction => {
  const evaluate = compileSourceFunction(item.expression);
  return {
    color: item.color,
    points: Array.from({ length: 1001 }, (_, index) => {
      const x = -10 + index * 0.02;
      const y = evaluate(x);
      return Number.isFinite(y) && Math.abs(y) <= 1000 ? { x, y } : null;
    }),
  };
};
export const clampGraph = (
  view: GraphTransform,
  width: number,
  height: number,
): GraphTransform => ({
  unit: Math.max(20, Math.min(200, view.unit)),
  x: Math.max(-width, Math.min(width, view.x)),
  y: Math.max(-height, Math.min(height, view.y)),
});
export const zoomGraph = (
  view: GraphTransform,
  width: number,
  height: number,
  focusX: number,
  focusY: number,
  scale: number,
) => {
  const unit = Math.max(20, Math.min(200, view.unit * scale));
  const x = (focusX - width / 2 - view.x) / view.unit;
  const y = (height / 2 + view.y - focusY) / view.unit;
  return clampGraph(
    {
      unit,
      x: focusX - x * unit - width / 2,
      y: focusY + y * unit - height / 2,
    },
    width,
    height,
  );
};
export type GraphNode = {
  tag: "rect" | "line" | "path" | "circle" | "text";
  attrs: Record<string, string | number>;
  text?: string;
};
/** FunctionGraphView paints: shared geometry for the live SVG and inserted image. */
export const functionGraphNodes = (
  view: GraphTransform & { width: number; height: number },
  functions: SampledFunction[],
): GraphNode[] => {
  const { width, height } = view;
  const { unit, x, y } = clampGraph(view, width, height);
  const ox = width / 2 + x;
  const oy = height / 2 + y;
  const nodes: GraphNode[] = [
    { tag: "rect", attrs: { width, height, fill: "#ffffff" } },
  ];
  const line = (x1: number, y1: number, x2: number, y2: number, axis = false) =>
    nodes.push({
      tag: "line",
      attrs: {
        x1,
        y1,
        x2,
        y2,
        stroke: axis ? "#111827" : "#e5e7eb",
        strokeWidth: axis ? 1.5 : 1,
      },
    });
  const text = (value: string, x: number, y: number) =>
    nodes.push({
      tag: "text",
      attrs: { x, y, fontSize: 10, fill: "#6b7280" },
      text: value,
    });
  for (
    let index = Math.ceil(-ox / unit);
    index <= Math.floor((width - ox) / unit);
    index++
  ) {
    const x = ox + index * unit;
    line(x, 0, x, height);
    if (index) {
      line(x, oy - 4, x, oy + 4, true);
      text(String(index), x - (index < 0 ? 8 : 4), oy + 16);
    }
  }
  for (
    let index = Math.ceil(-oy / unit);
    index <= Math.floor((height - oy) / unit);
    index++
  ) {
    const y = oy + index * unit;
    line(0, y, width, y);
    if (index) {
      line(ox - 4, y, ox + 4, y, true);
      text(String(-index), ox + 8, y + 4);
    }
  }
  line(0, oy, width, oy, true);
  line(ox, 0, ox, height, true);
  line(width - 10, oy - 5, width, oy, true);
  line(width - 10, oy + 5, width, oy, true);
  line(ox - 5, 10, ox, 0, true);
  line(ox + 5, 10, ox, 0, true);
  text("x", width - 14, oy - 8);
  text("y", ox + 8, 14);
  nodes.push({
    tag: "circle",
    attrs: { cx: ox, cy: oy, r: 2.5, fill: "#111827" },
  });
  text("0", ox + 6, oy + 16);
  for (const fn of functions) {
    let connected = false;
    let path = "";
    for (const point of fn.points) {
      const x = point ? ox + point.x * unit : NaN;
      const y = point ? oy - point.y * unit : NaN;
      if (
        !Number.isFinite(x + y) ||
        x < -100 ||
        x > width + 100 ||
        y < -100 ||
        y > height + 100
      ) {
        connected = false;
        continue;
      }
      path += `${connected ? "L" : "M"}${x} ${y} `;
      connected = true;
    }
    nodes.push({
      tag: "path",
      attrs: {
        d: path.trim(),
        fill: "none",
        stroke: fn.color,
        strokeWidth: 2,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
    });
  }
  return nodes;
};
export const isFunctionGraphData = (
  value: unknown,
): value is FunctionGraphData => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as FunctionGraphData;
  return (
    Number.isFinite(data.width) &&
    data.width >= 200 &&
    data.width <= 4096 &&
    Number.isFinite(data.height) &&
    data.height >= 180 &&
    data.height <= 4096 &&
    Number.isFinite(data.unit) &&
    data.unit >= 20 &&
    data.unit <= 200 &&
    Number.isFinite(data.x) &&
    Math.abs(data.x) <= data.width &&
    Number.isFinite(data.y) &&
    Math.abs(data.y) <= data.height &&
    Array.isArray(data.functions) &&
    data.functions.every(
      (item) =>
        item &&
        Number.isInteger(item.id) &&
        typeof item.name === "string" &&
        typeof item.expression === "string" &&
        item.expression.length <= 500 &&
        typeof item.color === "string" &&
        /^#[\da-f]{6}$/i.test(item.color) &&
        validSourceFunction(item.expression),
    )
  );
};
export const functionGraphSvg = (data: FunctionGraphData) => {
  const xml = document.implementation.createDocument(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  const root = xml.documentElement;
  for (const [key, value] of Object.entries({
    width: data.width,
    height: data.height,
    viewBox: `0 0 ${data.width} ${data.height}`,
    "font-family": "sans-serif",
  })) {
    root.setAttribute(key, String(value));
  }
  for (const { tag, attrs, text } of functionGraphNodes(
    data,
    data.functions.map(sampleSourceFunction),
  )) {
    const node = xml.createElementNS(root.namespaceURI, tag);
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(
        key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
        String(value),
      );
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    root.append(node);
  }
  return new XMLSerializer().serializeToString(root);
};
