import { Capacitor } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";

import type { DataURL, FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { insertGeneratedImage } from "./imageGeneration";
import { sceneAPI } from "./test/scene";
import { selectionSignature } from "./selection";
import { classroomCommands } from "./commands";
import { defaults, saveSettings } from "./settings";
import * as transparent from "./transparentInkImage";

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

it("inserts a successful custom-model generation without unsupported decomposition options", async () => {
  saveSettings(
    { ...defaults, apiKey: "test", imageModel: "custom-illustrator" },
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
      naturalWidth = 100;
      naturalHeight = 100;
      src = "";
      decode = async () => {};
    },
  );
  const api = sceneAPI();
  const before = api.getSceneElements();
  await insertGeneratedImage(api, "透明小推车", new AbortController().signal, {
    transparent: true,
    replaceIds: before.map((element) => element.id),
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse(fetcher.mock.calls[0][1].body).layer_decomposition,
  ).toBeUndefined();
  expect(api.getSceneElements()).toHaveLength(1);
  expect(api.getSceneElements()[0].type).toBe("image");
  expect(api.addFiles).toHaveBeenCalledTimes(1);
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

it("does not shrink a text-to-image result to the height of one handwritten prompt line", async () => {
  saveSettings(
    { ...defaults, apiKey: "test", imageModel: "illustrator" },
    false,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ data: [{ b64_json: image }] }),
    }),
  );
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 1000;
      naturalHeight = 1000;
      src = "";
      decode = async () => {};
    },
  );
  const api = sceneAPI();
  const source = api.getSceneElements();
  await insertGeneratedImage(
    api,
    "一个二次元女孩",
    new AbortController().signal,
    {
      bounds: { left: 100, top: 100, right: 700, bottom: 140 },
      replaceIds: source.map((element) => element.id),
    },
  );
  expect(api.getSceneElements()).toHaveLength(1);
  expect(api.getSceneElements()[0]).toMatchObject({
    type: "image",
    width: 400,
    height: 400,
  });
});

it("reports a per-image provider error inside HTTP 200 without replacing the handwriting", async () => {
  saveSettings(
    { ...defaults, apiKey: "test", imageModel: "illustrator" },
    false,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        data: [{ error: { message: "image generation unavailable" } }],
      }),
    }),
  );
  const api = sceneAPI();
  const before = api.getSceneElements();
  await expect(
    insertGeneratedImage(api, "一个二次元女孩", new AbortController().signal),
  ).rejects.toThrow("image generation unavailable");
  expect(api.getSceneElements()).toEqual(before);
  expect(api.addFiles).not.toHaveBeenCalled();
});

const subjectGeneration = () => {
  saveSettings({ ...defaults, apiKey: "test" }, false);
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 100;
      naturalHeight = 100;
      src = "";
      decode = async () => {};
    },
  );
  const compose = vi.spyOn(transparent, "transparentInkImage").mockReturnValue({
    dataURL: "data:image/png;base64,subject" as DataURL,
    width: 100,
    height: 100,
  });
  const fetcher = vi.fn().mockResolvedValueOnce({
    status: 200,
    json: async () => ({ data: [{ b64_json: image }] }),
  });
  vi.stubGlobal("fetch", fetcher);
  return { api: sceneAPI(), compose, fetcher };
};
const subject = {
  b64_json: image,
  z_index: 1,
  bounding_box: { absolute: [10, 20, 110, 120] },
};

