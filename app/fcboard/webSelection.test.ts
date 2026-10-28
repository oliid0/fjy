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
it.each([false, true])(
  "imports a real webpage image into document=%s while preserving other objects",
  async (document) => {
    const api = sceneAPI();
    const before = [...api.getSceneElements()];
    vi.spyOn(CapacitorHttp, "get").mockResolvedValue({
      status: 200,
      headers: { "Content-Type": "image/png" },
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
        { kind: "image", value: "https://images.example.test/item.png" },
        new AbortController().signal,
      );
      if (document) {
        expect(draw).toHaveBeenCalledWith(
          expect.objectContaining({
            image: "data:image/png;base64,aW1hZ2U=",
            shape: expect.objectContaining({
              width: 400,
              height: 300,
              x: 120,
              y: 820,
            }),
          }),
        );
        expect(api.getSceneElements()).toEqual(before);
      } else {
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
