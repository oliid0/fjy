beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
it("shares one data load, looks up real terms exactly once and never translates bare numbers", async () => {
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ version: 1, entries: { hello: "喂", yes: "是" } }),
  });
  vi.stubGlobal("fetch", fetcher);
  const { lookupLocalWord } = await import("./localDictionary");
  const signal = new AbortController().signal;
  expect(await lookupLocalWord("1.2", signal)).toBe("1.2");
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    await Promise.all([
      lookupLocalWord("Hello", signal),
      lookupLocalWord("yes", signal),
    ]),
  ).toEqual(["喂", "是"]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await lookupLocalWord("unknownword", signal)).toBeUndefined();
});
it("aborts only the caller while another request can use the shared loaded data", async () => {
  let finish!: (value: unknown) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const { lookupLocalWord } = await import("./localDictionary");
  const controller = new AbortController();
  const cancelled = lookupLocalWord("hello", controller.signal);
  const other = lookupLocalWord("hello", new AbortController().signal);
  const rejected = expect(cancelled).rejects.toMatchObject({
    name: "AbortError",
  });
  controller.abort();
  await rejected;
  finish({
    ok: true,
    json: async () => ({ version: 1, entries: { hello: "喂" } }),
  });
  expect(await other).toBe("喂");
});
