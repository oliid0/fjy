import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { openTeachingTools } from "./menu";

import type { Page } from "@playwright/test";

test.use({ hasTouch: true });
const dragTouch = async (
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  radius = 2,
) => {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...from, id: 1, radiusX: radius, radiusY: radius }],
    });
    for (let step = 1; step <= 8; step++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: from.x + ((to.x - from.x) * step) / 8,
            y: from.y + ((to.y - from.y) * step) / 8,
            id: 1,
            radiusX: radius,
            radiusY: radius,
          },
        ],
      });
    }
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
};

for (const width of [390, 1920]) {
  test(`native pen swipes stay inside pen choices and leave lower controls working at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const pen = page
      .getByRole("toolbar", { name: "白板工具栏", exact: true })
      .getByRole("button", { name: "笔", exact: true });
    await pen.click();
    const settings = page.locator(".fc-factory-pen-settings");
    if (!(await settings.isVisible())) {
      await pen.click();
    }
    const types = settings.locator(".fc-pen-types");
    const lowerBounds = () =>
      settings.locator(".fc-pen-mode,.fc-pen-colors").evaluateAll((nodes) =>
        nodes.map((node) => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return { x, y, width, height };
        }),
      );
    const lowerBefore = await lowerBounds();
    const first = await types.getByRole("button").nth(2).boundingBox();
    const from = {
      x: first!.x + first!.width / 2,
      y: first!.y + first!.height / 2,
    };
    await dragTouch(page, from, { x: from.x - 60, y: from.y + 2 });
    const next = settings.getByRole("button", { name: "下一页", exact: true });
    await expect(next).toHaveAttribute("aria-pressed", "true");
    await expect(
      types.getByRole("button", { name: "函数笔", exact: true }),
    ).toBeVisible();
    expect(await lowerBounds()).toEqual(lowerBefore);
    const preview = await settings.locator("svg").last().boundingBox();
    const point = {
      x: preview!.x + preview!.width / 2,
      y: preview!.y + preview!.height / 2,
    };
    await dragTouch(page, point, { x: point.x + 50, y: point.y });
    await expect(next).toHaveAttribute("aria-pressed", "true");
    const slider = settings.getByRole("slider");
    const value = await slider.inputValue();
    const bar = await slider.boundingBox();
    await dragTouch(
      page,
      { x: bar!.x + bar!.width * 0.25, y: bar!.y + bar!.height / 2 },
      { x: bar!.x + bar!.width * 0.8, y: bar!.y + bar!.height / 2 },
    );
    await expect(slider).not.toHaveValue(value);
    await expect(next).toHaveAttribute("aria-pressed", "true");
    const changed = await slider.inputValue();
    const back = await types.getByRole("button").first().boundingBox();
    const start = {
      x: back!.x + back!.width / 2,
      y: back!.y + back!.height / 2,
    };
    await dragTouch(page, start, { x: start.x + 60, y: start.y + 2 });
    await expect(
      settings.getByRole("button", { name: "上一页", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(slider).toHaveValue(changed);
  });

  test(`native touch keeps every tool together and preserves the next tool tap at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await openTeachingTools(page);
    const menu = page.getByRole("dialog", { name: "教学工具", exact: true });
    const transfer = await menu
      .getByRole("button", { name: "快传", exact: true })
      .boundingBox();
    const from = {
      x: transfer!.x + transfer!.width / 2,
      y: transfer!.y + transfer!.height / 2,
    };
    await dragTouch(page, from, { x: from.x - 70, y: from.y + 2 });
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("button", { name: "录制", exact: true }),
    ).toBeVisible();
    const recording = await menu
      .getByRole("button", { name: "录制", exact: true })
      .boundingBox();
    const back = {
      x: recording!.x + recording!.width / 2,
      y: recording!.y + recording!.height / 2,
    };
    await dragTouch(page, back, { x: back.x + 70, y: back.y + 2 });
    await expect(
      menu.getByRole("button", { name: "插入直尺", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".fc-recording-dialog")).toHaveCount(0);
    await menu.getByRole("button", { name: "插入直尺", exact: true }).tap();
    await expect(menu).toBeHidden();
    await expect(page.locator("[data-gizmo]")).toHaveCount(1);
  });

  test(`native touch moves all four teaching tools after choosing selection at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const toolbar = page.getByRole("toolbar", {
      name: "白板工具栏",
      exact: true,
    });
    for (const [kind, label] of [
      ["ruler", "直尺"],
      ["protractor", "量角器"],
      ["compass", "圆规"],
      ["setSquare", "三角板"],
    ]) {
      await toolbar
        .getByRole("button", { name: "工具箱", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "工具箱", exact: true })
        .getByRole("button", { name: `插入${label}`, exact: true })
        .click();
      const current = async () =>
        page.evaluate((kind) => {
          const element = JSON.parse(localStorage.getItem("fcboard") || "[]")
            .filter(
              (element: {
                isDeleted?: boolean;
                customData?: { fcWidget?: { kind: string } };
              }) =>
                !element.isDeleted &&
                element.customData?.fcWidget?.kind === kind,
            )
            .at(-1);
          if (!element) {
            return undefined;
          }
          const widget = element.customData.fcWidget;
          // Generic selection moves element geometry; metadata retains its base origin.
          return {
            ...widget,
            position: {
              x: widget.position.x + element.x - widget.origin.x,
              y: widget.position.y + element.y - widget.origin.y,
            },
          };
        }, kind);
      await expect.poll(current).toBeDefined();
      const before = await current();
      const group = page.locator(`[data-gizmo="${before.id}"]`);
      await expect(group).toBeVisible();
      const body = group
        .locator(kind === "setSquare" ? ":scope > polygon" : ":scope > rect")
        .first();
      const box = (await body.boundingBox())!;
      const scale = await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("fcboard-state") || "{}").zoom.value,
      );
      const left = Math.max(4, box.x - 10);
      const top = Math.max(4, box.y - 10);
      const right = Math.min(width - 4, box.x + box.width + 10);
      const bottom = Math.min(780, box.y + box.height + 10);
      const select = toolbar.getByRole("button", { name: "选择", exact: true });
      await select.click();
      await page.mouse.move(left, top);
      await page.mouse.down();
      for (const [x, y] of [
        [right, top],
        [right, bottom],
        [left, bottom],
        [left, top],
      ]) {
        await page.mouse.move(x, y, { steps: 8 });
      }
      await page.mouse.up();
      const actions = page.getByRole("toolbar", {
        name: "选区操作",
        exact: true,
      });
      await expect(actions).toBeVisible();
      await expect(group).not.toBeVisible();
      const from = { x: (left + right) / 2, y: (top + bottom) / 2 };
      await dragTouch(page, from, { x: from.x + 24, y: from.y + 28 });
      await expect
        .poll(async () => (await current()).position.x)
        .toBeCloseTo(before.position.x + 24 / scale, 0);
      await expect
        .poll(async () => (await current()).position.y)
        .toBeCloseTo(before.position.y + 28 / scale, 0);
      await actions.getByRole("button", { name: "删除", exact: true }).click();
      await expect.poll(current).toBeUndefined();
    }
  });

  test(`a confirmed table waits for native touch placement and uses the selected pen color at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const toolbar = page.getByRole("toolbar", {
      name: "白板工具栏",
      exact: true,
    });
    await toolbar.getByRole("button", { name: "工具箱", exact: true }).click();
    await page.getByRole("button", { name: "表格", exact: true }).click();
    await page
      .getByRole("dialog", { name: "表格", exact: true })
      .getByRole("button", { name: "确定", exact: true })
      .click();
    const table = () =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("fcboard") || "[]").filter(
          (element: {
            isDeleted?: boolean;
            customData?: { fcInsertion?: { kind: string } };
          }) =>
            !element.isDeleted &&
            element.customData?.fcInsertion?.kind === "table",
        ),
      );
    expect(await table()).toEqual([]);
    await expect(
      page.locator("[data-insertion-placement=table]"),
    ).toBeVisible();
    await dragTouch(
      page,
      { x: 35, y: 180 },
      { x: Math.min(width - 35, 385), y: 410 },
    );
    await expect.poll(async () => (await table()).length).toBeGreaterThan(0);
    const parts = await table();
    const state = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("fcboard-state") || "{}"),
    );
    const object = parts[0].customData.fcInsertion;
    expect(object.position).toEqual({ x: 35, y: 180 });
    expect(object.width).toBe(Math.min(width - 70, 350));
    expect(object.height).toBe(230);
    expect(
      parts.every(
        (part: { strokeColor: string }) =>
          part.strokeColor === state.currentItemStrokeColor,
      ),
    ).toBe(true);
    await expect(page.locator("[data-insertion-placement=table]")).toHaveCount(
      0,
    );
    await toolbar.getByRole("button", { name: "板擦", exact: true }).click();
    await toolbar.getByRole("button", { name: "板擦", exact: true }).click();
    await page
      .locator(".fc-native-eraser-row")
      .getByRole("button", { name: "框选擦除", exact: true })
      .click();
    await dragTouch(page, { x: 40, y: 185 }, { x: 65, y: 210 }, 2);
    await expect.poll(table).toEqual([]);
  });
}

