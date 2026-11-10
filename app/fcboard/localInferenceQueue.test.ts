beforeEach(() => vi.resetModules());
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

it("runs two regions concurrently, bounds active heaps and reuses a ready model", async () => {
  const { queueLocalInference } = await import("./localInferenceQueue");
  const gates = [deferred(), deferred()];
  const residents: { dispose: ReturnType<typeof vi.fn> }[] = [];
  const create = vi.fn(() => {
    const resident = { dispose: vi.fn() };
    residents.push(resident);
    return resident;
  });
  const started: number[] = [];
  const tasks = gates.map((gate, index) =>
    queueLocalInference("math", create, async () => {
      started.push(index);
      await gate.promise;
    }),
  );
  const third = queueLocalInference("math", create, async () => {
    started.push(2);
  });
  await flush();
  expect(started).toEqual([0, 1]);
  expect(create).toHaveBeenCalledTimes(2);
  gates[1].resolve();
  await flush();
  expect(started).toEqual([0, 1, 2]);
  expect(create).toHaveBeenCalledTimes(2);
  expect(residents.every((model) => !model.dispose.mock.calls.length)).toBe(
    true,
  );
  gates[0].resolve();
  await Promise.all([...tasks, third]);
});

it("skips cancelled queued work and evicts only an idle model", async () => {
  const { queueLocalInference } = await import("./localInferenceQueue");
  const gate = deferred();
  const active = { dispose: vi.fn() };
  const idle = { dispose: vi.fn() };
  const first = queueLocalInference(
    "math",
    () => active,
    () => gate.promise,
  );
  await queueLocalInference(
    "ocr",
    () => idle,
    async () => {},
  );
  await flush();
  const cancelled = vi.fn();
  await queueLocalInference(
    "translation:en:zh",
    vi.fn(),
    cancelled,
    () => false,
  );
  expect(cancelled).not.toHaveBeenCalled();
  expect(idle.dispose).not.toHaveBeenCalled();
  await queueLocalInference(
    "translation:en:zh",
    () => ({ dispose: vi.fn() }),
    async () => {},
  );
  expect(idle.dispose).toHaveBeenCalledTimes(1);
  expect(active.dispose).not.toHaveBeenCalled();
  gate.resolve();
  await first;
});

it("a failed slot cannot dispose another running region or block subsequent work", async () => {
  const { queueLocalInference } = await import("./localInferenceQueue");
  const gate = deferred();
  const active = { dispose: vi.fn() };
  const failed = { dispose: vi.fn() };
  const first = queueLocalInference(
    "math",
    () => active,
    () => gate.promise,
  );
  await expect(
    queueLocalInference(
      "ocr",
      () => failed,
      async () => {
        throw new Error("model unavailable");
      },
    ),
  ).rejects.toThrow("model unavailable");
  expect(failed.dispose).toHaveBeenCalledTimes(1);
  const next = vi.fn().mockResolvedValue(undefined);
  await queueLocalInference(
    "translation:en:zh",
    () => ({ dispose: vi.fn() }),
    next,
  );
  expect(next).toHaveBeenCalledTimes(1);
  expect(active.dispose).not.toHaveBeenCalled();
  gate.resolve();
  await first;
});
