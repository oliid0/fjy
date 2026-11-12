import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import {
  generateImage,
  insertGeneratedImage,
  insertImageResult,
} from "./imageGeneration";
import { sceneAPI } from "./test/scene";
import { selectionSignature } from "./selection";
import { classroomCommands } from "./commands";
import { defaults, saveSettings } from "./settings";

vi.mock("@capacitor/core", async (original) => ({
  ...(await original<typeof import("@capacitor/core")>()),
  CapacitorHttp: { post: vi.fn() },
}));

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

const pngGeneration = () => {
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
  const fetcher = vi.fn().mockResolvedValue({
    status: 200,
    json: async () => ({ data: [{ b64_json: image }] }),
  });
  vi.stubGlobal("fetch", fetcher);
  return { api: sceneAPI(), fetcher };
};

it.each([defaults.imageModel, "custom-illustrator"])(
  "inserts the original transparent PNG from model %s in exactly one request",
  async (imageModel) => {
    const { api, fetcher } = pngGeneration();
    saveSettings({ ...defaults, apiKey: "test", imageModel }, false);
    const before = api.getSceneElements();
    await insertGeneratedImage(
      api,
      "参考PNG中的文字和草图",
      new AbortController().signal,
      {
        transparent: true,
        referenceImage: "data:image/png;base64,source",
        replaceIds: before.map((element) => element.id),
        sourceSignature: selectionSignature(before),
      },
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({
      model: imageModel,
      background: "transparent",
      output_format: "png",
      image: "data:image/png;base64,source",
    });
    expect(body).not.toHaveProperty("layer_decomposition");
    expect(api.addFiles).toHaveBeenCalledWith([
      expect.objectContaining({
        dataURL: `data:image/png;base64,${image}`,
        mimeType: "image/png",
      }),
    ]);
    expect(api.getSceneElements()).toHaveLength(1);
    expect(api.getSceneElements()[0].type).toBe("image");
    expect(api.updateScene).toHaveBeenCalledTimes(1);
  },
);

it("keeps every returned creative pixel with no alpha pass, background option or second request", async () => {
  const { api, fetcher } = pngGeneration();
  await insertGeneratedImage(
    api,
    "保留完整背景",
    new AbortController().signal,
    {
      referenceImage: "data:image/png;base64,selection",
      transparent: false,
    },
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body).toMatchObject({
    output_format: "png",
    image: "data:image/png;base64,selection",
  });
  expect(body).not.toHaveProperty("background");
  expect(body).not.toHaveProperty("layer_decomposition");
  expect(api.addFiles).toHaveBeenCalledWith([
    expect.objectContaining({ dataURL: `data:image/png;base64,${image}` }),
  ]);
});

it("uses the returned magic PNG immediately without a pixel scan, canvas export or extra request", async () => {
  const { api, fetcher } = pngGeneration();
  const sample = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
  const encode = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL");
  sample.mockClear();
  encode.mockClear();
  const generated = await generateImage(
    "魔法笔",
    new AbortController().signal,
    {
      transparent: true,
    },
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(sample).not.toHaveBeenCalled();
  expect(encode).not.toHaveBeenCalled();
  await insertImageResult(api, generated, new AbortController().signal);
  expect(api.addFiles).toHaveBeenCalledWith([
    expect.objectContaining({ dataURL: `data:image/png;base64,${image}` }),
  ]);
});

it("uses the same one-call transparent PNG body through Android CapacitorHttp", async () => {
  const { api, fetcher } = pngGeneration();
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  const post = vi.spyOn(CapacitorHttp, "post").mockResolvedValue({
    status: 200,
    data: { data: [{ b64_json: image }] },
    headers: {},
    url: "https://image.test",
  });
  await insertGeneratedImage(
    api,
    "手写要求和草图",
    new AbortController().signal,
    {
      transparent: true,
      referenceImage: "data:image/png;base64,ink",
    },
  );
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][0].data).toMatchObject({
    output_format: "png",
    background: "transparent",
    image: "data:image/png;base64,ink",
  });
  expect(post.mock.calls[0][0].data).not.toHaveProperty("layer_decomposition");
  expect(fetcher).not.toHaveBeenCalled();
});

it("inserts the provider PNG on courseware in one guarded transaction", async () => {
  const { api, fetcher } = pngGeneration();
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
      referenceImage: "data:image/png;base64,sketch",
      replaceIds: ["original-ink"],
      sourcePage: 2,
      sourceSignature: "signature",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(draw).toHaveBeenCalledWith(
      expect.objectContaining({
        image: `data:image/png;base64,${image}`,
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
