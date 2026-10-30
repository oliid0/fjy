import { Capacitor } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { insertGeneratedImage } from "./imageGeneration";
import { sceneAPI } from "./test/scene";
import { selectionSignature } from "./selection";
import { classroomCommands } from "./commands";
import { defaults, saveSettings } from "./settings";

const image =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

it("requires the image model before sending any request", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    insertGeneratedImage(
      {} as FcboardImperativeAPI,
      "月球",
      new AbortController().signal,
    ),
  ).rejects.toThrow(
    t(
      "fcboard.functions_can_be_plotted_directly_set_an_image_model_id_in_settings_to_generate_illustrations",
    ),
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it("uses the independent image endpoint and inserts an ordinary image object with real file data", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
  saveSettings(
    {
      ...defaults,
      apiKey: "test-only",
      imageModel: "image-test",
      endpoint: "https://ark.cn-beijing.volces.com/api/v3/responses",
    },
    false,
  );
  const fetcher = vi.fn().mockResolvedValue({
    status: 200,
    json: async () => ({ data: [{ b64_json: image }] }),
  });
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 1;
      naturalHeight = 1;
      src = "";
      decode = async () => {};
    },
  );
  const api = {
    getSceneElements: () => [],
    getAppState: () => ({
      selectedElementIds: {},
      scrollX: 0,
      scrollY: 0,
      width: 1280,
      height: 720,
      zoom: { value: 1 },
      activeTool: { type: "selection" },
    }),
    addFiles: vi.fn(),
    updateScene: vi.fn(),
  } as unknown as FcboardImperativeAPI;
  await insertGeneratedImage(api, "月球", new AbortController().signal);
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://ark.cn-beijing.volces.com/api/v3/images/generations",
  );
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
    model: "image-test",
    prompt: "月球",
    response_format: "b64_json",
  });
  expect(api.addFiles).toHaveBeenCalledWith([
    expect.objectContaining({
      mimeType: "image/png",
      dataURL: `data:image/png;base64,${image}`,
    }),
  ]);
  expect(api.updateScene).toHaveBeenCalledWith(
    expect.objectContaining({
      elements: [
        expect.objectContaining({ type: "image", width: 400, height: 400 }),
      ],
    }),
  );
});

it("does not import a late generated image after cancellation", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
  saveSettings(
    { ...defaults, apiKey: "test-only", imageModel: "image-test" },
    false,
  );
  let finish!: (response: object) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const controller = new AbortController();
  const api = {
    addFiles: vi.fn(),
    updateScene: vi.fn(),
  } as unknown as FcboardImperativeAPI;
  const result = insertGeneratedImage(api, "月球", controller.signal);
  controller.abort();
  finish({ status: 200, json: async () => ({ data: [{ b64_json: image }] }) });
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(api.addFiles).not.toHaveBeenCalled();
  expect(api.updateScene).not.toHaveBeenCalled();
});

it.each(["source", "surface"])(
  "discards generated art after its %s changes while decoding",
  async (change) => {
    saveSettings(
      { ...defaults, apiKey: "test-only", imageModel: "illustrator" },
      false,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        json: async () => ({ data: [{ b64_json: image }] }),
      }),
    );
    let finish!: () => void;
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 100;
        naturalHeight = 100;
        src = "";
        decode = () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          });
      },
    );
    const api = sceneAPI();
    const source = api.getSceneElements();
    const result = insertGeneratedImage(
      api,
      "手绘小狗",
      new AbortController().signal,
      {
        bounds: { left: 10, top: 10, right: 110, bottom: 110 },
        replaceIds: source.map((element) => element.id),
        sourceSignature: selectionSignature(source),
      },
    );
    await vi.waitFor(() => expect(finish).toBeDefined());
    if (change === "source") {
      api.updateScene({ elements: [] });
    } else {
      classroomCommands.invalidate();
    }
    finish();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(api.addFiles).not.toHaveBeenCalled();
    expect(api.getSceneElements()).toEqual(change === "source" ? [] : source);
  },
);
