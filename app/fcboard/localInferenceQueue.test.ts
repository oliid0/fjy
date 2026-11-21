beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
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

it("bounds concurrent heaps to two and reuses a completed caller while another is blocked", async () => {
  const { queueLocalInference, LOCAL_MODEL_IDLE_MS } = await import(
    "./localInferenceQueue"
  );
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
  await vi.advanceTimersByTimeAsync(LOCAL_MODEL_IDLE_MS);
  expect(
    residents.every((model) => model.dispose.mock.calls.length === 1),
  ).toBe(true);
});

it("skips cancelled work and trims idle models without unloading a running caller", async () => {
  const { queueLocalInference, trimLocalInference } = await import(
    "./localInferenceQueue"
  );
  const gate = deferred();
  const active = { dispose: vi.fn() };
  const idle = { dispose: vi.fn() };
  const next = { dispose: vi.fn() };
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
  const cancelled = vi.fn();
  await queueLocalInference("translation", vi.fn(), cancelled, () => false);
  expect(cancelled).not.toHaveBeenCalled();
  expect(idle.dispose).not.toHaveBeenCalled();
  await queueLocalInference(
    "translation",
    () => next,
    async () => {},
  );
  expect(idle.dispose).toHaveBeenCalledTimes(1);
  trimLocalInference();
  expect(next.dispose).toHaveBeenCalledTimes(1);
  expect(active.dispose).not.toHaveBeenCalled();
  gate.resolve();
  await first;
  expect(active.dispose).toHaveBeenCalledTimes(1);
});

it("a failed slot cannot dispose another running region or block later work", async () => {
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
  await queueLocalInference("translation", () => ({ dispose: vi.fn() }), next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(active.dispose).not.toHaveBeenCalled();
  gate.resolve();
  await first;
});

it("recovers a slot after creation or disposal fails", async () => {
  const { queueLocalInference } = await import("./localInferenceQueue");
  const gate = deferred();
  const active = { dispose: vi.fn() };
  const first = queueLocalInference(
    "math",
    () => active,
    () => gate.promise,
  );
  await expect(
    queueLocalInference(
      "ocr",
      () => {
        throw new Error("load failed");
      },
      async () => {},
    ),
  ).rejects.toThrow("load failed");
  const broken = {
    dispose: vi.fn(() => {
      throw new Error("release failed");
    }),
  };
  await expect(
    queueLocalInference(
      "ocr",
      () => broken,
      async () => {
        throw new Error("inference failed");
      },
    ),
  ).rejects.toThrow("release failed");
  const next = vi.fn().mockResolvedValue(undefined);
  await queueLocalInference("translation", () => ({ dispose: vi.fn() }), next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(active.dispose).not.toHaveBeenCalled();
  gate.resolve();
  await first;
});

it("new ink extends idle lifetime without starting inference or initializing again", async () => {
  const {
    queueLocalInference,
    noteLocalInferenceActivity,
    LOCAL_MODEL_IDLE_MS,
  } = await import("./localInferenceQueue");
  const model = { dispose: vi.fn() };
  const create = vi.fn(() => model);
  const run = vi.fn().mockResolvedValue(undefined);
  await queueLocalInference("ocr:zh", create, run);
  await vi.advanceTimersByTimeAsync(LOCAL_MODEL_IDLE_MS - 1);
  noteLocalInferenceActivity();
  await vi.advanceTimersByTimeAsync(LOCAL_MODEL_IDLE_MS - 1);
  expect(model.dispose).not.toHaveBeenCalled();
  expect(run).toHaveBeenCalledTimes(1);
  await queueLocalInference("ocr:zh", create, run);
  expect(create).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(LOCAL_MODEL_IDLE_MS);
  expect(model.dispose).toHaveBeenCalledTimes(1);
});

it("alternating languages evict only the least recently used idle model", async () => {
  const { queueLocalInference } = await import("./localInferenceQueue");
  const zh = { dispose: vi.fn() };
  const en = { dispose: vi.fn() };
  const de = { dispose: vi.fn() };
  const chinese = vi.fn(() => zh);
  const english = vi.fn(() => en);
  await queueLocalInference("zh", chinese, async () => {});
  await vi.advanceTimersByTimeAsync(1);
  await queueLocalInference("en", english, async () => {});
  await vi.advanceTimersByTimeAsync(1);
  await queueLocalInference("zh", chinese, async () => {});
  await queueLocalInference(
    "de",
    () => de,
    async () => {},
  );
  expect(chinese).toHaveBeenCalledTimes(1);
  expect(en.dispose).toHaveBeenCalledTimes(1);
  expect(zh.dispose).not.toHaveBeenCalled();
});
