import { resourceFrame } from "./test/resourceFrame";
import { comparisonVisualization } from "./test/comparisonVisualization";
import * as ai from "./ai";
import { defaults, saveSettings } from "./settings";
import { interactiveResource } from "./test/interactiveResource";
import {
  generateTeachingResource,
  generatedResources,
  deleteGeneratedResource,
} from "./generatedResources";

afterEach(async () => {
  vi.restoreAllMocks();
  for (const item of await generatedResources()) {
    await deleteGeneratedResource(item.id);
  }
});

it("saves an interactive HTML lesson for reuse and removes only the chosen resource", async () => {
  saveSettings({ ...defaults, apiKey: "test-key" }, false);
  vi.spyOn(ai, "chat").mockResolvedValue(JSON.stringify(interactiveResource));
  const item = await generateTeachingResource(
    "Newton's second law",
    new AbortController().signal,
  );
  expect(item.html).toContain('id="force"');
  expect(item.html).toContain("Content-Security-Policy");
  expect(await generatedResources()).toContainEqual(item);
  await deleteGeneratedResource(item.id);
  expect(await generatedResources()).not.toContainEqual(item);
});

it("rejects a static poster and cancelled model output without saving", async () => {
  const chat = vi.spyOn(ai, "chat").mockResolvedValue(
    JSON.stringify({
      title: "Invalid",
      html: "<h1>A static poster</h1>",
    }),
  );
  await expect(
    generateTeachingResource("diagram", new AbortController().signal),
  ).rejects.toThrow();
  expect(await generatedResources()).toHaveLength(0);
  const controller = new AbortController();
  chat.mockImplementation(async () => {
    controller.abort();
    return JSON.stringify(interactiveResource);
  });
  await expect(
    generateTeachingResource("diagram", controller.signal),
  ).rejects.toThrow();
  expect(await generatedResources()).toHaveLength(0);
});

it("accepts a complete graphical HTML response without passing it through image/file import", async () => {
  vi.spyOn(ai, "chat").mockResolvedValue(
    `\`\`\`html\n${interactiveResource.html}\n\`\`\``,
  );
  const item = await generateTeachingResource(
    "牛顿力学",
    new AbortController().signal,
  );
  expect(item.title).toBe(interactiveResource.title);
  expect(item.html).toContain("<svg");
  expect(item.html).toContain("force.addEventListener");
  expect(await generatedResources()).toContainEqual(item);
});

it("generates an interactive Vega population visualization with a real preview and reusable specification", async () => {
  saveSettings({ ...defaults, apiKey: "test-key" }, false);
  const response = {
    title: "人口增长理论模型",
    mode: "vega-lite",
    spec: {
      title: "人口增长理论模型",
      width: 550,
      height: 400,
      data: {
        values: [
          { time: 0, population: 100, model: "指数增长" },
          { time: 10, population: 200, model: "指数增长" },
          { time: 0, population: 100, model: "逻辑斯蒂增长" },
          { time: 10, population: 180, model: "逻辑斯蒂增长" },
        ],
      },
      mark: { type: "line", point: true },
      encoding: {
        x: { field: "time", type: "quantitative" },
        y: { field: "population", type: "quantitative" },
        color: { field: "model", type: "nominal" },
        tooltip: [
          { field: "model" },
          { field: "time" },
          { field: "population" },
        ],
      },
      params: [
        {
          name: "zoom",
          select: { type: "interval", encodings: ["x", "y"] },
          bind: "scales",
        },
      ],
    },
  };
  const chat = vi.spyOn(ai, "chat").mockResolvedValue(JSON.stringify(response));
  const item = await generateTeachingResource(
    "生成一个人口增长可视化",
    new AbortController().signal,
    undefined,
    "visualization",
  );
  expect(item.visualization).toEqual({
    mode: response.mode,
    spec: response.spec,
  });
  expect(item.html).toContain("指数增长");
  expect(item.html).toContain("逻辑斯蒂增长");
  expect(
    new DOMParser()
      .parseFromString(item.html, "text/html")
      .querySelectorAll(".mark-line path"),
  ).toHaveLength(2);
  expect(await generatedResources()).toContainEqual(item);
  expect(chat.mock.calls[0][0][0].content).toContain("Vega-Lite");
});

