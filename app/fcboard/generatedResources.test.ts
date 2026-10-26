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
