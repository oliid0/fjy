import { expect, test } from "@playwright/test";

for (const [kind, width, height, nets, face] of [
  ["立方体", 1920, 1080, 11, "front"],
  ["圆柱", 3080, 1240, 3, "side"],
  ["立方体", 390, 844, 11, "front"],
] as const) {
  test(`${kind} has a bounded face menu and reversible unfolding at ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const toolbar = page.getByRole("toolbar", { name: "白板工具栏" });
    await toolbar.getByRole("button", { name: "插入", exact: true }).click();
    await page.getByRole("button", { name: "图形", exact: true }).click();
    await page
      .getByTestId(`factory-shape-${kind === "立方体" ? "cube" : "cylinder"}`)
      .click();
    const start = { x: Math.max(30, width / 2 - 120), y: height / 2 - 100 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 240, start.y + 200, { steps: 12 });
    await page.mouse.up();
    const solid = () =>
      page.evaluate(() => {
        const elements = JSON.parse(localStorage.getItem("excalidraw") || "[]");
        return elements.find(
          (element: {
            isDeleted?: boolean;
            customData?: { fcWidget?: unknown };
          }) => !element.isDeleted && element.customData?.fcWidget,
        )?.customData.fcWidget;
      });
    await expect.poll(solid).toBeDefined();
    const row = page.getByRole("toolbar", { name: "选区操作", exact: true });
    await expect(row).toHaveCount(0);
    await toolbar.getByRole("button", { name: "选择", exact: true }).click();
    const region = await page.evaluate(() => {
      type Part = {
        id: string;
        x: number;
        y: number;
        width: number;
        height: number;
        angle?: number;
        points?: number[][];
        isDeleted?: boolean;
        customData?: { fcWidget?: { id: string } };
      };
      const elements: Part[] = JSON.parse(
        localStorage.getItem("excalidraw") || "[]",
      );
      const id = elements.find(
        (element) => !element.isDeleted && element.customData?.fcWidget,
      )?.customData?.fcWidget?.id;
      if (!id) {
        throw new Error("Solid not persisted");
      }
      const parts = elements.filter(
        (element) =>
          !element.isDeleted && element.customData?.fcWidget?.id === id,
      );
      const corners = parts.flatMap((element) => {
        const minX = element.points?.length
          ? Math.min(...element.points.map((point) => point[0]))
          : 0;
        const maxX = element.points?.length
          ? Math.max(...element.points.map((point) => point[0]))
          : element.width;
        const minY = element.points?.length
          ? Math.min(...element.points.map((point) => point[1]))
          : 0;
        const maxY = element.points?.length
          ? Math.max(...element.points.map((point) => point[1]))
          : element.height;
        const centerX = element.x + (minX + maxX) / 2;
        const centerY = element.y + (minY + maxY) / 2;
        const cosine = Math.cos(element.angle || 0);
        const sine = Math.sin(element.angle || 0);
        return [
          [element.x + minX, element.y + minY],
          [element.x + maxX, element.y + minY],
          [element.x + maxX, element.y + maxY],
          [element.x + minX, element.y + maxY],
        ].map(([x, y]) => ({
          x: centerX + (x - centerX) * cosine - (y - centerY) * sine,
          y: centerY + (x - centerX) * sine + (y - centerY) * cosine,
        }));
      });
      const state = JSON.parse(
        localStorage.getItem("excalidraw-state") || "{}",
      );
      const zoom = state.zoom?.value || 1;
      const canvas = document
        .querySelector("canvas.interactive")!
        .getBoundingClientRect();
      return {
        ids: parts.map((part) => part.id),
        left:
          (Math.min(...corners.map((point) => point.x)) +
            (state.scrollX || 0)) *
            zoom +
          canvas.left -
          16,
        top:
          (Math.min(...corners.map((point) => point.y)) +
            (state.scrollY || 0)) *
            zoom +
          canvas.top -
          16,
        right:
          (Math.max(...corners.map((point) => point.x)) +
            (state.scrollX || 0)) *
            zoom +
          canvas.left +
          16,
        bottom:
          (Math.max(...corners.map((point) => point.y)) +
            (state.scrollY || 0)) *
            zoom +
          canvas.top +
          16,
      };
    });
    expect(region.left).toBeGreaterThanOrEqual(0);
    expect(region.top).toBeGreaterThanOrEqual(0);
    expect(region.right).toBeLessThanOrEqual(width);
    expect(region.bottom).toBeLessThanOrEqual(height);
    await page.mouse.move(region.left, region.top);
    await page.mouse.down();
    for (const [x, y] of [
      [region.right, region.top],
      [region.right, region.bottom],
      [region.left, region.bottom],
      [region.left, region.top],
    ]) {
      await page.mouse.move(x, y, { steps: 4 });
    }
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate((ids) => {
          const state = JSON.parse(
            localStorage.getItem("excalidraw-state") || "{}",
          );
          const selected = state.selectedElementIds || {};
          return (
            ids.every((id) => selected[id]) &&
            Object.values(selected).filter(Boolean).length === ids.length
          );
        }, region.ids),
      )
      .toBe(true);
    await expect(
      row.getByRole("button", { name: "展开图形", exact: true }),
    ).toBeVisible();
    const bounds = (await row.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    const doubleClickFace = async () => {
      const point = await page.evaluate((face) => {
        const elements = JSON.parse(localStorage.getItem("excalidraw") || "[]");
        const element = elements.find(
          (item: {
            isDeleted?: boolean;
            customData?: { fcSolidFace?: string };
          }) => !item.isDeleted && item.customData?.fcSolidFace === face,
        );
        if (!element?.points?.length) {
          throw new Error("Solid face not persisted");
        }
        const state = JSON.parse(
          localStorage.getItem("excalidraw-state") || "{}",
        );
        const center = element.points.reduce(
          (sum: number[], p: number[]) => [sum[0] + p[0], sum[1] + p[1]],
          [0, 0],
        );
        const zoom = state.zoom?.value || 1;
        return {
          x:
            (element.x +
              center[0] / element.points.length +
              (state.scrollX || 0)) *
            zoom,
          y:
            (element.y +
              center[1] / element.points.length +
              (state.scrollY || 0)) *
            zoom,
        };
      }, face);
      await page.locator("canvas.interactive").dblclick({ position: point });
    };
    await row.getByRole("button", { name: "逐面上色", exact: true }).click();
    const colors = page.getByRole("dialog", { name: "逐面上色", exact: true });
    await expect(colors).toBeVisible();
    await colors.getByRole("button", { name: "#ef4444", exact: true }).click();
    await expect
      .poll(async () => (await solid())?.params.solid.colors[face])
      .toBe("#ef4444");
    await page.keyboard.press("Escape");
    await expect(colors).toBeHidden();
    await toolbar.getByRole("button", { name: "选择", exact: true }).click();
    await doubleClickFace();
    await expect.poll(async () => (await solid())?.params.solid.unfold).toBe(1);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await solid())?.params.solid.unfold).toBe(0);
    await expect
      .poll(async () => (await solid())?.params.solid.colors[face])
      .toBe("#ef4444");
    await row.getByRole("button", { name: "展开方式", exact: true }).click();
    const choices = page.getByRole("dialog", { name: "展开方式", exact: true });
    await expect(choices.getByRole("button")).toHaveCount(nets);
    await choices
      .getByRole("button", { name: `展开方式 ${nets}`, exact: true })
      .click();
    await expect
      .poll(async () => (await solid())?.params.solid.net)
      .toBe(nets - 1);
    await expect.poll(async () => (await solid())?.params.solid.unfold).toBe(1);
    await page.screenshot({
      path: info.outputPath(`solid-${kind}-${width}-unfolded.png`),
    });
    await doubleClickFace();
    await expect.poll(async () => (await solid())?.params.solid.unfold).toBe(0);
    await row.getByRole("button", { name: "删除", exact: true }).click();
    await expect.poll(solid).toBeUndefined();
    await page.keyboard.press("Control+z");
    await expect
      .poll(async () => (await solid())?.params.solid.colors[face])
      .toBe("#ef4444");
  });
}
