import { getCommonBounds } from "@fcboard/element";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { selectedBoardElements, boardContext } from "./ai";
import { drawPlot } from "./board";
import { classroomCommands } from "./commands";
import { boardInk } from "./digitalInk";
import { documentStrokeBounds, inkSnapshot } from "./documents";
import { latestFunctionInk } from "./functionInk";
import { recognizeInkContent } from "./inkRecognition";
import { localMathResult, validatedPlot } from "./mathRecognition";

import type { InkStroke } from "./documents";
import type { Plot } from "./math";
import type { ContentRect } from "./placement";

type Input = {
  id: string;
  text?: string;
  plot?: Plot;
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

/** The language-pen selection observer's ownership pattern, applied to function
 * comparison. Each raw expression is recognized independently and concurrently. */
export const observeFunctionComparison = (api: FcboardImperativeAPI) => {
  let previous = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  const read = () => {
    const state = api.getAppState();
    const doc = classroomCommands.read("document") as Document | undefined;
    if (
      state.currentItemInkAssist !== "function" ||
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
          !stroke.plot &&
          !stroke.text &&
          stroke.fcInk?.assist !== "function"
        ) {
          return;
        }
        inputs.push({
          id: stroke.id,
          text: stroke.originalText || stroke.text,
          plot: stroke.plot?.plot,
          points: stroke.plot || stroke.text ? undefined : stroke.points,
          bounds: documentStrokeBounds(stroke),
        });
      }
    } else {
      for (const element of selectedBoardElements(api)) {
        const plot = element.customData?.fcPlot?.plot as Plot | undefined;
        if (
          !plot &&
          element.type !== "text" &&
          (element.type !== "freedraw" ||
            element.customData?.fcInk?.assist !== "function")
        ) {
          return;
        }
        const [left, top, right, bottom] = getCommonBounds([element]);
        inputs.push({
          id: element.id,
          text: element.type === "text" ? element.originalText : undefined,
          plot,
          points:
            element.type === "freedraw" ? boardInk([element])[0] : undefined,
          bounds: { left, top, right, bottom },
        });
      }
    }
    if (!inputs.length || inputs.length > 3000) {
      return;
    }
    return {
      inputs,
      doc,
      token: JSON.stringify([
        doc ? [doc.id, doc.name, doc.page] : api.id,
        inputs,
      ]),
    };
  };
  const refresh = () => {
    const source = read();
    const token = source?.token || "";
    if (token === previous) {
      return;
    }
    previous = token;
    request?.abort();
    if (!source) {
      return;
    }
    const groups = source.inputs
      .filter((input) => input.text || input.plot)
      .map((input) => [input]);
    let raw = source.inputs.filter((input) => input.points);
    while (raw.length && groups.length <= 4) {
      const included = latestFunctionInk(raw.map((input) => input.points!));
      groups.push(raw.filter((_, index) => included.has(index)));
      raw = raw.filter((_, index) => !included.has(index));
    }
    if (groups.length < 2 || groups.length > 4 || raw.length) {
      return;
    }
    groups.sort(
      (a, b) =>
        boundsOf(a).top - boundsOf(b).top ||
        boundsOf(a).left - boundsOf(b).left,
    );
    const controller = new AbortController();
    request = controller;
    void Promise.all(
      groups.map(async (group) => {
        const known = group[0];
        if (known.plot) {
          return known.plot;
        }
        if (known.text) {
          const result = localMathResult(known.text, "function");
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
                  api
                    .getSceneElements()
                    .filter((element) => ids.has(element.id)),
                )
              ).image || ""
            );
          },
          group.map((input) => input.points!),
          controller.signal,
        );
        if (result.kind !== "function") {
          throw new Error("No function in selection");
        }
        return result.plot;
      }),
    )
      .then((plots) => {
        controller.signal.throwIfAborted();
        if (read()?.token !== token) {
          return;
        }
        if (plots.some((plot) => plot.surface || plot.relation)) {
          return;
        }
        const expressions = plots.flatMap((plot) => [
          plot.expression,
          ...(plot.compare || []),
        ]);
        if (expressions.length < 2 || expressions.length > 4) {
          return;
        }
        const plot = validatedPlot({
          ...plots[0],
          compare: expressions.slice(1),
        });
        const bounds = boundsOf(source.inputs);
        drawPlot(
          api,
          plot,
          { x: bounds.right + 245, y: bounds.top + 220 },
          [],
          token,
          true,
          bounds,
        );
      })
      .catch((failure) => {
        if (!controller.signal.aborted && read()?.token === token) {
          api.updateScene({
            appState: {
              errorMessage:
                failure instanceof Error ? failure.message : String(failure),
            },
          });
        }
      });
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 120);
  };
  const stops = [
    api.onChange(schedule),
    classroomCommands.watch("document", schedule),
    classroomCommands.onInvalidate(() => {
      request?.abort();
      previous = "";
    }),
  ];
  schedule();
  return () => {
    clearTimeout(timer);
    request?.abort();
    stops.forEach((stop) => stop());
  };
};
