import { expect, test } from "@playwright/test";

for (const width of [800, 1920]) {
  test(`factory toolbox uses the Capacitor command and remains reachable at ${width}px`, async ({
    page,
  }, info) => {
    // Capacitor 8.2's installed runtime reads PluginHeaders and nativePromise.
    // This verifies the production UI bridge; OEM app launches require the target device.
    await page.addInitScript(() => {
      const calls: string[] = [];
      Reflect.set(window, "__factoryCalls", calls);
      Reflect.set(window, "androidBridge", {});
      Reflect.set(window, "Capacitor", {
        PluginHeaders: [
          {
            name: "FcboardClassroom",
            methods: [
              ...[
                "getFactoryTools",
                "openFactoryTool",
                "getInkProfile",
                "listUploads",
                "removeListener",
              ].map((name) => ({ name, rtype: "promise" })),
              { name: "addListener", rtype: "callback" },
            ],
          },
        ],
        nativeCallback: () => "test-listener",
        nativePromise: async (
          _plugin: string,
          method: string,
          options: { tool?: string },
        ) => {
          if (method === "getFactoryTools") {
            return {
              available: [
                "transfer",
                "split",
                "vote",
                "calculator",
                "spotlight",
                "timer",
              ],
            };
          }
          if (method === "getInkProfile") {
            return { hardPenWidth: 4, brushPenWidth: 15, eraserSize: 150 };
          }
          if (method === "listUploads") {
            return { files: [] };
          }
          if (method === "openFactoryTool") {
            calls.push(options.tool!);
            return new Promise((resolve) =>
              Reflect.set(window, "__factoryComplete", () => resolve({})),
            );
          }
          return {};
        },
      });
    });
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/");
    await page.getByRole("button", { name: "教学工具", exact: true }).click();
    const group = page.getByRole("group", { name: "大屏工具", exact: true });
    await expect(group.getByRole("button")).toHaveCount(5);
    await expect(
      page.getByRole("button", { name: "快传", exact: true }),
    ).toBeVisible();
    await expect(
      group.getByRole("button", { name: "打开快传", exact: true }),
    ).toHaveCount(0);
    // The semantic group uses display:contents so factory and built-in controls
    // share the original three-column grid. Measure the rendered grid and buttons.
    const { box, controls } = await group.evaluate((element) => {
      const grid = element.closest(".fc-tools-grid");
      if (!grid) {
        throw new Error("Factory tools are outside their rendered grid");
      }
      const bounds = (node: Element) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      // Sample one animation frame so a panel transition cannot mix poses.
      return {
        box: bounds(grid),
        controls: Array.from(element.querySelectorAll("button"), bounds),
      };
    });
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(720);
    expect(controls).toHaveLength(5);
    for (const control of controls) {
      expect(control.x).toBeGreaterThanOrEqual(box.x);
      expect(control.x + control.width).toBeLessThanOrEqual(box.x + box.width);
      expect(control.y).toBeGreaterThanOrEqual(box.y);
      expect(control.y + control.height).toBeLessThanOrEqual(
        box.y + box.height,
      );
    }
    await page.screenshot({
      path: info.outputPath(`factory-toolbox-${width}.png`),
    });
    const calculator = group.getByRole("button", {
      name: "打开计算器",
      exact: true,
    });
    await calculator.click();
    await expect(calculator).toBeDisabled();
    await expect(calculator).toHaveAttribute("aria-busy", "true");
    expect(
      await page.evaluate(() => Reflect.get(window, "__factoryCalls")),
    ).toEqual(["calculator"]);
    await page.evaluate(() => Reflect.get(window, "__factoryComplete")());
    await expect(
      page.getByRole("dialog", { name: "教学工具" }),
    ).not.toBeVisible();
  });
}
