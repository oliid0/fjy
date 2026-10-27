import { mindMapNodes } from "./insertObjects";

import type { InsertObject } from "./insertObjects";

/** HMindMappingOBject stores independent node positions and deletes whole branches. */
export const changeMindMapNode = (
  object: InsertObject,
  index: number,
  action: "add" | "delete" | "clear" | "move",
  point?: { x: number; y: number },
) => {
  const nodes = mindMapNodes(object);
  const node = nodes[index];
  if (object.kind !== "mindmap" || !node) {
    throw new Error("Mind map node is no longer available");
  }
  const rows = object.outline.split("\n");
  const positions = nodes.map(({ x, y }) => ({ x, y }));
  const colors = nodes.map(
    (_, position) => object.textColors?.[position] || "",
  );
  if (action === "clear") {
    rows[index] = "  ".repeat(node.depth);
  } else if (action === "move") {
    if (!point || ![point.x, point.y].every(Number.isFinite)) {
      throw new Error("Invalid node position");
    }
    positions[index] = point;
  } else {
    let end = index + 1;
    while (end < nodes.length && nodes[end].depth > node.depth) {
      end++;
    }
    if (action === "delete") {
      if (index === 0) {
        return undefined;
      }
      rows.splice(index, end - index);
      positions.splice(index, end - index);
      colors.splice(index, end - index);
    } else {
      if (nodes.length >= 40) {
        throw new Error("Mind map node limit reached");
      }
      const children = nodes.filter((item) => item.parent === index);
      rows.splice(end, 0, "  ".repeat(node.depth + 1));
      positions.splice(end, 0, {
        x: node.x + (190 * (object.nodeSize?.width || 140)) / 140,
        y: children.length
          ? Math.max(...children.map((item) => item.y)) +
            (76 * (object.nodeSize?.height || 48)) / 48
          : node.y,
      });
      colors.splice(end, 0, "");
    }
  }
  return {
    ...object,
    outline: rows.join("\n"),
    nodePositions: positions,
    textColors: colors,
  };
};
