import { generateQuizImage } from "./quizRequests";
import * as ai from "./ai";
import * as images from "./imageGeneration";
import * as graphics from "./quizGraphic";
import { quizFigureResource, validateQuizFigure } from "./quizFigure";

import type { QuizQuestion } from "./quiz";

const question = (): QuizQuestion => ({
  type: "calculation",
  question: "三角形AB=3，BC=4，AC=?",
  answer: ["5"],
  image: {
    method: "draw",
    status: "pending",
    caption: "三角形ABC",
    spec: {
      mode: "jsxgraph",
      boundingbox: [-1, 5, 5, -1],
      elements: [
        { id: "A", type: "point", parents: [0, 0] },
        { id: "B", type: "point", parents: [3, 0] },
        { id: "C", type: "point", parents: [3, 4] },
        { id: "triangle", type: "polygon", parents: ["A", "B", "C"] },
      ],
    },
  },
});
afterEach(() => vi.restoreAllMocks());
it("renders same-response diagram JSON locally without a model or generated image request", async () => {
  const chat = vi.spyOn(ai, "chat");
  const image = vi.spyOn(images, "generateImage");
  const render = vi
    .spyOn(graphics, "renderQuizGraphic")
    .mockResolvedValue("data:image/png;base64,YWJj");
  const value = question();
  expect(await generateQuizImage(value, new AbortController().signal)).toBe(
    "data:image/png;base64,YWJj",
  );
  expect(render.mock.calls[0][0]).toMatchObject({ libraries: ["jsxgraph"] });
  expect(render.mock.calls[0][0].html).toContain('"parents":["A","B","C"]');
  expect(chat).not.toHaveBeenCalled();
  expect(image).not.toHaveBeenCalled();
});
it("reports local rendering errors immediately and retries only local rendering", async () => {
  const render = vi
    .spyOn(graphics, "renderQuizGraphic")
    .mockRejectedValueOnce(new Error("invalid geometry"))
    .mockResolvedValueOnce("data:image/png;base64,YWJj");
  const value = question();
  await expect(
    generateQuizImage(value, new AbortController().signal),
  ).rejects.toThrow("invalid geometry");
  await expect(
    generateQuizImage(value, new AbortController().signal),
  ).resolves.toContain("data:image/png");
  expect(render).toHaveBeenCalledTimes(2);
});
it("rejects an invalid geometry spec before rendering and escapes text as JSON", async () => {
  const value = question().image!.spec;
  expect(() => validateQuizFigure({ ...value, mode: "generate" })).toThrow();
  expect(() =>
    validateQuizFigure({ ...value, boundingbox: [0, 0, 0, 0] }),
  ).toThrow();
  expect(
    (
      await quizFigureResource(
        {
          ...value,
          elements: [
            {
              id: "label",
              type: "text",
              parents: [0, 0, "</script><script>alert(1)</script>"],
            },
          ],
        },
        "safe",
      )
    ).html,
  ).not.toContain("</script><script>");
});
it("cancels before opening any graphic frame", async () => {
  const render = vi.spyOn(graphics, "renderQuizGraphic");
  const controller = new AbortController();
  controller.abort();
  await expect(
    generateQuizImage(question(), controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(render).not.toHaveBeenCalled();
});
