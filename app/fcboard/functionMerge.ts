import { t } from "@fcboard/fcboard/i18n";
import { CaptureUpdateAction, getCommonBounds } from "@fcboard/element";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { selectedBoardElements, boardContext } from "./ai";
import { drawPlot, objectSelection } from "./board";
import { classroomCommands } from "./commands";
import { boardInk } from "./digitalInk";
import { documentStrokeBounds, inkSnapshot } from "./documents";
import { latestFunctionInk } from "./functionInk";
import { recognizeInkContent } from "./inkRecognition";
import { localFunctionResult, validatedPlot } from "./mathRecognition";

import type { InkStroke } from "./documents";
import type { Plot } from "./math";
import type { ContentRect } from "./placement";

type Input = {
  id: string;
  text?: string;
  linked?: { id: string; plot: Plot; sourceIds?: readonly string[] };
  points?: [number, number][];
  bounds: ContentRect;
};
type Document = {
  id?: string;
  name?: string;
  page?: number;
  tool?: string;
  selection?: string[];
  selectionInProgress?: boolean;
  ink: InkStroke[];
};

const boundsOf = (inputs: readonly Input[]): ContentRect => ({
  left: Math.min(...inputs.map((input) => input.bounds.left)),
  top: Math.min(...inputs.map((input) => input.bounds.top)),
  right: Math.max(...inputs.map((input) => input.bounds.right)),
  bottom: Math.max(...inputs.map((input) => input.bounds.bottom)),
});

/** Reading capabilities is synchronous and never starts OCR or creates graphs. */
export const functionSelection = (api: FcboardImperativeAPI) => {
  const state = api.getAppState();
  const doc = classroomCommands.read("document") as Document | undefined;
  if (
    state.cursorButton === "down" ||
    state.isResizing ||
    state.isRotating ||
    doc?.selectionInProgress ||
    !["selection", "lasso"].includes(doc?.tool || state.activeTool.type)
  ) {
    return;
  }
  const inputs: Input[] = [];
  if (doc) {
    for (const stroke of doc.ink.filter((item) =>
      doc.selection?.includes(item.id),
    )) {
      if (
        stroke.locked ||
        (!stroke.plot && !stroke.text && stroke.fcInk?.assist !== "function")
      ) {
        return;
      }
      inputs.push({
        id: stroke.id,
        text: stroke.originalText || stroke.text,
        linked: stroke.plot && {
          id: stroke.id,
          plot: stroke.plot.plot,
          sourceIds: stroke.plot.sourceIds,
        },
        points: stroke.text || stroke.plot ? undefined : stroke.points,
        bounds: documentStrokeBounds(stroke),
      });
    }
  } else {
    for (const element of selectedBoardElements(api)) {
      const graph = element.customData?.fcPlot;
      if (
        element.locked ||
        (!graph &&
          element.type !== "text" &&
          (element.type !== "freedraw" ||
            element.customData?.fcInk?.assist !== "function"))
      ) {
        return;
      }
      const [left, top, right, bottom] = getCommonBounds([element]);
      inputs.push({
        id: element.id,
        text: element.type === "text" ? element.originalText : undefined,
        linked: graph && {
          id: element.id,
          plot: graph.plot,
          sourceIds: graph.sourceIds,
        },
        points:
          element.type === "freedraw" ? boardInk([element])[0] : undefined,
        bounds: { left, top, right, bottom },
      });
    }
  }
  if (!inputs.length || inputs.length > 3000) {
    return;
  }
  const byId = new Map(inputs.map((input) => [input.id, input]));
  const linkedInputs = new Set<string>();
  const groups: Input[][] = inputs
    .filter((input) => input.linked)
    .map((input) => {
      linkedInputs.add(input.id);
      for (const id of input.linked!.sourceIds || []) {
        if (byId.has(id)) {
          linkedInputs.add(id);
        }
      }
      return [input];
    });
  const graphs = doc
    ? doc.ink.map((item) => ({
        id: item.id,
        data: item.plot,
        locked: item.locked,
      }))
    : api.getSceneElements().map((item) => {
        const graph = item.customData?.fcPlot;
        return {
          id: item.id,
          locked: item.locked,
          data: graph && {
            plot: graph.plot as Plot,
            sourceIds: graph.sourceIds as readonly string[] | undefined,
          },
        };
      });
  for (const graph of graphs) {
    const ids = graph.data?.sourceIds;
    if (
      linkedInputs.has(graph.id) ||
      !Array.isArray(ids) ||
      !ids.length ||
      !ids.some((id) => byId.has(id))
    ) {
      continue;
    }
    if (
      graph.locked ||
      !graph.data ||
      ids.some((id) => byId.has(id) && linkedInputs.has(id))
    ) {
      return;
    }
    const linked = { id: graph.id, plot: graph.data.plot, sourceIds: ids };
    // Any selected source stroke identifies the recognized expression. Keep
    // its complete provenance without selecting/deleting unselected ink.
    groups.push(
      ids
        .filter((id) => byId.has(id))
        .map((id) => ({ ...byId.get(id)!, linked })),
    );
    ids.forEach((id) => linkedInputs.add(id));
  }
  const remaining = inputs.filter((input) => !linkedInputs.has(input.id));
  groups.push(
    ...remaining.filter((input) => input.text).map((input) => [input]),
  );
  let raw = remaining
    .filter((input) => input.points)
    .sort((a, b) => b.bounds.top - a.bounds.top);
  while (raw.length && groups.filter((group) => group[0].points).length < 3) {
    const included = latestFunctionInk(raw.map((input) => input.points!));
    groups.push(raw.filter((_, index) => included.has(index)));
    raw = raw.filter((_, index) => !included.has(index));
  }
  groups.sort(
    (a, b) =>
      boundsOf(a).top - boundsOf(b).top || boundsOf(a).left - boundsOf(b).left,
  );
  const chosen = groups.slice(0, 3);
  if (
    !chosen.length ||
    (chosen.length === 1 &&
      (!chosen[0][0].points || chosen[0][0].linked || chosen[0].length < 2)) ||
    chosen.reduce(
      (count, group) =>
        count + 1 + (group[0].linked?.plot.compare?.length || 0),
      0,
    ) > 3 ||
    chosen.some((group) => {
      if (group[0].linked) {
        return group[0].linked.plot.surface || !!group[0].linked.plot.relation;
      }
      if (!group[0].text) {
        return false;
      }
      try {
        const result = localFunctionResult(group[0].text);
        return result.plot.surface || !!result.plot.relation;
      } catch {
        return true;
      }
    })
  ) {
    return;
  }
  return {
    inputs: chosen.flat(),
    groups: chosen,
    doc,
    token: JSON.stringify([
      doc ? [doc.id, doc.name, doc.page] : api.id,
      inputs,
      chosen.map((group) => group[0].linked),
    ]),
  };
};

