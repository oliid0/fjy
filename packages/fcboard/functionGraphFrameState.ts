import type { ResourceLiveUpdate } from "./components/InteractiveResourceFrame";

type GraphPlot = {
  expression: string;
  x: number;
  y: number;
  z: number;
  a: number;
  b: number;
  c: number;
  range: number;
  view?: { left: number; right: number; bottom: number; top: number };
  compare?: readonly string[];
};

/** Domain/parameter edits are live Vega state. Expression changes replace the
 * document; persisted HTML still contains the latest domain for a fresh mount. */
export const functionGraphFrameState = (
  id: string,
  plot: GraphPlot,
  color: string,
): ResourceLiveUpdate | undefined => {
  if (!plot || typeof plot.expression !== "string") {
    return undefined;
  }
  const { view, range, a, b, c, ...definition } = plot;
  const bounds = view || {
    left: plot.x - range,
    right: plot.x + range,
    bottom: -range,
    top: range,
  };
  if (!Object.values(bounds).every(Number.isFinite)) {
    return undefined;
  }
  return {
    key: JSON.stringify([id, definition, color]),
    message: {
      channel: "fc-function-graph",
      type: "restore",
      id,
      view: bounds,
      parameters: { a, b, c },
    },
  };
};
