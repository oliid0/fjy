import { pointFrom } from "@excalidraw/math";
import {
  getCommonBounds,
  newFreeDrawElement,
  newIframeElement,
} from "@excalidraw/element";
import { Fonts } from "@excalidraw/excalidraw/fonts";
import { FONT_FAMILY } from "@excalidraw/common";
import { waitFor } from "@testing-library/react";

import { LessonCanvas, validateLesson } from "./lesson";
import { contentViewport } from "./board";
import { handwritingText } from "./handwriting";
import { sceneAPI } from "./test/scene";

const scene = (width = 1440, height = 900, zoom = 1) => {
  const api = sceneAPI();
  const state = api.getAppState();
  const source = newFreeDrawElement({
    type: "freedraw",
    x: 180,
    y: 160,
    points: [
      pointFrom(0, 0),
      pointFrom(12 / zoom, 32 / zoom),
      pointFrom(80 / zoom, 32 / zoom),
    ],
    strokeColor: "#b91c1c",
    strokeWidth: 2 / zoom,
    simulatePressure: true,
    customData: { fcInk: { version: 2, pen: "hard", unit: 1 / zoom } },
  });
  api.updateScene({ elements: [source] });
  vi.spyOn(api, "getAppState").mockReturnValue({
    ...state,
    width,
    height,
    zoom: { value: zoom as typeof state.zoom.value },
    scrollX: -100,
    scrollY: -80,
    selectedElementIds: { [source.id]: true },
    activeTool: { type: "selection" } as typeof state.activeTool,
  });
  return {
    api,
    source,
    renderer: new LessonCanvas(api, { sourceIds: [source.id] }),
  };
};
const command = (text: string, duration = 0) =>
  validateLesson({
    steps: [
      { commands: [{ type: "write_text", id: "answer", text, duration }] },
    ],
  }).steps[0].commands[0];
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each(
  [1440, 3080, 390].flatMap((width) =>
    [0.5, 1, 2].map((zoom) => ({ width, zoom })),
  ),
)(
  "keeps Chinese lesson text visible at $width and zoom $zoom without moving the camera",
  async ({ width, zoom }) => {
    const { api, source, renderer } = scene(
      width,
      width === 3080 ? 1240 : 900,
      zoom,
    );
    await renderer.command(
      command("同样质量下，力增大时加速度增大。".repeat(4)),
    );
    const written = api
      .getSceneElements()
      .filter((element) => element.id !== source.id);
    const [left, top, right, bottom] = getCommonBounds(written);
    const viewport = contentViewport(api);
    expect(left).toBeGreaterThanOrEqual(viewport.left - 1e-6);
    expect(top).toBeGreaterThan(source.y + 32 / zoom);
    expect(right).toBeLessThanOrEqual(viewport.right + 1e-6);
    expect(bottom).toBeLessThanOrEqual(viewport.bottom + 1e-6);
    expect(written[0]).toMatchObject({
      type: "text",
      fontFamily: FONT_FAMILY.Excalifont,
      strokeColor: source.strokeColor,
    });
    expect(
      written[0].type === "text" && written[0].fontSize,
    ).toBeLessThanOrEqual(32 / zoom / 1.25);
    expect(
      vi
        .mocked(api.updateScene)
        .mock.calls.every(
          ([change]) =>
            change.appState?.scrollX === undefined &&
            change.appState?.scrollY === undefined,
        ),
    ).toBe(true);
  },
);

it("writes ordinary editable strokes progressively and stops after the user erases part of the group", async () => {
  vi.useFakeTimers();
  const { api, source, renderer } = scene();
  const pending = renderer.command(command("F=ma", 1));
  await vi.advanceTimersByTimeAsync(160);
  const partial = api
    .getSceneElements()
    .filter((element) => element.id !== source.id);
  expect(partial.length).toBeGreaterThan(0);
  expect(
    partial.every(
      (element) =>
        element.type === "freedraw" &&
        element.strokeColor === source.strokeColor,
    ),
  ).toBe(true);
  expect(handwritingText(partial)).toEqual([]);
  renderer.pause();
  const frozen = JSON.stringify(partial);
  await vi.advanceTimersByTimeAsync(500);
  expect(
    JSON.stringify(
      api.getSceneElements().filter((element) => element.id !== source.id),
    ),
  ).toBe(frozen);
  api.updateScene({
    elements: api
      .getSceneElements()
      .filter((element) => element.id !== partial[0].id),
  });
  const edited = JSON.stringify(api.getSceneElements());
  renderer.resume();
  await vi.advanceTimersByTimeAsync(1600);
  await pending;
  expect(JSON.stringify(api.getSceneElements())).toBe(edited);
});

