import { calculateAsync } from "./mathComputation";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const worker = () => {
  const instance = {
    onmessage: undefined as ((event: MessageEvent) => void) | undefined,
    onerror: undefined as (() => void) | undefined,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
  const create = vi.fn(() => {
    return instance;
  });
  vi.stubGlobal("Worker", create);
  return { instance, create };
};

it("keeps bounded numerical arithmetic local and runs symbolic work in a module worker", async () => {
  const { instance, create } = worker();
  expect(await calculateAsync("0.1+0.2")).toBe("0.3");
  expect(create).not.toHaveBeenCalled();
  const answer = calculateAsync("diff(x^2,x)");
  expect(create).toHaveBeenCalledWith(expect.any(URL), { type: "module" });
  expect(instance.postMessage).toHaveBeenCalledWith({
    expression: "diff(x^2,x)",
  });
  instance.onmessage?.({ data: { answer: "2*x" } } as MessageEvent);
  expect(await answer).toBe("2*x");
  expect(instance.terminate).toHaveBeenCalledTimes(1);
});

it("terminates a stalled solver and rejects instead of freezing or writing an answer", async () => {
  vi.useFakeTimers();
  const { instance } = worker();
  const result = calculateAsync("limit(sin(x)/x,x,0)");
  const rejected = expect(result).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(6000);
  await rejected;
  expect(instance.terminate).toHaveBeenCalledTimes(1);
});

it("terminates immediately on source cancellation and ignores a late response", async () => {
  const { instance } = worker();
  const controller = new AbortController();
  const result = calculateAsync("integrate(x,x)", controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  expect(instance.terminate).toHaveBeenCalledTimes(1);
  instance.onmessage?.({ data: { answer: "late answer" } } as MessageEvent);
});

it("does not fall back to synchronous symbolic execution when workers are unavailable", async () => {
  vi.stubGlobal("Worker", undefined);
  await expect(calculateAsync("diff(x^2,x)")).rejects.toThrow();
});
