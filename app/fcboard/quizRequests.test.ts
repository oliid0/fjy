import { waitFor } from "@testing-library/react";

import { generateQuizImage, quizRequest } from "./quizRequests";
import * as ai from "./ai";
import * as images from "./imageGeneration";
import * as graphics from "./quizGraphic";
import { generatedResources } from "./generatedResources";

import type { QuizQuestion } from "./quiz";

afterEach(() => vi.restoreAllMocks());

it("keeps ten actual in-flight slots on abort, removes queued aborts and prioritizes pending text over pictures", async () => {
  const controllers = Array.from({ length: 10 }, () => new AbortController());
  const finish: (() => void)[] = [];
  const held = controllers.map((controller) =>
    quizRequest(
      controller.signal,
      () =>
        new Promise<void>((resolve) => {
          finish.push(resolve);
        }),
    ),
  );
  const order: string[] = [];
  const image = quizRequest(
    new AbortController().signal,
    async () => {
      order.push("image");
    },
    1,
  );
  const text = quizRequest(new AbortController().signal, async () => {
    order.push("text");
  });
  const cancelled = new AbortController();
  const runCancelled = vi.fn();
  const queued = quizRequest(cancelled.signal, runCancelled).catch(
    (failure) => failure,
  );
  try {
    await waitFor(() => expect(finish).toHaveLength(10));
    controllers[0].abort();
    cancelled.abort();
    await queued;
    expect(runCancelled).not.toHaveBeenCalled();
    expect(order).toEqual([]);
    finish[0]();
    await text;
    expect(order[0]).toBe("text");
    await image;
    expect(order).toEqual(["text", "image"]);
  } finally {
    finish.forEach((release) => release());
    await Promise.all(held);
  }
});

const question = (): QuizQuestion => ({
  id: "apple-question",
  type: "calculation",
  question: "如图，两个苹果共重200g，平均每个多重？",
  answer: ["100g"],
  explanation: "200/2=100",
  image: {
    method: "generate" as const,
    prompt:
      "Exactly two apples; a label says total 200g, do not disclose each weight",
    caption: "两个苹果共重200g",
    status: "pending",
  },
});

it("retries a semantically wrong picture using actual visual feedback before publishing the corrected image", async () => {
  const generate = vi
    .spyOn(images, "generateImage")
    .mockResolvedValueOnce({
      dataURL: "data:image/png;base64,d3Jvbmc=",
      mimeType: "image/png",
      width: 100,
      height: 100,
    })
    .mockResolvedValueOnce({
      dataURL: "data:image/png;base64,Y29ycmVjdA==",
      mimeType: "image/png",
      width: 100,
      height: 100,
    });
  const chat = vi
    .spyOn(ai, "chat")
    .mockResolvedValueOnce(
      JSON.stringify({
        valid: false,
        issues: "The picture has three apples; it must have exactly two.",
      }),
    )
    .mockResolvedValueOnce(JSON.stringify({ valid: true, issues: "" }));
  const result = await generateQuizImage(
    question(),
    new AbortController().signal,
  );
  expect(result).toBe("data:image/png;base64,Y29ycmVjdA==");
  expect(generate.mock.calls[1][0]).toContain("The picture has three apples");
  expect(JSON.stringify(chat.mock.calls[0][0])).toContain(
    "data:image/png;base64,d3Jvbmc=",
  );
  expect(JSON.stringify(chat.mock.calls[1][0])).toContain(
    "data:image/png;base64,Y29ycmVjdA==",
  );
});

it("never publishes a second inconsistent picture or retries indefinitely", async () => {
  const generate = vi.spyOn(images, "generateImage").mockResolvedValue({
    dataURL: "data:image/png;base64,d3Jvbmc=",
    mimeType: "image/png",
    width: 100,
    height: 100,
  });
  vi.spyOn(ai, "chat").mockResolvedValue(
    JSON.stringify({
      valid: false,
      issues: "Missing the required total weight label.",
    }),
  );
  await expect(
    generateQuizImage(question(), new AbortController().signal),
  ).rejects.toThrow("Missing the required total weight label.");
  expect(generate).toHaveBeenCalledTimes(2);
});

const triangle = (title = "Triangle") =>
  JSON.stringify({
    title,
    libraries: ["jsxgraph"],
    html: `<html><head><title>Triangle</title></head><body><div id="board" data-fc-graphics style="width:600px;height:400px"></div><script>
  var b=JXG.JSXGraph.initBoard('board',{renderer:'svg',boundingbox:[-1,5,5,-1],showNavigation:false,showCopyright:false});
  var A=b.create('point',[0,0],{name:'A'}),B=b.create('point',[3,0],{name:'B'}),C=b.create('point',[3,4],{name:'C'});
  b.create('polygon',[A,B,C],{fillOpacity:0});b.create('text',[1,-0.4,'3 cm']);b.create('text',[3.1,2,'4 cm']);
  document.dispatchEvent(new Event('fc-figure-ready'));</script></body></html>`,
  });
