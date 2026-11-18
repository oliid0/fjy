import { ownedRequest } from "./ownedRequest";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("settles and releases a cancelled caller even when its own backend never settles", async () => {
  const parent = new AbortController();
  const stop = vi.fn();
  const task = ownedRequest(
    parent.signal,
    () => true,
    () => [stop],
  );
  let finish!: (answer: string) => void;
  const result = task.run(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  parent.abort();
  await rejected;
  expect(task.signal.aborted).toBe(true);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  finish("late answer");
  await Promise.resolve();
});

it("cancels only the deleted source while an independent task completes first", async () => {
  let firstCurrent = true;
  let check!: () => void;
  const first = ownedRequest(
    undefined,
    () => firstCurrent,
    (listener) => {
      check = listener;
      return [vi.fn()];
    },
  );
  const second = ownedRequest(
    undefined,
    () => true,
    () => [vi.fn()],
  );
  const stalled = first.run(() => new Promise<string>(() => {}));
  const rejected = expect(stalled).rejects.toMatchObject({
    name: "AbortError",
  });
  await expect(second.run(async () => "second answer")).resolves.toBe(
    "second answer",
  );
  expect(first.signal.aborted).toBe(false);
  firstCurrent = false;
  check();
  await rejected;
  expect(second.signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds an uncooperative request and does not start already cancelled work", async () => {
  const stop = vi.fn();
  const task = ownedRequest(
    undefined,
    () => true,
    () => [stop],
  );
  const pending = task.run(() => new Promise<string>(() => {}));
  const rejected = expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(30000);
  await rejected;
  expect(stop).toHaveBeenCalledTimes(1);
  const parent = new AbortController();
  parent.abort();
  const cancelled = ownedRequest(
    parent.signal,
    () => true,
    () => [vi.fn()],
  );
  const work = vi.fn();
  await expect(cancelled.run(work)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(work).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
