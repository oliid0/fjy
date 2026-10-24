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
