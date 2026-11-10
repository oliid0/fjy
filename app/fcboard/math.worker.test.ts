const channel = {
  onmessage: undefined as ((event: MessageEvent) => Promise<void>) | undefined,
  postMessage: vi.fn(),
};

beforeAll(async () => {
  vi.stubGlobal("self", channel);
  await import("./math.worker");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => channel.postMessage.mockClear());

it.each([
  [{ expression: "sin30°" }, "1/2"],
  [{ expression: "cos90°" }, "0"],
  [{ expression: "log_3(9)" }, "2"],
  [{ expression: "2^sqrt(4)" }, "4"],
  [{ expression: "permutations(6,2)" }, "30"],
  [{ expression: "std([1,2,3])" }, "1"],
  [{ expression: "diff(x^2,x)" }, "2*x"],
  [{ expression: "det([1,2;3,4])" }, "-2"],
  [{ latex: String.raw`\frac{1}{\sqrt{4}}` }, "1/2"],
])("calculates through the real worker handler: %j", async (data, answer) => {
  await channel.onmessage!({ data } as MessageEvent);
  expect(channel.postMessage).toHaveBeenCalledWith({ answer });
});

it.each([
  { expression: "tan90°" },
  { expression: "2^(2^1000)" },
  { latex: String.raw`\frac{1}{}` },
  { latex: String.raw`\int_0^1 \frac{1}{x}\,dx` },
])("returns a failure without a guessed answer for %j", async (data) => {
  await channel.onmessage!({ data } as MessageEvent);
  expect(channel.postMessage).toHaveBeenCalledWith({
    error: expect.any(String),
  });
});
