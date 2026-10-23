import * as ai from "./ai";
import { defaults, saveSettings } from "./settings";
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

it("saves a generated editable diagram for reuse and removes only the chosen resource", async () => {
  saveSettings({ ...defaults, apiKey: "test-key" }, false);
  vi.spyOn(ai, "chat").mockResolvedValue(
    JSON.stringify({
      title: "Force diagram",
      shapes: [
        {
          type: "arrow",
          x: 20,
          y: 30,
          width: 100,
          height: 0,
          strokeColor: "#245bd6",
        },
      ],
    }),
  );
  const item = await generateTeachingResource(
    "Newton's second law",
    new AbortController().signal,
  );
  expect(item.shapes[0].type).toBe("arrow");
  expect(item.shapes[0].strokeColor).toBe("#245bd6");
  expect(await generatedResources()).toContainEqual(item);
  await deleteGeneratedResource(item.id);
  expect(await generatedResources()).not.toContainEqual(item);
});

it("does not save executable or cancelled model output", async () => {
  const chat = vi.spyOn(ai, "chat").mockResolvedValue(
    JSON.stringify({
      title: "Invalid",
      shapes: [{ type: "iframe", x: 0, y: 0, width: 100, height: 100 }],
    }),
  );
  await expect(
    generateTeachingResource("diagram", new AbortController().signal),
  ).rejects.toThrow();
  expect(await generatedResources()).toHaveLength(0);
  const controller = new AbortController();
  chat.mockImplementation(async () => {
    controller.abort();
    return JSON.stringify({
      title: "Late",
      shapes: [{ type: "rectangle", x: 0, y: 0, width: 100, height: 100 }],
    });
  });
  await expect(
    generateTeachingResource("diagram", controller.signal),
  ).rejects.toThrow();
  expect(await generatedResources()).toHaveLength(0);
});
