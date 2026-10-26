import { createVoiceTurns } from "./voiceTurns";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("waits for three seconds without new text and keeps accepting short commands", async () => {
  const execute = vi.fn().mockResolvedValue(undefined);
  const turns = createVoiceTurns(execute, vi.fn());
  turns.push("write");
  await vi.advanceTimersByTimeAsync(2000);
  turns.push("1+1=2");
  await vi.advanceTimersByTimeAsync(2999);
  expect(execute).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(execute).toHaveBeenCalledWith("write 1+1=2", expect.any(AbortSignal));
  turns.push("擦除");
  await vi.advanceTimersByTimeAsync(3000);
  expect(execute).toHaveBeenLastCalledWith("擦除", expect.any(AbortSignal));
  turns.stop();
});

it("queues later commands in order and continues after a failure", async () => {
  let fail!: (failure: Error) => void;
  const execute = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject;
        }),
    )
    .mockResolvedValue(undefined);
  const error = vi.fn();
  const turns = createVoiceTurns(execute, error);
  turns.push("first");
  await vi.advanceTimersByTimeAsync(3000);
  turns.push("second");
  await vi.advanceTimersByTimeAsync(3000);
  expect(execute).toHaveBeenCalledTimes(1);
  fail(new Error("offline"));
  await vi.advanceTimersByTimeAsync(0);
  expect(error).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls.map(([text]) => text)).toEqual(["first", "second"]);
  turns.stop();
});

it("waits for ongoing interim speech without executing or committing its unstable text", async () => {
  const execute = vi.fn().mockResolvedValue(undefined);
  const turns = createVoiceTurns(execute, vi.fn());
  turns.push("写一个");
  await vi.advanceTimersByTimeAsync(2500);
  turns.activity();
  await vi.advanceTimersByTimeAsync(2500);
  expect(execute).not.toHaveBeenCalled();
  turns.push("1+1=2");
  await vi.advanceTimersByTimeAsync(3000);
  expect(execute).toHaveBeenCalledWith("写一个 1+1=2", expect.any(AbortSignal));
  turns.stop();
});

it("aborts old page requests and drops queued fragments without blocking new page speech", async () => {
  let fail!: (failure: Error) => void;
  const execute = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject;
        }),
    )
    .mockResolvedValue(undefined);
  const error = vi.fn();
  const turns = createVoiceTurns(execute, error);
  turns.push("running");
  await vi.advanceTimersByTimeAsync(3000);
  const signal = execute.mock.calls[0][1] as AbortSignal;
  turns.push("queued");
  await vi.advanceTimersByTimeAsync(3000);
  turns.push("incomplete");
  turns.reset();
  expect(signal.aborted).toBe(true);
  turns.push("new page");
  await vi.advanceTimersByTimeAsync(3000);
  fail(new Error("late result"));
  await vi.advanceTimersByTimeAsync(0);
  expect(execute.mock.calls.map(([text]) => text)).toEqual([
    "running",
    "new page",
  ]);
  expect(error).not.toHaveBeenCalled();
  turns.stop();
});

it("drops pending fragments and late recognition after stopping", async () => {
  const execute = vi.fn().mockResolvedValue(undefined);
  const turns = createVoiceTurns(execute, vi.fn());
  turns.push("pending");
  turns.stop();
  turns.push("late");
  await vi.advanceTimersByTimeAsync(3000);
  expect(execute).not.toHaveBeenCalled();
});

it("interrupts an unfinished assistant request on the next confirmed utterance without losing its later fragments", async () => {
  let finish!: () => void;
  const execute = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const interrupted = vi.fn();
  const errors = vi.fn();
  const turns = createVoiceTurns(execute, errors, 3000, {
    interrupt: true,
    onInterruption: interrupted,
  });
  turns.push("first");
  await vi.advanceTimersByTimeAsync(3000);
  const firstSignal = execute.mock.calls[0][1] as AbortSignal;
  turns.activity();
  expect(firstSignal.aborted).toBe(false);
  turns.push("write");
  expect(firstSignal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(2000);
  turns.push("2");
  await vi.advanceTimersByTimeAsync(3000);
  expect(execute.mock.calls.map(([text]) => text)).toEqual([
    "first",
    "write 2",
  ]);
  expect(interrupted).toHaveBeenCalledTimes(2);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(errors).not.toHaveBeenCalled();
  turns.stop();
});

it("executes an explicit stop immediately and discards fragments from an abandoned utterance", async () => {
  const execute = vi.fn().mockResolvedValue(undefined);
  const turns = createVoiceTurns(execute, vi.fn(), 3000, {
    interrupt: true,
    immediate: (text) => text === "stop",
  });
  turns.push("please draw");
  await vi.advanceTimersByTimeAsync(500);
  turns.push("stop");
  await vi.advanceTimersByTimeAsync(0);
  expect(execute.mock.calls.map(([text]) => text)).toEqual(["stop"]);
  turns.push("write 3");
  await vi.advanceTimersByTimeAsync(3000);
  expect(execute.mock.calls.map(([text]) => text)).toEqual(["stop", "write 3"]);
  turns.stop();
});