for (const width of [390, 1920]) {
  test(`original split and curtain settings apply through actual tool controls at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      // Exercise the real downloadable-file fallback in browsers without a picker.
      Reflect.deleteProperty(window, "showOpenFilePicker");
      Reflect.deleteProperty(window, "showSaveFilePicker");
    });
    await page.goto("/");
    const openTool = async (name: string) => {
      await page.getByRole("button", { name: "工具箱", exact: true }).click();
      await page
        .getByRole("dialog", { name: "工具箱", exact: true })
        .getByRole("button", { name: `打开${name}`, exact: true })
        .click();
    };
    await openTool("分屏");
    const settings = page.getByRole("dialog", {
      name: "分屏 · 设置",
      exact: true,
    });
    await expect(settings).toBeVisible();
    await expect(page.locator(".fc-split-pane canvas")).toHaveCount(0);
    await settings.getByRole("radio", { name: "3", exact: true }).check();
    await settings.getByRole("radio", { name: "绿色", exact: true }).check();
    await settings.getByRole("button", { name: "确定", exact: true }).click();
    const panes = page.locator(".fc-split-pane canvas");
    await expect(panes).toHaveCount(3);
    await expect(panes.first()).toHaveCSS(
      "background-color",
      "rgb(38, 55, 49)",
    );
    const first = await panes.first().boundingBox();
    await dragTouch(
      page,
      { x: first!.x + 20, y: first!.y + 60 },
      { x: first!.x + 65, y: first!.y + 100 },
    );
    const hasInk = (index: number) =>
      panes.nth(index).evaluate((canvas: HTMLCanvasElement) =>
        canvas
          .getContext("2d")!
          .getImageData(0, 0, canvas.width, canvas.height)
          .data.some((value, i) => i % 4 === 3 && value > 0),
      );
    expect(await hasInk(0)).toBe(true);
    expect(await hasInk(1)).toBe(false);
    const board = page.locator(".fc-split-board");
    await expect(board.locator("header")).toHaveCount(0);
    await expect(
      board.getByRole("button", { name: "关闭", exact: true }),
    ).toHaveCount(1);
    await expect(board.locator(".fc-split-bottom").first()).toHaveCSS(
      "height",
      "52px",
    );
    const size = await panes.evaluateAll((items: HTMLCanvasElement[]) => ({
      width: items.reduce((sum, canvas) => sum + canvas.width, 0),
      height: Math.max(...items.map((canvas) => canvas.height)),
    }));
    await board
      .getByRole("button", { name: "关闭", exact: true })
      .first()
      .click();
    const exit = page.getByRole("dialog", {
      name: "是否退出分屏？是否保存文件？",
      exact: true,
    });
    const downloading = page.waitForEvent("download");
    await exit.getByRole("button", { name: "保存", exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/\.jpg$/);
    const bytes = await readFile((await download.path())!);
    const exported = await page.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/jpeg;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(
        10,
        30,
        Math.min(90, canvas.width - 10),
        100,
      ).data;
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        hasInk: pixels.some((value, i) => i % 4 < 3 && value < 70),
      };
    }, bytes.toString("base64"));
    expect(exported).toMatchObject({ ...size, hasInk: true });
    await expect(exit).toHaveCount(0);
    expect(await hasInk(0)).toBe(true);
    await board
      .getByRole("button", { name: "关闭", exact: true })
      .last()
      .click();
    await exit.getByRole("button", { name: "不保存", exact: true }).click();
    await openTool("分屏");
    await settings.getByRole("radio", { name: "2", exact: true }).check();
    await settings.getByRole("button", { name: "取消", exact: true }).click();
    await expect(panes).toHaveCount(0);
    await openTool("分屏");
    await settings.getByRole("button", { name: "确定", exact: true }).click();
    await expect(panes).toHaveCount(3);
    expect(await hasInk(0)).toBe(true);
    await board
      .getByRole("button", { name: "关闭", exact: true })
      .first()
      .click();
    await exit.getByRole("button", { name: "不保存", exact: true }).click();
    await openTool("幕布");
    const curtain = page.locator(".fc-curtain");
    await curtain
      .getByRole("button", { name: "切换幕布背景", exact: true })
      .click();
    const themes = page.getByRole("dialog", {
      name: "切换幕布背景",
      exact: true,
    });
    await themes.getByRole("button", { name: "#0101df", exact: true }).click();
    await expect(curtain).toHaveCSS("background-color", "rgb(1, 1, 223)");
    await themes.getByRole("tab", { name: "背景", exact: true }).click();
    await themes
      .getByRole("button", { name: "切换幕布背景 2", exact: true })
      .click();
    await expect(curtain).not.toHaveCSS("background-image", "none");
    await themes.getByRole("button", { name: "关闭", exact: true }).click();
    await curtain.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(curtain).toHaveCount(0);
  });

  test(`spotlight touch movement keeps the grab point and settings remain reachable at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "工具箱", exact: true }).click();
    await page
      .getByRole("dialog", { name: "工具箱", exact: true })
      .getByRole("button", { name: "打开聚光灯", exact: true })
      .click();
    const spotlight = page.getByRole("region", { name: "聚光灯", exact: true });
    const ring = spotlight.locator(".fc-spotlight-ring");
    const before = await ring.boundingBox();
    const from = {
      x: before!.x + before!.width / 2 + 15,
      y: before!.y + before!.height / 2 + 15,
    };
    await dragTouch(page, from, { x: from.x - 60, y: from.y - 40 });
    const after = await ring.boundingBox();
    expect(after!.x - before!.x).toBeCloseTo(-60, 0);
    expect(after!.y - before!.y).toBeCloseTo(-40, 0);
    await spotlight.getByRole("button", { name: "设置", exact: true }).click();
    const popup = spotlight.getByRole("group", { name: "设置", exact: true });
    const bounds = await popup.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await popup.getByRole("button", { name: "#ff0000", exact: true }).click();
    await expect(spotlight.locator("svg > rect")).toHaveAttribute(
      "fill",
      "#ff0000",
    );
    await page.touchscreen.tap(2, 2);
    await expect(popup).toHaveCount(0);
    await spotlight
      .getByRole("button", { name: "关闭聚光灯", exact: true })
      .click();
    await expect(spotlight).toHaveCount(0);
  });
}

