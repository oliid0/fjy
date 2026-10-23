import { preferredRace } from "./preferredRace";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  return {
    promise: new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    }),
    resolve,
    reject,
  };
};

describe("cloud preference with concurrent fallback", () => {
  afterEach(() => vi.useRealTimers());
  it("starts both backends and prefers cloud within the short grace period", async () => {
    vi.useFakeTimers();
    const cloud = deferred<string>();
    let localSignal!: AbortSignal;
    const primary = vi.fn(() => cloud.promise);
    const fallback = vi.fn(async (signal: AbortSignal) => {
      localSignal = signal;
      return "local";
    });
    const result = preferredRace(
      primary,
      fallback,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
    cloud.resolve("cloud");
    expect(await result).toBe("cloud");
    expect(localSignal.aborted).toBe(true);
  });
  it("uses a ready local answer after 250ms rather than waiting for a slow cloud", async () => {
    vi.useFakeTimers();
    let cloudSignal!: AbortSignal;
    const result = preferredRace(
      (signal) => {
        cloudSignal = signal;
        return new Promise<string>(() => {});
      },
      async () => "2",
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(250);
    expect(await result).toBe("2");
    expect(cloudSignal.aborted).toBe(true);
  });
  it("does not wait for the grace timer after the primary fails", async () => {
    vi.useFakeTimers();
    const result = preferredRace(
      async () => {
        throw new Error("offline");
      },
      async () => "2",
      new AbortController().signal,
    );
    expect(await result).toBe("2");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps waiting for cloud if the fallback rejects invalid recognition", async () => {
    vi.useFakeTimers();
    const cloud = deferred<string>();
    const result = preferredRace(
      () => cloud.promise,
      async () => {
        throw new Error("invalid expression");
      },
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(300);
    cloud.resolve("1+1=");
    expect(await result).toBe("1+1=");
  });
  it("cancels both workers and ignores results after a selection change", async () => {
    const controller = new AbortController();
    const cloud = deferred<string>();
    const local = deferred<string>();
    const signals: AbortSignal[] = [];
    const result = preferredRace(
      (signal) => {
        signals.push(signal);
        return cloud.promise;
      },
      (signal) => {
        signals.push(signal);
        return local.promise;
      },
      controller.signal,
    );
    await Promise.resolve();
    const assertion = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await assertion;
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    cloud.resolve("late");
    local.resolve("late");
  });
});
