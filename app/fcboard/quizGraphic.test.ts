import { waitFor } from "@testing-library/react";

import { renderQuizGraphic } from "./quizGraphic";

const graphic = () => ({
  id: "figure",
  title: "Two lengths",
  html: '<html><body><svg width="600" height="400"><text x="10" y="30">AB = 3 cm</text><path d="M10 50h100" stroke="black"/></svg></body></html>',
});
const frame = () =>
  document.querySelector<HTMLIFrameElement>('iframe[title="Two lengths"]')!;
const channel = (node: HTMLIFrameElement) =>
  new DOMParser()
    .parseFromString(node.srcdoc, "text/html")
    .querySelector('[data-fc-library^="quiz-snapshot:"]')!
    .getAttribute("data-fc-library")!
    .slice("quiz-snapshot:".length);
const post = (
  node: HTMLIFrameElement,
  data: Record<string, unknown>,
  source = node.contentWindow,
) =>
  window.dispatchEvent(
    new MessageEvent("message", {
      source,
      data: { type: "quiz-graphic", channel: channel(node), ...data },
    }),
  );
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("accepts only the owning sandbox's completed PNG and releases its frame", async () => {
  const finished = vi.fn();
  const job = renderQuizGraphic(graphic(), new AbortController().signal).then(
    finished,
  );
  await waitFor(() => expect(frame()).not.toBeNull());
  const node = frame();
  expect(node).toHaveAttribute("sandbox", "allow-scripts");
  expect(node).toHaveAttribute("aria-hidden", "true");
  expect(node.style.width).toBe("720px");
  const document = new DOMParser().parseFromString(node.srcdoc, "text/html");
  expect(
    document
      .querySelector('meta[http-equiv="Content-Security-Policy"]')!
      .getAttribute("content"),
  ).not.toContain("unsafe-eval");
  post(node, { dataURL: "data:image/png;base64,YWJj" }, window);
  post(node, { channel: "other", dataURL: "data:image/png;base64,YWJj" });
  await Promise.resolve();
  expect(finished).not.toHaveBeenCalled();
  post(node, { dataURL: "data:image/png;base64,YWJj" });
  await job;
  expect(finished).toHaveBeenCalledWith("data:image/png;base64,YWJj");
  expect(frame()).toBeNull();
  expect(node.srcdoc).toBe("");
});

it.each([
  { error: "The exported figure is blank" },
  { dataURL: "https://untrusted.example/figure.png" },
  { dataURL: "data:image/svg+xml;base64,YWJj" },
])(
  "rejects actual export errors or unsupported image payloads and removes their frame: %s",
  async (message) => {
    const job = renderQuizGraphic(graphic(), new AbortController().signal);
    const rejected = expect(job).rejects.toThrow();
    await waitFor(() => expect(frame()).not.toBeNull());
    post(frame(), message);
    await rejected;
    expect(frame()).toBeNull();
  },
);

it("does not mount a late prepared resource after abort and cancels a currently drawing owner", async () => {
  const early = new AbortController();
  const first = renderQuizGraphic(graphic(), early.signal);
  early.abort(new Error("source removed"));
  await expect(first).rejects.toThrow("source removed");
  await Promise.resolve();
  expect(frame()).toBeNull();
  const running = new AbortController();
  const second = renderQuizGraphic(graphic(), running.signal);
  const rejected = expect(second).rejects.toThrow("cancel drawing");
  await waitFor(() => expect(frame()).not.toBeNull());
  running.abort(new Error("cancel drawing"));
  await rejected;
  expect(frame()).toBeNull();
});

it("bounds a drawing that never reports completion and frees its renderer", async () => {
  vi.useFakeTimers();
  const job = renderQuizGraphic(graphic(), new AbortController().signal);
  const rejected = expect(job).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(0);
  expect(frame()).not.toBeNull();
  await vi.advanceTimersByTimeAsync(12000);
  await rejected;
  expect(frame()).toBeNull();
});
