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

it.each(["12÷3=", "12/3=", "12∕3=", String.raw`12\div3=`])(
  "evaluates handwritten division locally as %s",
  async (input) => {
    const { create } = worker();
    await expect(calculateAsync(input)).resolves.toBe("4");
    expect(create).not.toHaveBeenCalled();
  },
);

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

it("sends unflattened LaTeX and nontrivial scientific work to the worker", async () => {
  const { instance, create } = worker();
  const result = calculateAsync(String.raw`\sin(30^\circ)=`);
  expect(instance.postMessage).toHaveBeenCalledWith({
    latex: String.raw`\sin(30^\circ)`,
  });
  instance.onmessage?.({ data: { answer: "1/2" } } as MessageEvent);
  expect(await result).toBe("1/2");
  const next = calculateAsync("sin30°");
  expect(create).toHaveBeenCalledTimes(2);
  expect(instance.postMessage.mock.calls[1][0]).toHaveProperty("expression");
  instance.onmessage?.({ data: { answer: "1/2" } } as MessageEvent);
  expect(await next).toBe("1/2");
});

it("preserves the structural division token in a fraction expression", async () => {
  const { instance } = worker();
  const result = calculateAsync(String.raw`\frac{12}{2}÷3`);
  expect(instance.postMessage).toHaveBeenCalledWith({
    latex: String.raw`\frac{12}{2}\div 3`,
  });
  instance.onmessage?.({ data: { answer: "2" } } as MessageEvent);
  await expect(result).resolves.toBe("2");
});

it("cleans up a failed worker submission immediately", async () => {
  vi.useFakeTimers();
  const { instance } = worker();
  instance.postMessage.mockImplementation(() => {
    throw new Error("Worker unavailable");
  });
  await expect(calculateAsync(String.raw`\sqrt{2}`)).rejects.toThrow(
    "Worker unavailable",
  );
  expect(instance.terminate).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("finishes another symbolic expression while the first stalls, then cancels only the removed first source", async () => {
  vi.useFakeTimers();
  const instances: ReturnType<typeof worker>["instance"][] = [];
  vi.stubGlobal(
    "Worker",
    vi.fn(() => {
      const instance = {
        onmessage: undefined,
        onerror: undefined,
        postMessage: vi.fn(),
        terminate: vi.fn(),
      };
      instances.push(instance);
      return instance;
    }),
  );
  const source = new AbortController();
  const first = calculateAsync("integrate(sin(x),x)", source.signal);
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  const second = calculateAsync("diff(x^2,x)");
  expect(instances).toHaveLength(2);
  instances[1].onmessage?.({ data: { answer: "2*x" } } as MessageEvent);
  await expect(second).resolves.toBe("2*x");
  expect(instances[0].terminate).not.toHaveBeenCalled();
  source.abort();
  await rejected;
  expect(instances[0].terminate).toHaveBeenCalledTimes(1);
  expect(instances[1].terminate).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
