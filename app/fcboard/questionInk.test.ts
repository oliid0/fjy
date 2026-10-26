import { getNormalizedZoom } from "@excalidraw/excalidraw/scene";

import {
  questionPosition,
  questionSurface,
  validateQuestionInk,
} from "./questionInk";
import { classroomCommands } from "./commands";
import { sceneAPI } from "./test/scene";

it("uses the main canvas offset and zoom for displayed and submitted ink", () => {
  const api = sceneAPI();
  const previous = api.getAppState();
  api.getAppState = () => ({
    ...previous,
    offsetLeft: 40,
    offsetTop: 30,
    scrollX: -150,
    scrollY: 70,
    zoom: { value: getNormalizedZoom(2) },
  });
  const surface = questionSurface(api);
  expect(surface.point(640, 430)).toEqual([450, 130]);
  const position = questionPosition(api);
  expect(position.left).toBeGreaterThanOrEqual(surface.viewport.left);
  expect(position.left + position.width).toBeLessThanOrEqual(
    surface.viewport.right,
  );
  expect(position.top + position.height).toBeLessThanOrEqual(
    surface.viewport.bottom,
  );
});

it("uses only the visible courseware's transform and obstacles", () => {
  const api = sceneAPI();
  const stops = [
    classroomCommands.context("document", () => ({
      viewport: { left: 120, top: 80, scroll: 50 },
    })),
    classroomCommands.context("document.layout", () => ({
      scale: 1.5,
      viewport: { left: 10, top: 50, right: 900, bottom: 600 },
      obstacles: [{ left: 300, top: 150, right: 600, bottom: 400 }],
    })),
  ];
  try {
    const surface = questionSurface(api);
    expect(surface.point(420, 230)).toEqual([200, 150]);
    const position = questionPosition(api);
    const obstacle = surface.obstacles[0];
    expect(
      position.left >= obstacle.right ||
        position.left + position.width <= obstacle.left ||
        position.top >= obstacle.bottom ||
        position.top + position.height <= obstacle.top,
    ).toBe(true);
  } finally {
    stops.forEach((stop) => stop());
  }
});

it("refuses to cover a full writing surface or accept malformed trajectories", () => {
  const api = sceneAPI();
  const state = api.getAppState();
  api.getAppState = () => ({ ...state, width: 100, height: 100 });
  expect(() => questionPosition(api)).toThrow();
  for (const input of [[], [[]], [[[0, NaN]]], [[[0, 1, 2]]], "ink"]) {
    expect(() => validateQuestionInk(input)).toThrow();
  }
  expect(
    validateQuestionInk([
      [
        [1, 2],
        [3, 4],
      ],
    ]),
  ).toEqual([
    [
      [1, 2],
      [3, 4],
    ],
  ]);
});

it("uses the compact writing height beside a portrait experiment without overlapping it or the toolbar", () => {
  const api = sceneAPI();
  const stops = [
    classroomCommands.context("document", () => ({
      viewport: { left: 0, top: 0, scroll: 0 },
    })),
    classroomCommands.context("document.layout", () => ({
      scale: 1,
      viewport: { left: 16, top: 16, right: 374, bottom: 711 },
      obstacles: [{ left: 51, top: 124, right: 339, bottom: 586 }],
    })),
  ];
  try {
    const position = questionPosition(api);
    expect(position.height).toBeCloseTo(100.8);
    expect(position.width).toBe(358);
    expect(position.top).toBeGreaterThanOrEqual(594);
    expect(position.top + position.height).toBeLessThanOrEqual(711);
  } finally {
    stops.forEach((stop) => stop());
  }
});