test("touch toolbar customization persists and board ordering confirms or cancels before selected-page sharing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "新建白板", exact: true }),
  ).toBeEnabled();
  await page.getByTestId("main-menu-trigger").click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  const settings = page.locator(".fc-settings-dialog");
  await settings.getByRole("button", { name: "工具栏", exact: true }).click();
  const tile = settings.locator('[data-tool-id="mindmap"]');
  await tile
    .getByRole("button", { name: "将思维导图添加到底部栏", exact: true })
    .tap();
  await expect(
    page.locator('.fc-drawing-tools [data-toolbar-item="mindmap"]'),
  ).toHaveCount(1);
  await settings.press("Escape");
  await page.reload();
  await expect(
    page.locator('.fc-drawing-tools [data-toolbar-item="mindmap"]'),
  ).toHaveCount(1);
  for (let index = 0; index < 2; index++) {
    const add = page.getByRole("button", { name: "新建白板", exact: true });
    await expect(add).toBeEnabled();
    await add.click();
    await expect(page.locator(".fc-board-count")).toContainText(
      `${index + 2} / ${index + 2}`,
    );
  }
  await page.locator("[data-board-switcher]").click();
  const list = page.locator(".fc-board-picker");
  const ids = () =>
    list
      .locator("[data-board-id]")
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLElement).dataset.boardId),
      );
  const before = await ids();
  const reorder = async () => {
    const handle = (await list.locator(".fc-board-drag").last().boundingBox())!;
    const target = (await list
      .locator("[data-board-id]")
      .first()
      .boundingBox())!;
    await dragTouch(
      page,
      { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
      { x: target.x + target.width / 2, y: target.y + target.height / 2 },
    );
  };
  await reorder();
  await expect.poll(ids).not.toEqual(before);
  await list.getByRole("button", { name: "取消", exact: true }).click();
  expect(await ids()).toEqual(before);
  await reorder();
  await list.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.locator(".fc-board-count")).toContainText("1 / 3");
  await list.getByRole("button", { name: "分享选中白板", exact: true }).click();
  const sharing = page.locator(".fc-share-dialog");
  await expect(sharing).toBeVisible();
  await expect(sharing.locator('input[type="checkbox"]:checked')).toHaveCount(
    1,
  );
});
