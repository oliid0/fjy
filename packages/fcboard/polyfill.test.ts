import polyfill from "./polyfill";

const saved = [
  [AbortSignal.prototype, "reason"],
  [AbortSignal.prototype, "throwIfAborted"],
  [AbortSignal, "timeout"],
  [AbortController.prototype, "abort"],
].map(([target, key]) => ({
  target: target as object,
  key: key as string,
  descriptor: Object.getOwnPropertyDescriptor(target, key as string)!,
}));
afterEach(() => {
  for (const { target, key, descriptor } of saved) {
    if (descriptor) {
      Object.defineProperty(target, key, descriptor);
    } else {
      Reflect.deleteProperty(target, key);
    }
  }
  vi.useRealTimers();
});
const legacy = () => {
  for (const { target, key } of saved.slice(0, 3)) {
    Reflect.deleteProperty(target, key);
  }
  polyfill();
};
it("keeps native cancellation APIs intact", () => {
  polyfill();
  for (const { target, key, descriptor } of saved) {
    if (descriptor) {
      expect(Object.getOwnPropertyDescriptor(target, key)).toEqual(descriptor);
    }
  }
});
it("supports legacy WebView cancellation, including its first reason inside abort listeners", () => {
  legacy();
  const controller = new AbortController();
  expect(controller.signal.reason).toBeUndefined();
  expect(() => controller.signal.throwIfAborted()).not.toThrow();
  const reason = new Error("recognition cancelled");
  const listener = vi.fn(() => controller.signal.reason);
  controller.signal.addEventListener("abort", listener);
  controller.abort(reason);
  controller.abort(new Error("late cancellation"));
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener.mock.results[0].value).toBe(reason);
  expect(() => controller.signal.throwIfAborted()).toThrow(reason);
  expect(controller.signal.reason).toBe(reason);
  const empty = new AbortController();
  empty.abort();
  expect(empty.signal.reason.name).toBe("AbortError");
  const nullable = new AbortController();
  nullable.abort(null);
  expect(nullable.signal.reason).toBeNull();
});
it("times out legacy operations with a distinguishable TimeoutError", () => {
  vi.useFakeTimers();
  legacy();
  const signal = AbortSignal.timeout(700);
  vi.advanceTimersByTime(699);
  expect(signal.aborted).toBe(false);
  vi.advanceTimersByTime(1);
  expect(signal.aborted).toBe(true);
  expect(signal.reason.name).toBe("TimeoutError");
});
