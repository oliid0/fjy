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
