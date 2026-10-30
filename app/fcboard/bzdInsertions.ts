import {
  configureInsertion,
  insertionDefaults,
  mindMapNodes,
} from "./insertObjects";
import { readBzdMatrix } from "./bzdBitmap";

import type {
  InsertObject,
  InsertNodeStyle,
  InsertionTextRun,
} from "./insertObjects";

const value = (object: Element, key: string, fallback: number) => {
  const text = object.getAttribute(key);
  const number = text === null || !text.trim() ? fallback : Number(text);
  if (!Number.isFinite(number) || Math.abs(number) > 1e7) {
    throw new Error("Invalid BZD insertion geometry");
  }
  return number;
};
const color = (object: Element) =>
  `#${["R", "G", "B"]
    .map((channel) =>
      Math.max(0, Math.min(255, value(object, `nRGBA_${channel}`, 0)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
const opacity = (object: Element) =>
  Math.max(0, Math.min(100, value(object, "nRGBA_A", 255) / 2.55));
const label = (runs: readonly InsertionTextRun[]) =>
  runs
    .map((run) => run.text)
    .join("")
    .trim()
    .replace(/\s+/g, " ");

/** HSaxSlideParser.finishMindMappingSlide restores IDs before node text is laid out. */
export const readBzdInsertions = (
  objects: readonly Element[],
  canvas = { width: 1920, height: 1080 },
) => {
  const consumed = new Set<Element>();
  const insertions: InsertObject[] = [];
  const labels = new Map<string, InsertionTextRun[]>();
  for (const object of objects) {
    if (object.getAttribute("eType") !== "OBJECT_TEXT") {
      continue;
    }
    for (const key of ["mNoteId", "alphabetId"]) {
      const id = object.getAttribute(key);
      if (!id) {
        continue;
      }
      const owner = `${key}:${id}`;
      const runs = labels.get(owner) || [];
      runs.push({
        text: object.getAttribute("text") || "",
        color: color(object),
      });
      labels.set(owner, runs);
    }
  }
  const textRuns = (key: string, id: string) =>
    (labels.get(`${key}:${id}`) || []).map((run, index) => ({
      ...run,
      text: (index ? " " : "") + run.text,
    }));
  const nodes = new Map<
    string,
    {
      source: Element;
      parent: string;
      style: InsertNodeStyle;
      x: number;
      y: number;
    }
  >();
  for (const source of objects) {
    if (source.getAttribute("eType") !== "OBJECT_Note") {
      continue;
    }
    const id = source.getAttribute("nId");
    if (!id || nodes.has(id)) {
      throw new Error("Invalid BZD node ID");
    }
    const x = value(source, "nodeRectLeft", 0);
    const y = value(source, "nodeRectTop", 0);
    const right = value(source, "nodeRectRight", x + 300);
    const bottom = value(source, "nodeRectBottom", y + 150);
    nodes.set(id, {
      source,
      parent: source.getAttribute("nodeLeftId") || "",
      x,
      y,
      style: {
        width: right > x ? right - x : 300,
        height: bottom > y ? bottom - y : 150,
        color: color(source),
        opacity: opacity(source),
        direction: source.getAttribute("nodeAddDirections") || "right",
        columns: Math.max(1, Math.trunc(value(source, "nodeColumns", 1))),
      },
    });
    consumed.add(source);
  }
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const [id, node] of nodes) {
    if (nodes.has(node.parent)) {
      const list = children.get(node.parent) || [];
      list.push(id);
      children.set(node.parent, list);
    } else {
      roots.push(id);
    }
  }
  const visited = new Set<string>();
  for (const root of roots) {
    const ordered: { id: string; depth: number }[] = [];
    const stack = [{ id: root, depth: 0 }];
    while (stack.length) {
      const current = stack.pop()!;
      if (visited.has(current.id)) {
        throw new Error("Cyclic BZD mind map");
      }
      visited.add(current.id);
      ordered.push(current);
      for (const id of [...(children.get(current.id) || [])].reverse()) {
        stack.push({ id, depth: current.depth + 1 });
      }
    }
    const origin = nodes.get(root)!;
    const runs = ordered.map(({ id }) => textRuns("mNoteId", id));
    const insertion = configureInsertion(
      insertionDefaults("mindmap", { x: origin.x, y: origin.y }),
      {
        outline: ordered
          .map(({ depth }, index) => "  ".repeat(depth) + label(runs[index]))
          .join("\n"),
        nodePositions: ordered.map(({ id }) => ({
          x: nodes.get(id)!.x - origin.x,
          y: nodes.get(id)!.y - origin.y,
        })),
        nodeStyles: ordered.map(({ id }) => nodes.get(id)!.style),
        nodeSize: { width: origin.style.width, height: origin.style.height },
        textRuns: runs,
        textColors: runs.map((parts) => parts[0]?.color || "#333333"),
      },
    );
    insertions.push(insertion);
  }
  if (visited.size !== nodes.size) {
    throw new Error("Cyclic BZD mind map");
  }
  for (const source of objects) {
    if (source.getAttribute("eType") !== "OBJECT_ALPHABET") {
      continue;
    }
    const id = source.getAttribute("nId");
    if (!id) {
      throw new Error("Invalid BZD alphabet ID");
    }
    const matrix = readBzdMatrix(source.getAttribute("matrix"));
    const xs: number[] = [];
    const ys: number[] = [];
    const divisors: number[] = [];
    for (const [x, y] of [
      [0, 0],
      [canvas.width / 5, 0],
      [canvas.width / 5, canvas.height / 5],
      [0, canvas.height / 5],
    ]) {
      const w = matrix[6] * x + matrix[7] * y + matrix[8];
      divisors.push(w);
      xs.push((matrix[0] * x + matrix[1] * y + matrix[2]) / w);
      ys.push((matrix[3] * x + matrix[4] * y + matrix[5]) / w);
    }
    if (
      ![...xs, ...ys, ...divisors].every(Number.isFinite) ||
      (Math.min(...divisors) <= 0 && Math.max(...divisors) >= 0)
    ) {
      throw new Error("Invalid BZD alphabet matrix");
    }
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const width = Math.max(...xs) - left;
    const height = Math.max(...ys) - top;
    const runs = textRuns("alphabetId", id);
    insertions.push(
      configureInsertion(insertionDefaults("fourline", { x: left, y: top }), {
        width,
        height,
        color: color(source),
        opacity: opacity(source),
        text: label(runs),
        textRuns: [runs],
        textColors: [runs[0]?.color || "#333333"],
      }),
    );
    consumed.add(source);
  }
  for (const source of objects) {
    if (
      source.getAttribute("eType") === "OBJECT_TEXT" &&
      (source.getAttribute("mNoteId") || source.getAttribute("alphabetId"))
    ) {
      // HSmaTextObject.doDraw suppresses owner-bound marker text, even if its owner is missing.
      consumed.add(source);
    }
  }
  return { insertions, consumed };
};

/** Export fresh native node IDs, preserving their relationships after duplication/import. */
export const bzdInsertionNodeId = (object: InsertObject, index: number) =>
  `${object.id}-node-${index}`;
export const bzdNodeAttributes = (object: InsertObject, index: number) => {
  const node = mindMapNodes(object)[index];
  return {
    nId: bzdInsertionNodeId(object, index),
    eType: "OBJECT_Note",
    nodeAddDirections: node.direction,
    nodeColumns: object.nodeStyles?.[index]?.columns ?? node.depth + 1,
    nodeLeftId: node.parent < 0 ? "" : bzdInsertionNodeId(object, node.parent),
    nodeRectLeft: object.position.x + node.x,
    nodeRectTop: object.position.y + node.y,
    nodeRectRight: object.position.x + node.x + node.width,
    nodeRectBottom: object.position.y + node.y + node.height,
    color: node.color,
    opacity: node.opacity,
  };
};