it("repairs invalid form output once before storing a reusable interactive experiment", async () => {
  const chat = vi
    .spyOn(ai, "chat")
    .mockResolvedValueOnce(
      JSON.stringify({
        title: "牛顿力学",
        html: "<form><input><button>Submit</button></form>",
      }),
    )
    .mockResolvedValueOnce(JSON.stringify(interactiveResource));
  const item = await generateTeachingResource(
    "牛顿力学",
    new AbortController().signal,
  );
  expect(chat).toHaveBeenCalledTimes(2);
  expect(chat.mock.calls[1][0].at(-1)?.content).toContain(
    "working inline script",
  );
  expect(item.html).not.toContain("<form");
  expect(item.html).toContain("<svg");
  expect(await generatedResources()).toEqual([item]);
});

it("stores direct HTML with a CSS car animation instead of rejecting it for missing SVG or interaction", async () => {
  const chat = vi.spyOn(ai, "chat")
    .mockResolvedValue(`<!doctype html><html><head>
<title>牛顿第一定律演示</title><style>@keyframes travel{to{transform:translateX(250px)}}</style>
</head><body><h1>无摩擦轨道上的小车</h1><p>推力撤去后，小车保持匀速直线运动。</p>
<div class="car" style="width:40px;height:20px;background:teal;animation:travel 4s linear infinite"></div>
</body></html>`);
  const item = await generateTeachingResource(
    "牛顿第一定律演示",
    new AbortController().signal,
  );
  expect(chat).toHaveBeenCalledTimes(1);
  expect(item.title).toBe("牛顿第一定律演示");
  expect(item.html).toContain('class="car"');
  expect(item.html).toContain("animation:travel");
  expect(await generatedResources()).toEqual([item]);
});

it("uses the actual renderer diagnostic to repair a visualization once, then saves only the valid result", async () => {
  const chat = vi
    .spyOn(ai, "chat")
    .mockResolvedValueOnce(
      JSON.stringify({
        title: "Too large",
        mode: "vega-lite",
        spec: {
          data: { sequence: { start: 0, stop: 1e10, step: 1 } },
          mark: "line",
        },
      }),
    )
    .mockResolvedValueOnce(
      JSON.stringify({ title: "比较图", ...comparisonVisualization }),
    );
  const item = await generateTeachingResource(
    "可视化比较y=x+1和y=1/x",
    new AbortController().signal,
  );
  expect(chat).toHaveBeenCalledTimes(2);
  expect(chat.mock.calls[1][0].at(-1)?.content).toContain("2000 rows");
  expect(item.visualization).toEqual(comparisonVisualization);
  expect(await generatedResources()).toEqual([item]);
});

it("does not accept HTML as a substitute for a requested Vega visualization", async () => {
  const chat = vi
    .spyOn(ai, "chat")
    .mockResolvedValue(JSON.stringify(interactiveResource));
  await expect(
    generateTeachingResource("人口增长可视化", new AbortController().signal),
  ).rejects.toThrow();
  expect(chat).toHaveBeenCalledTimes(2);
  expect(await generatedResources()).toHaveLength(0);
});

it.each([
  "力与加速度的交互HTML可视化，不用图表",
  "力与加速度可视化，用其他风格展示",
])(
  "keeps the generated native HTML and live interactions for %s",
  async (topic) => {
    const chat = vi
      .spyOn(ai, "chat")
      .mockResolvedValue(interactiveResource.html);
    const item = await generateTeachingResource(
      topic,
      new AbortController().signal,
    );
    expect(item.visualization).toBeUndefined();
    expect(item.html).toContain("force.addEventListener");
    expect(chat).toHaveBeenCalledOnce();
    const frame = resourceFrame({
      id: item.id,
      surface: "whiteboard",
      html: item.html,
    });
    try {
      const force = frame.window.document.getElementById(
        "force",
      ) as HTMLInputElement;
      force.value = "10";
      force.dispatchEvent(new frame.window.Event("input", { bubbles: true }));
      expect(
        frame.window.document.getElementById("acceleration")!.textContent,
      ).toBe("5 m/s²");
      expect(
        frame.window.document.getElementById("block")!.getAttribute("x"),
      ).toBe("150");
      expect(await generatedResources()).toEqual([item]);
    } finally {
      frame.dispose();
      vi.unstubAllGlobals();
    }
  },
);

it("keeps an explicitly requested HTML contract when repairing an accidental Vega response", async () => {
  const chat = vi
    .spyOn(ai, "chat")
    .mockResolvedValueOnce(
      JSON.stringify({ title: "Comparison", ...comparisonVisualization }),
    )
    .mockResolvedValueOnce(interactiveResource.html);
  const item = await generateTeachingResource(
    "力与加速度交互HTML可视化",
    new AbortController().signal,
  );
  expect(chat).toHaveBeenCalledTimes(2);
  expect(item.visualization).toBeUndefined();
  expect(chat.mock.calls[1][0].at(-1)?.content).toContain(
    "complete corrected self-contained HTML",
  );
});
