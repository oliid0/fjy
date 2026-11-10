beforeEach(() => vi.resetModules());

it("finishes OCR before releasing its heap and starting math, then releases math before translation", async () => {
  const { queueLocalInference } = await import("./localInferenceQueue");
  const events: string[] = [];
  let finish!: () => void;
  const ocr = queueLocalInference(
    "ocr",
    () => events.push("release OCR"),
    async () => {
      events.push("start OCR");
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      events.push("finish OCR");
    },
  );
  const math = queueLocalInference(
    "math",
    () => events.push("release math"),
    async () => {
      events.push("start math");
    },
  );
  const translation = queueLocalInference(
    "translation:en:zh",
    vi.fn(),
    async () => {
      events.push("start translation");
    },
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(events).toEqual(["start OCR"]);
  finish();
  await Promise.all([ocr, math, translation]);
  expect(events).toEqual([
    "start OCR",
    "finish OCR",
    "release OCR",
    "start math",
    "release math",
    "start translation",
  ]);
});

it("reuses the same model for consecutive requests and skips an invalidated request before switching heaps", async () => {
  const { queueLocalInference } = await import("./localInferenceQueue");
  const release = vi.fn();
  const cancelled = vi.fn();
  await queueLocalInference("math", release, async () => {});
  await queueLocalInference("ocr", vi.fn(), cancelled, () => false);
  await queueLocalInference("math", release, async () => {});
  expect(release).not.toHaveBeenCalled();
  expect(cancelled).not.toHaveBeenCalled();
  await queueLocalInference("translation:en:zh", vi.fn(), async () => {});
  expect(release).toHaveBeenCalledTimes(1);
});

it("allows another model to run after initialization fails", async () => {
  const { queueLocalInference } = await import("./localInferenceQueue");
  const release = vi.fn();
  const next = vi.fn().mockResolvedValue(undefined);
  await expect(
    queueLocalInference("ocr", release, async () => {
      throw new Error("model unavailable");
    }),
  ).rejects.toThrow("model unavailable");
  await queueLocalInference("math", vi.fn(), next);
  expect(release).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenCalledTimes(1);
});