it("generates then decomposes, excluding the base and atomically replacing ink with only the transparent subject", async () => {
  const { api, compose, fetcher } = subjectGeneration();
  fetcher.mockResolvedValueOnce({
    status: 200,
    json: async () => ({
      data: [{ b64_json: "base-is-never-decoded", z_index: 0 }, subject],
    }),
  });
  const before = api.getSceneElements();
  await insertGeneratedImage(
    api,
    "一个二次元女孩",
    new AbortController().signal,
    {
      transparent: true,
      replaceIds: before.map((element) => element.id),
      sourceSignature: selectionSignature(before),
    },
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  const [first, split] = fetcher.mock.calls.map((call) =>
    JSON.parse(call[1].body),
  );
  expect(first.layer_decomposition).toBeUndefined();
  expect(split).toMatchObject({
    model: defaults.imageModel,
    layer_decomposition: true,
    size: "1.5K",
    response_format: "b64_json",
    image: `data:image/png;base64,${image}`,
  });
  expect(compose).toHaveBeenCalledWith([
    expect.objectContaining({
      zIndex: 1,
      bounds: { left: 10, top: 20, right: 110, bottom: 120 },
    }),
  ]);
  expect(api.addFiles).toHaveBeenCalledWith([
    expect.objectContaining({ dataURL: "data:image/png;base64,subject" }),
  ]);
  expect(api.getSceneElements()).toHaveLength(1);
  expect(api.getSceneElements()[0].type).toBe("image");
  expect(api.updateScene).toHaveBeenCalledTimes(1);
});

it.each([
  [{ z_index: 0, b64_json: image }],
  [{ ...subject, bounding_box: undefined }],
  [{ ...subject, b64_json: "/9j/jpeg-layer" }],
  [{ z_index: 0, b64_json: image }, { error: { message: "split failed" } }],
])(
  "keeps the successful generation when optional decomposition returns invalid layers %j",
  async (...items) => {
    const { api, fetcher } = subjectGeneration();
    const before = api.getSceneElements();
    fetcher.mockResolvedValueOnce({
      status: 200,
      json: async () => ({ data: items }),
    });
    await insertGeneratedImage(api, "小狗", new AbortController().signal, {
      transparent: true,
      replaceIds: before.map((element) => element.id),
    });
    expect(api.getSceneElements()).toHaveLength(1);
    expect(api.getSceneElements()[0].type).toBe("image");
    expect(api.addFiles).toHaveBeenCalledWith([
      expect.objectContaining({ dataURL: `data:image/png;base64,${image}` }),
    ]);
    expect(api.updateScene).toHaveBeenCalledTimes(1);
  },
);

it("keeps ink while splitting and discards a successful late split after cancellation", async () => {
  const { api, compose, fetcher } = subjectGeneration();
  const before = api.getSceneElements();
  let finish!: (response: object) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const request = new AbortController();
  const pending = insertGeneratedImage(api, "小狗", request.signal, {
    transparent: true,
    replaceIds: before.map((element) => element.id),
  });
  await vi.waitFor(() => expect(finish).toBeDefined());
  expect(api.getSceneElements()).toEqual(before);
  expect(api.addFiles).not.toHaveBeenCalled();
  request.abort();
  finish({ status: 200, json: async () => ({ data: [subject] }) });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(compose).not.toHaveBeenCalled();
  expect(api.getSceneElements()).toEqual(before);
});

it("uses the same transparent subject transaction on the courseware surface", async () => {
  const { api, fetcher } = subjectGeneration();
  fetcher.mockResolvedValueOnce({
    status: 200,
    json: async () => ({ data: [subject] }),
  });
  const draw = vi.fn();
  const unregister = classroomCommands.register(
    "document.draw",
    "@internal",
    draw,
  );
  const unlayout = classroomCommands.context("document.layout", () => ({
    viewport: { left: 0, top: 0, right: 900, bottom: 480 },
    scale: 1,
  }));
  try {
    await insertGeneratedImage(api, "小狗", new AbortController().signal, {
      transparent: true,
      replaceIds: ["original-ink"],
      sourcePage: 2,
      sourceSignature: "signature",
    });
    expect(draw).toHaveBeenCalledWith(
      expect.objectContaining({
        image: "data:image/png;base64,subject",
        replaceIds: ["original-ink"],
        sourcePage: 2,
        sourceSignature: "signature",
        progress: 1,
      }),
    );
    expect(api.addFiles).not.toHaveBeenCalled();
  } finally {
    unregister();
    unlayout();
  }
});