const drawing = (): QuizQuestion => ({
  ...question(),
  question: "如图，直角三角形AB=3cm，BC=4cm，求AC。",
  answer: ["5cm"],
  explanation: "AC²=3²+4²=25。",
  image: {
    method: "draw",
    engines: { required: ["jsxgraph"], excluded: [] },
    prompt:
      "A=(0,0), B=(3,0), C=(3,4); AB 3cm, BC 4cm, AC unknown, no answer disclosure",
    caption: "直角三角形ABC",
    status: "pending",
  },
});

it("renders the requested engine resource and visually retries its actual pixels without image API or library persistence", async () => {
  const before = await generatedResources();
  const provider = vi.spyOn(images, "generateImage");
  const render = vi
    .spyOn(graphics, "renderQuizGraphic")
    .mockResolvedValueOnce("data:image/png;base64,Zmlyc3Q=")
    .mockResolvedValueOnce("data:image/png;base64,c2Vjb25k");
  const chat = vi
    .spyOn(ai, "chat")
    .mockResolvedValueOnce(triangle())
    .mockResolvedValueOnce(
      JSON.stringify({
        valid: false,
        issues: "The BC label is missing its 4 cm value.",
      }),
    )
    .mockResolvedValueOnce(triangle())
    .mockResolvedValueOnce(JSON.stringify({ valid: true, issues: "" }));
  expect(await generateQuizImage(drawing(), new AbortController().signal)).toBe(
    "data:image/png;base64,c2Vjb25k",
  );
  expect(render).toHaveBeenCalledTimes(2);
  expect(render.mock.calls[0][0].libraries).toEqual(["jsxgraph"]);
  expect(render.mock.calls[0][0].html).toContain("create('polygon'");
  expect(String(chat.mock.calls[2][0][1].content)).toContain(
    "BC label is missing",
  );
  expect(JSON.stringify(chat.mock.calls[1][0])).toContain(
    "data:image/png;base64,Zmlyc3Q=",
  );
  expect(JSON.stringify(chat.mock.calls[3][0])).toContain(
    "data:image/png;base64,c2Vjb25k",
  );
  expect(provider).not.toHaveBeenCalled();
  expect(await generatedResources()).toEqual(before);
});

it("repairs a missing explicitly requested engine instead of silently substituting a plain image", async () => {
  const provider = vi.spyOn(images, "generateImage");
  const render = vi
    .spyOn(graphics, "renderQuizGraphic")
    .mockResolvedValue("data:image/png;base64,YWJj");
  const chat = vi
    .spyOn(ai, "chat")
    .mockResolvedValueOnce(
      JSON.stringify({
        title: "No engine",
        html: '<svg><text>AB 3cm</text><path d="M0 0h20"/></svg>',
      }),
    )
    .mockResolvedValueOnce(triangle())
    .mockResolvedValueOnce(JSON.stringify({ valid: true, issues: "" }));
  expect(await generateQuizImage(drawing(), new AbortController().signal)).toBe(
    "data:image/png;base64,YWJj",
  );
  expect(render).toHaveBeenCalledTimes(1);
  expect(String(chat.mock.calls[1][0][1].content)).toContain(
    "explicitly requested engine choices",
  );
  expect(provider).not.toHaveBeenCalled();
});

it("finishes another program figure while an independent figure is still drawing", async () => {
  let release!: (value: string) => void;
  let slowFinished = false;
  vi.spyOn(graphics, "renderQuizGraphic").mockImplementation((resource) =>
    resource.title === "slow"
      ? new Promise<string>((resolve) => {
          release = resolve;
        })
      : Promise.resolve("data:image/png;base64,ZmFzdA=="),
  );
  vi.spyOn(ai, "chat").mockImplementation(async (messages) =>
    String(messages[0].content).startsWith("Check an actual")
      ? JSON.stringify({ valid: true, issues: "" })
      : triangle(JSON.parse(String(messages[1].content)).caption),
  );
  const first = drawing();
  first.image!.caption = "slow";
  const second = drawing();
  second.image!.caption = "fast";
  const slow = generateQuizImage(first, new AbortController().signal).then(
    () => {
      slowFinished = true;
    },
  );
  try {
    await waitFor(() => expect(release).toBeTypeOf("function"));
    expect(await generateQuizImage(second, new AbortController().signal)).toBe(
      "data:image/png;base64,ZmFzdA==",
    );
    expect(slowFinished).toBe(false);
  } finally {
    release("data:image/png;base64,c2xvdw==");
    await slow;
  }
});
