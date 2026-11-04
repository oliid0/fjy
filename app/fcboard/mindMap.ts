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
  const styles = object.nodeStyles?.map((style) => ({ ...style }));
  const runs = object.textRuns?.map((parts) =>
    parts.map((part) => ({ ...part })),
  );
  if (action === "clear") {
    rows[index] = "  ".repeat(node.depth);
    if (runs) {
      runs[index] = [];
    }
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
      styles?.splice(index, end - index);
      runs?.splice(index, end - index);
    } else {
      if (nodes.length >= 40) {
        throw new Error("Mind map node limit reached");
      }
      const children = nodes.filter((item) => item.parent === index);
      const vertical = node.direction === "bottom";
      // Existing nodes retain their positions, so coordinate-based stroke
      // ownership survives insertion even when several labels are blank.
      const nextY = Math.max(...nodes.map((item) => item.y + item.height)) + 32;
      rows.splice(end, 0, "  ".repeat(node.depth + 1));
      positions.splice(end, 0, {
        x: vertical ? node.x : node.x + node.width + 100,
        y: vertical
          ? nextY
          : children.length
          ? Math.max(...children.map((item) => item.y + item.height)) + 40
          : node.y,
      });
      colors.splice(end, 0, "");
      if (styles) {
        styles.splice(end, 0, {
          width: vertical ? node.width : 300,
          height: vertical ? node.height : 150,
          color: "#0ed49f",
          opacity: 100,
          direction: vertical ? "bottom" : "right",
          columns: (styles[index]?.columns || node.depth + 1) + 1,
        });
      }
      runs?.splice(end, 0, []);
    }
  }
  return {
    ...object,
    outline: rows.join("\n"),
    nodePositions: positions,
    textColors: colors,
    ...(styles ? { nodeStyles: styles } : {}),
    ...(runs ? { textRuns: runs } : {}),
  };
};
