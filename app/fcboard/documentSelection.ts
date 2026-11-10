import type { InkStroke } from "./documents";

export const documentSelectionGroup = (stroke: InkStroke) =>
  stroke.widget
    ? `widget:${stroke.widget.id}`
    : stroke.insertion
    ? `insertion:${stroke.insertion.id}`
    : stroke.plot
    ? `plot:${stroke.plot.id}`
    : stroke.language
    ? `language:${stroke.language.group}`
    : `stroke:${stroke.id}`;

/** As in the board's z-index actions, composite objects move as one unit. */
export const reorderDocumentSelection = (
  strokes: InkStroke[],
  ids: ReadonlySet<string>,
  action: "bringForward" | "sendBackward" | "bringToFront" | "sendToBack",
) => {
  const groups = new Map<string, InkStroke[]>();
  const chosen = new Set<string>();
  for (const stroke of strokes) {
    const key = documentSelectionGroup(stroke);
    const group = groups.get(key);
    if (group) {
      group.push(stroke);
    } else {
      groups.set(key, [stroke]);
    }
    if (ids.has(stroke.id)) {
      chosen.add(key);
    }
  }
  if (!chosen.size) {
    return strokes;
  }
  const units = [...groups.entries()];
  let moved = false;
  if (action === "bringToFront" || action === "sendToBack") {
    const front = units.filter(([key]) => chosen.has(key));
    const back = units.filter(([key]) => !chosen.has(key));
    const next =
      action === "bringToFront" ? [...back, ...front] : [...front, ...back];
    moved = units.some(([key], index) => key !== next[index][0]);
    if (moved) {
      return next.flatMap(([, group]) => group);
    }
  } else {
    const forward = action === "bringForward";
    for (let step = 0; step < units.length - 1; step++) {
      const index = forward ? units.length - 2 - step : step;
      const selected = forward ? index : index + 1;
      const neighbor = forward ? index + 1 : index;
      if (chosen.has(units[selected][0]) && !chosen.has(units[neighbor][0])) {
        [units[index], units[index + 1]] = [units[index + 1], units[index]];
        moved = true;
      }
    }
  }
  return moved ? units.flatMap(([, group]) => group) : strokes;
};

export const documentSelectionIds = (
  strokes: readonly InkStroke[],
  ids: ReadonlySet<string>,
) => {
  const groups = new Set(
    strokes.filter((stroke) => ids.has(stroke.id)).map(documentSelectionGroup),
  );
  return new Set(
    strokes
      .filter((stroke) => groups.has(documentSelectionGroup(stroke)))
      .map((stroke) => stroke.id),
  );
};
