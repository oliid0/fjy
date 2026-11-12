import { inferNatively } from "./nativeInference";
import { recognizeLocalMath } from "./localMathOcr";
import { offlineInference } from "./offlineInference";

const native = vi.hoisted(() => ({ infer: vi.fn(), cancel: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" },
  registerPlugin: () => native,
}));
vi.mock("./offlineInference", () => ({ offlineInference: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  native.cancel.mockResolvedValue(undefined);
});
it("recognizes native structured math using only original coordinates, with no tensor/raster/worker", async () => {
  native.infer.mockResolvedValue({ latex: String.raw`\frac { 1 } { 2 }` });
  const strokes: [number, number][][] = [
    [
      [100000, 500],
      [100050, 540],
    ],
  ];
  await expect(
    recognizeLocalMath(strokes, new AbortController().signal),
  ).resolves.toBe(String.raw`\frac{1}{2}`);
  expect(native.infer).toHaveBeenCalledWith({
    id: expect.any(String),
    kind: "math",
    strokes,
  });
  expect(offlineInference).not.toHaveBeenCalled();
});
it("cancels its own process request immediately and discards the late result", async () => {
  let finish!: (value: { latex: string }) => void;
  native.infer.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const result = inferNatively(
    { kind: "math", strokes: [[[0, 0]]] },
    controller.signal,
  );
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  expect(native.cancel).toHaveBeenCalledWith({
    id: native.infer.mock.calls[0][0].id,
  });
  finish({ latex: "late" });
  await Promise.resolve();
  expect(offlineInference).not.toHaveBeenCalled();
});
it("surfaces native failure and rejects corrupt math instead of launching a web model", async () => {
  native.infer.mockRejectedValueOnce(new Error("process lost"));
  await expect(
    recognizeLocalMath([[[0, 0]]], new AbortController().signal),
  ).rejects.toThrow("process lost");
  native.infer.mockResolvedValueOnce({ latex: "" });
  await expect(
    recognizeLocalMath([[[0, 0]]], new AbortController().signal),
  ).rejects.toThrow("Unreadable math ink");
  expect(offlineInference).not.toHaveBeenCalled();
});