/** Only the explicit Merge action recognizes selected raw expressions. Each
 * chosen input owns independent work; cancellation prevents stale insertion. */
export const mergeFunctions = async (
  api: FcboardImperativeAPI,
  signal: AbortSignal,
) => {
  signal.throwIfAborted();
  const source = functionSelection(api);
  if (!source) {
    throw new Error(t("fcboard.functionGraph.mergeUnavailable"));
  }
  const { groups, token } = source;
  const plots = await Promise.all(
    groups.map(async (group) => {
      const known = group[0];
      if (known.linked) {
        return known.linked.plot;
      }
      if (known.text) {
        const result = localFunctionResult(known.text);
        if (result.kind === "function") {
          return result.plot;
        }
        throw new Error("No function in selection");
      }
      const ids = new Set(group.map((input) => input.id));
      const bounds = boundsOf(group);
      const result = await recognizeInkContent(
        "function",
        async () => {
          if (source.doc) {
            return inkSnapshot(
              source.doc.ink.filter((stroke) => ids.has(stroke.id)),
              bounds.bottom - bounds.top + 16,
              undefined,
              bounds.top - 8,
              {
                left: bounds.left - 8,
                width: bounds.right - bounds.left + 16,
                transparent: true,
              },
            );
          }
          return (
            (
              await boardContext(
                api,
                false,
                api.getSceneElements().filter((element) => ids.has(element.id)),
              )
            ).image || ""
          );
        },
        group.map((input) => input.points!),
        signal,
      );
      if (result.kind !== "function") {
        throw new Error("No function in selection");
      }
      return result.plot;
    }),
  );
  signal.throwIfAborted();
  if (functionSelection(api)?.token !== token) {
    throw new DOMException("Selection changed", "AbortError");
  }
  const expressions = plots.flatMap((plot) =>
    [plot.expression, ...(plot.compare || [])].map((expression) => {
      const resolved = expression.replace(
        /\b[abc]\b/g,
        (key) => `(${plot[key as "a"]})`,
      );
      return plot.z ? `(${resolved})+(${plot.z})` : resolved;
    }),
  );
  if (
    expressions.length < 2 ||
    expressions.length > 3 ||
    plots.some((plot) => plot.surface || plot.relation)
  ) {
    throw new Error(t("fcboard.functionGraph.mergeUnavailable"));
  }
  const plot = validatedPlot({
    ...plots[0],
    a: 1,
    b: 1,
    c: 0,
    z: 0,
    expression: expressions[0],
    compare: expressions.slice(1),
  });
  const bounds = boundsOf(source.inputs);
  const replaceIds = groups.flatMap(([input]) =>
    input.linked ? [input.linked.id] : [],
  );
  const ids = drawPlot(
    api,
    plot,
    { x: (bounds.left + bounds.right) / 2, y: bounds.bottom + 236 },
    replaceIds,
    undefined,
    false,
    bounds,
    [
      ...new Set(
        source.inputs.flatMap(
          (input) =>
            input.linked?.sourceIds ?? (input.linked ? [] : [input.id]),
        ),
      ),
    ],
  );
  if (!source.doc) {
    api.setActiveTool({ type: "selection" });
    api.updateScene({
      appState: objectSelection(
        api.getSceneElements().filter((element) => ids.includes(element.id)),
      ),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }
  return ids;
};
