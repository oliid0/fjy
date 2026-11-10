import type { Spec } from "@fcboard/fcboard/visualizationRuntime";

import { functionView } from "./math";

import type { Plot } from "./math";

// Vega docs/examples/zoomable-scatter-plot.vg.json: public pan/wheel/pinch
// signals, with finite domain limits matching validatedPlot.
const navigation = [
  {
    name: "down",
    value: null,
    on: [
      {
        events: "touchend",
        update: "null",
      },
      {
        events: "pointerdown, touchstart",
        update: "xy()",
      },
    ],
  },
  {
    name: "xcur",
    value: null,
    on: [
      {
        events: "pointerdown, touchstart, touchend",
        update: "slice(xdom)",
      },
    ],
  },
  {
    name: "ycur",
    value: null,
    on: [
      {
        events: "pointerdown, touchstart, touchend",
        update: "slice(ydom)",
      },
    ],
  },
  {
    name: "delta",
    value: [0, 0],
    on: [
      {
        events: [
          {
            source: "window",
            type: "pointermove",
            consume: true,
            between: [
              {
                type: "pointerdown",
              },
              {
                source: "window",
                type: "pointerup",
              },
            ],
          },
          {
            type: "touchmove",
            consume: true,
            filter: "event.touches.length === 1",
          },
        ],
        update: "down ? [down[0]-x(), y()-down[1]] : [0,0]",
      },
    ],
  },
  {
    name: "anchor",
    value: [0, 0],
    on: [
      {
        events: "wheel",
        update: "[invert('x', x()), invert('y', y())]",
      },
      {
        events: {
          type: "touchstart",
          filter: "event.touches.length===2",
        },
        update: "[(xdom[0] + xdom[1]) / 2, (ydom[0] + ydom[1]) / 2]",
      },
    ],
  },
  {
    name: "zoom",
    value: 1,
    on: [
      {
        events: "wheel!",
        force: true,
        update: "pow(1.001, event.deltaY * pow(16, event.deltaMode))",
      },
      {
        events: {
          signal: "dist2",
        },
        force: true,
        update: "dist1 / dist2",
      },
    ],
  },
  {
    name: "dist1",
    value: 0,
    on: [
      {
        events: {
          type: "touchstart",
          filter: "event.touches.length===2",
        },
        update: "pinchDistance(event)",
      },
    ],
  },
  {
    name: "dist2",
    value: 0,
    on: [
      {
        events: {
          type: "touchmove",
          consume: true,
          filter: "event.touches.length===2",
        },
        update: "pinchDistance(event)",
      },
    ],
  },
  {
    name: "xdom",
    on: [
      {
        events: {
          signal: "delta",
        },
        update:
          "[xcur[0] + span(xcur) * delta[0] / width, xcur[1] + span(xcur) * delta[0] / width]",
      },
      {
        events: {
          signal: "zoom",
        },
        update:
          "isFinite(zoom) && zoom > 0 && span(xdom) * zoom >= 0.0001 && span(xdom) * zoom <= 2000 ? [anchor[0] + (xdom[0] - anchor[0]) * zoom, anchor[0] + (xdom[1] - anchor[0]) * zoom] : xdom",
      },
    ],
    value: [-10, 10],
  },
  {
    name: "ydom",
    on: [
      {
        events: {
          signal: "delta",
        },
        update:
          "[ycur[0] + span(ycur) * delta[1] / height, ycur[1] + span(ycur) * delta[1] / height]",
      },
      {
        events: {
          signal: "zoom",
        },
        update:
          "isFinite(zoom) && zoom > 0 && span(ydom) * zoom >= 0.0001 && span(ydom) * zoom <= 2000 ? [anchor[1] + (ydom[0] - anchor[1]) * zoom, anchor[1] + (ydom[1] - anchor[1]) * zoom] : ydom",
      },
    ],
    value: [-10, 10],
  },
] as NonNullable<Spec["signals"]>;
export const functionGraphNavigation = (
  plot: Plot,
): NonNullable<Spec["signals"]> => {
  const bounds = functionView(plot);
  return [
    ...navigation.map((signal) =>
      signal.name === "xdom"
        ? { ...signal, value: [bounds.left, bounds.right] }
        : signal.name === "ydom"
        ? { ...signal, value: [bounds.bottom, bounds.top] }
        : signal,
    ),
    {
      name: "clicked",
      value: null,
      on: [
        {
          events: "click",
          update: "[clamp(x()/width,0,1),clamp(1-y()/height,0,1)]",
        },
      ],
    },
  ];
};
