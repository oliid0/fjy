import type { OfflineTask } from "./offlineInference";
class ModelWorker {
  static instances: ModelWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | undefined;
  onerror: (() => void) | undefined;
  onmessageerror: (() => void) | undefined;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    ModelWorker.instances.push(this);
  }
  complete(result: unknown) {
    this.onmessage?.({
      data: { id: this.postMessage.mock.calls[0][0].id, ok: true, result },
    });
  }
}
const task: OfflineTask = {
  kind: "translation",
  text: "hello",
  source: "en",
  target: "zh",
};
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  ModelWorker.instances = [];
  vi.stubGlobal("Worker", ModelWorker);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("aborting a queued local request cannot terminate another caller's inference", async () => {
  const { offlineInference } = await import("./offlineInference");
  const first = offlineInference(task, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(0);
  const worker = ModelWorker.instances[0];
  const controller = new AbortController();
  const second = offlineInference(task, controller.signal);
  const cancelled = expect(second).rejects.toThrow();
  controller.abort();
  await cancelled;
  expect(worker.terminate).not.toHaveBeenCalled();
  worker.complete([{ translation_text: "你好" }]);
  await expect(first).resolves.toEqual([{ translation_text: "你好" }]);
  await vi.advanceTimersByTimeAsync(15001);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
it("terminates hung local WASM and lets the next request use a fresh worker", async () => {
  const { offlineInference } = await import("./offlineInference");
  const first = offlineInference(task, new AbortController().signal);
  const failure = expect(first).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(45001);
  await failure;
  expect(ModelWorker.instances[0].terminate).toHaveBeenCalled();
  const second = offlineInference(task, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(0);
  expect(ModelWorker.instances).toHaveLength(2);
  ModelWorker.instances[1].complete([{ translation_text: "你好" }]);
  await expect(second).resolves.toEqual([{ translation_text: "你好" }]);
});