it("produces a single grouped handwritten result and removes all of it with the lesson erase command", async () => {
  const { api, source, renderer } = scene();
  await renderer.command(command("F=ma"));
  const ink = api
    .getSceneElements()
    .filter((element) => element.id !== source.id);
  expect(ink.length).toBeGreaterThan(1);
  expect(handwritingText(ink)).toEqual(["F=ma"]);
  expect(new Set(ink.map((element) => element.groupIds.join(","))).size).toBe(
    1,
  );
  await renderer.command(
    validateLesson({
      steps: [{ commands: [{ type: "erase_object", target: "answer" }] }],
    }).steps[0].commands[0],
  );
  expect(api.getSceneElements().map((element) => element.id)).toEqual([
    source.id,
  ]);
});

it("cancels delayed font preparation when its handwritten question has been removed", async () => {
  const { api, source, renderer } = scene();
  let ready!: () => void;
  const load = vi.spyOn(Fonts, "loadElementsFonts").mockReturnValue(
    new Promise((resolve) => {
      ready = () => resolve([]);
    }),
  );
  const pending = renderer
    .command(command("牛顿第二定律"))
    .catch((error) => error);
  await waitFor(() => expect(load).toHaveBeenCalled());
  api.updateScene({ elements: [] });
  ready();
  expect(await pending).toMatchObject({ name: "AbortError" });
  expect(
    api.getSceneElements().some((element) => element.id !== source.id),
  ).toBe(false);
});

it("fits a vector formula near the source and preserves its physical size through zoom", async () => {
  for (const zoom of [0.5, 1, 2]) {
    const { api, source, renderer } = scene(390, 844, zoom);
    await renderer.command(
      validateLesson({
        steps: [
          {
            commands: [
              {
                type: "write_math",
                id: "force",
                text: "\\frac{F}{m}=a",
                duration: 0,
              },
            ],
          },
        ],
      }).steps[0].commands[0],
    );
    const image = api
      .getSceneElements()
      .find((element) => element.id !== source.id)!;
    const viewport = contentViewport(api);
    const [left, top, right, bottom] = getCommonBounds([image]);
    expect(image.type).toBe("image");
    expect(left).toBeGreaterThanOrEqual(viewport.left - 1e-6);
    expect(top).toBeGreaterThan(160 + 32 / zoom);
    expect(right).toBeLessThanOrEqual(viewport.right + 1e-6);
    expect(bottom).toBeLessThanOrEqual(viewport.bottom + 1e-6);
    expect(image.height * zoom).toBeLessThan(100);
  }
});

it("uses visible blank space when a selected resource leaves room for text but not the old insertion rectangle", async () => {
  const api = sceneAPI();
  const state = api.getAppState();
  const resource = newIframeElement({
    type: "iframe",
    x: 16,
    y: 16,
    width: 358,
    height: 500,
  });
  api.updateScene({ elements: [resource] });
  vi.spyOn(api, "getAppState").mockReturnValue({
    ...state,
    width: 390,
    height: 660,
    selectedElementIds: { [resource.id]: true },
    activeTool: { type: "selection" } as typeof state.activeTool,
  });
  const renderer = new LessonCanvas(api);
  await renderer.command(command("牛顿定律"));
  const written = api
    .getSceneElements()
    .filter((element) => element.id !== resource.id);
  const bounds = getCommonBounds(written);
  expect(bounds[1]).toBeGreaterThanOrEqual(516);
  expect(bounds[3]).toBeLessThanOrEqual(contentViewport(api).bottom + 1e-6);
});
