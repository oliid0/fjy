import { animateSolid } from "./solidAnimation";
import { readWidgets, renderWidget, widgetDefaults } from "./widgets";
import { sceneAPI } from "./test/scene";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("interpolates rigid faces and captures only the final pose as an undoable update", async () => {
  vi.useFakeTimers();
  const api = sceneAPI();
  renderWidget(api, {
    id: "cube",
    kind: "cube",
    params: widgetDefaults(),
    position: { x: 200, y: 200 },
  });
  const original = readWidgets(api)[0];
  vi.mocked(api.updateScene).mockClear();
  const target = {
    ...original,
    params: {
      ...original.params,
      solid: { ...original.params.solid, unfold: 1 },
    },
  };
  const pending = animateSolid(
    api,
    original,
    target,
    new AbortController().signal,
    160,
  );
  await vi.advanceTimersByTimeAsync(80);
  const partial = readWidgets(api)[0].params.solid.unfold;
  expect(partial).toBeGreaterThan(0);
  expect(partial).toBeLessThan(1);
  await vi.advanceTimersByTimeAsync(160);
  await expect(pending).resolves.toMatchObject({ ids: expect.any(Array) });
  expect(readWidgets(api)[0].params.solid.unfold).toBe(1);
  expect(
    vi
      .mocked(api.updateScene)
      .mock.calls.filter(([update]) => update.captureUpdate === "IMMEDIATELY"),
  ).toHaveLength(1);
});

it("restores the initial pose on cancellation and ignores later frames", async () => {
  vi.useFakeTimers();
  const api = sceneAPI();
  renderWidget(api, {
    id: "cube",
    kind: "cube",
    params: widgetDefaults(),
    position: { x: 200, y: 200 },
  });
  const original = readWidgets(api)[0];
  const signal = new AbortController();
  const pending = animateSolid(
    api,
    original,
    {
      ...original,
      params: {
        ...original.params,
        solid: { ...original.params.solid, unfold: 1 },
      },
    },
    signal.signal,
    160,
  ).catch((e) => e);
  await vi.advanceTimersByTimeAsync(80);
  signal.abort();
  expect((await pending).name).toBe("AbortError");
  expect(readWidgets(api)[0]).toEqual(original);
  const stopped = JSON.stringify(api.getSceneElements());
  await vi.advanceTimersByTimeAsync(500);
  expect(JSON.stringify(api.getSceneElements())).toBe(stopped);
});

it("does not resurrect an object removed during animation", async () => {
  vi.useFakeTimers();
  const api = sceneAPI();
  renderWidget(api, {
    id: "cube",
    kind: "cube",
    params: widgetDefaults(),
    position: { x: 200, y: 200 },
  });
  const original = readWidgets(api)[0];
  const pending = animateSolid(
    api,
    original,
    {
      ...original,
      params: {
        ...original.params,
        solid: { ...original.params.solid, unfold: 1 },
      },
    },
    new AbortController().signal,
    160,
  ).catch((e) => e);
  await vi.advanceTimersByTimeAsync(80);
  api.updateScene({
    elements: api.getSceneElements().filter((el) => !el.customData?.fcWidget),
  });
  await vi.advanceTimersByTimeAsync(500);
  expect((await pending).name).toBe("AbortError");
  expect(readWidgets(api)).toEqual([]);
});
