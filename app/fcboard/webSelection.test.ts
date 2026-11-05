import { CapacitorHttp } from "@capacitor/core";

import { insertWebSelection } from "./webSelection";
import { sceneAPI } from "./test/scene";
import { registerCanvasCommands } from "./canvasCommands";
import { classroomCommands } from "./commands";
vi.mock("@capacitor/core", async (original) => ({
  ...(await original<typeof import("@capacitor/core")>()),
  CapacitorHttp: { get: vi.fn() },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each([0.5, 2])(
  "places a held image at the actual drop at zoom %s, even over existing content",
  async (zoom) => {
    const api = sceneAPI();
    const state = api.getAppState();
    api.getAppState = () => ({
      ...state,
      zoom: { value: zoom as typeof state.zoom.value },
      scrollX: 80 as typeof state.scrollX,
      scrollY: -40 as typeof state.scrollY,
      offsetLeft: 30,
      offsetTop: 40,
    });
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 200;
        naturalHeight = 100;
        src = "";
        decode = async () => {};
      },
    );
    const before = api.getSceneElements();
    await insertWebSelection(
      api,
      {
        kind: "image",
        value: "data:image/png;base64,aW1hZ2U=",
        position: { x: 360, y: 280 },
      },
      new AbortController().signal,
    );
    const image = api.getSceneElements().find((item) => item.type === "image")!;
    expect(image.x + image.width / 2).toBeCloseTo((360 - 30) / zoom - 80);
    expect(image.y + image.height / 2).toBeCloseTo((280 - 40) / zoom + 40);
    expect(
      api
        .getSceneElements()
        .filter((item) => before.some((old) => old.id === item.id)),
    ).toEqual(before);
  },
);

it("maps an image drop into the scrolled courseware coordinates", async () => {
  const api = sceneAPI();
  vi.stubGlobal("devicePixelRatio", 1);
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 200;
      naturalHeight = 100;
      src = "";
      decode = async () => {};
    },
  );
  const stage = document.createElement("div");
  stage.className = "fc-document-stage";
  stage.getBoundingClientRect = () => ({ left: 100, top: 80 } as DOMRect);
  document.body.append(stage);
  const draw = vi.fn();
  const stops = [
    classroomCommands.context("document", () => ({
      viewport: { scroll: 300 },
    })),
    classroomCommands.context("document.layout", () => ({
      scale: 2,
      viewport: { left: 0, top: 300, right: 1000, bottom: 800 },
    })),
    classroomCommands.register("document.draw", "@internal", draw),
  ];
  try {
    await insertWebSelection(
      api,
      {
        kind: "image",
        value: "data:image/png;base64,aW1hZ2U=",
        position: { x: 600, y: 360 },
      },
      new AbortController().signal,
    );
    expect(draw).toHaveBeenCalledWith(
      expect.objectContaining({
        shape: expect.objectContaining({
          x: 200,
          y: 415,
          width: 100,
          height: 50,
        }),
      }),
    );
  } finally {
    stops.reverse().forEach((stop) => stop());
    stage.remove();
  }
});
it("inserts long-pressed webpage text using the visible canvas text command", async () => {
  const api = sceneAPI();
  const release = registerCanvasCommands(api);
  try {
    await insertWebSelection(
      api,
      { kind: "text", value: "Newton's laws" },
      new AbortController().signal,
    );
    expect(
      api
        .getSceneElements()
        .some(
          (element) =>
            element.type === "text" && element.originalText === "Newton's laws",
        ),
    ).toBe(true);
  } finally {
    release();
  }
});
it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  "imports a webpage image into document=%s inline=%s while preserving other objects",
  async (document, inline) => {
    const api = sceneAPI();
    const before = [...api.getSceneElements()];
    vi.spyOn(CapacitorHttp, "get").mockResolvedValue({
      status: 200,
      headers: { "Content-Type": "image/png" },
      url: "https://images.example.test/item.png",
      data: "aW1hZ2U=",
    });
    vi.mocked(CapacitorHttp.get).mockClear();
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 800;
        naturalHeight = 600;
        src = "";
        decode = async () => {};
      },
    );
    const draw = vi.fn();
    const stops = document
      ? [
          classroomCommands.register("document.draw", "@internal", draw),
          classroomCommands.context("document.layout", () => ({
            viewport: { left: 100, top: 800 },
          })),
        ]
      : [];
    try {
      await insertWebSelection(
        api,
        {
          kind: "image",
          value: inline
            ? "data:image/png;base64,aW1hZ2U="
            : "https://images.example.test/item.png",
        },
        new AbortController().signal,
      );
      expect(CapacitorHttp.get).toHaveBeenCalledTimes(inline ? 0 : 1);
      if (document) {
        expect(draw).toHaveBeenCalledWith(
          expect.objectContaining({
            image: "data:image/png;base64,aW1hZ2U=",
            shape: expect.objectContaining({
              width: 800,
              height: 600,
              x: 120,
              y: 820,
            }),
          }),
        );
        expect(api.getSceneElements()).toEqual(before);
      } else {
        expect(api.setActiveTool).toHaveBeenCalledWith({ type: "lasso" });
        expect(api.updateScene).toHaveBeenLastCalledWith(
          expect.objectContaining({
            appState: expect.objectContaining({
              whiteboardSelection: expect.objectContaining({
                elementIds: expect.any(Array),
                bounds: expect.objectContaining({
                  left: expect.any(Number),
                  right: expect.any(Number),
                }),
              }),
            }),
          }),
        );
        expect(api.addFiles).toHaveBeenCalledWith([
          expect.objectContaining({
            dataURL: "data:image/png;base64,aW1hZ2U=",
          }),
        ]);
        expect(api.getSceneElements()).toHaveLength(before.length + 1);
      }
    } finally {
      stops.reverse().forEach((stop) => stop());
    }
  },
);
it.each([
  "data:text/html;base64,aW1hZ2U=",
  "file:///tmp/not-an-image.png",
  "blob:https://example.test/expired",
])(
  "rejects unconverted or non-image data %s without adding an object",
  async (value) => {
    const api = sceneAPI();
    const before = [...api.getSceneElements()];
    await expect(
      insertWebSelection(
        api,
        { kind: "image", value },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Invalid selected webpage image");
    expect(api.addFiles).not.toHaveBeenCalled();
    expect(api.getSceneElements()).toEqual(before);
  },
);
it("rejects a late image after a manual surface change", async () => {
  const api = sceneAPI();
  vi.spyOn(CapacitorHttp, "get").mockImplementation(async () => {
    classroomCommands.invalidate();
    return {
      status: 200,
      headers: { "content-type": "image/png" },
      url: "https://example.test/image",
      data: "aW1hZ2U=",
    };
  });
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 10;
      naturalHeight = 10;
      src = "";
      decode = async () => {};
    },
  );
  await expect(
    insertWebSelection(
      api,
      { kind: "image", value: "https://example.test/image" },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(api.addFiles).not.toHaveBeenCalled();
});

it("loads a protected webpage image with the browser's origin and user-agent", async () => {
  const api = sceneAPI();
  vi.mocked(CapacitorHttp.get).mockResolvedValue({
    status: 200,
    headers: { "content-type": "image/png" },
    url: "https://images.example.test/item.png",
    data: "aW1hZ2U=",
  });
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 800;
      naturalHeight = 600;
      src = "";
      decode = async () => {};
    },
  );
  await insertWebSelection(
    api,
    {
      kind: "image",
      value: "https://images.example.test/item.png",
      sourceUrl: "https://search.example.test/result?private=value",
      userAgent: "Board WebView",
    },
    new AbortController().signal,
  );
  expect(CapacitorHttp.get).toHaveBeenLastCalledWith(
    expect.objectContaining({
      headers: {
        Referer: "https://search.example.test/",
        "User-Agent": "Board WebView",
      },
    }),
  );
});

it("fits imported images to the native 940 physical pixels independently of board zoom and screen density", async () => {
  const api = sceneAPI();
  const getState = api.getAppState;
  api.getAppState = () => ({ ...getState(), zoom: { value: 1.5 as never } });
  vi.stubGlobal("devicePixelRatio", 2);
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 2000;
      naturalHeight = 1000;
      src = "";
      decode = async () => {};
    },
  );
  await insertWebSelection(
    api,
    { kind: "image", value: "data:image/png;base64,aW1hZ2U=" },
    new AbortController().signal,
  );
  const image = api
    .getSceneElements()
    .find((element) => element.type === "image")!;
  expect(image.width * 1.5 * 2).toBeCloseTo(940);
  expect(image.height * 1.5 * 2).toBeCloseTo(470);
});
