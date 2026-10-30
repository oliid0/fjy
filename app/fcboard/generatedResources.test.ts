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
