import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { Fcboard } from "@fcboard/fcboard";

import { t } from "@fcboard/fcboard/i18n";

import { Keyboard } from "@fcboard/fcboard/tests/helpers/ui";
import { render as renderEditor } from "@fcboard/fcboard/tests/test-utils";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { ChartEditor } from "./ChartEditor";
import { chartSvg, chartValue } from "./chartData";
import { TeachingResources, teachingResources } from "./TeachingResources";
import { classroomCommands } from "./commands";
import { render } from "./test/render";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("draws the source axis, zero values, single-sector donut and escaped titles without invalid geometry", () => {
  expect(["", "1.2.3", "-4", "Infinity", "3.5"].map(chartValue)).toEqual([
    0, 0, 0, 0, 3.5,
  ]);
  const rows = [
    { title: "<script>alert(1)</script>", value: 33 },
    { title: "", value: 88 },
  ];
  const svg = new DOMParser().parseFromString(
    chartSvg({ type: "bar", rows, width: 500, height: 300 }),
    "image/svg+xml",
  );
  expect(svg.querySelector("script")).toBeNull();
  expect(svg.documentElement.textContent).toContain("100.0");
  const bars = svg.querySelectorAll('rect[rx="4"]');
  expect(bars).toHaveLength(2);
  expect(bars[1].getAttribute("width")).toBe("102.72");
  expect(Number(bars[1].getAttribute("y"))).toBeCloseTo(52.08);
  const single = chartSvg({
    type: "pie",
    rows: [{ title: "One", value: 1 }],
    width: 500,
    height: 300,
  });
  const donut = new DOMParser().parseFromString(single, "image/svg+xml");
  expect(donut.querySelectorAll("circle")).toHaveLength(2);
  expect(single).not.toMatch(/NaN|Infinity/);
  expect(
    chartSvg({ type: "line", rows: [], width: 500, height: 300 }),
  ).toContain(t("fcboard.chart.noData"));
});

it("edits and previews actual data, keeps failed insertion retryable, and permits an empty chart", async () => {
  const close = vi.fn();
  const insert = vi
    .fn()
    .mockRejectedValueOnce(new Error("Storage unavailable"))
    .mockResolvedValue(undefined);
  render(<ChartEditor onClose={close} onInsert={insert} />);
  fireEvent.change(
    screen.getByRole("textbox", { name: `${t("fcboard.chart.legend")} 1` }),
    { target: { value: "Team A" } },
  );
  const value = screen.getByRole("textbox", {
    name: `${t("fcboard.chart.data")} 1`,
  });
  fireEvent.change(value, { target: { value: "20" } });
  fireEvent.change(value, { target: { value: "abc" } });
  expect(value).toHaveValue("20");
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.chart.line") }),
  );
  const image = screen.getByRole("img", { name: t("fcboard.chart.preview") });
  expect(decodeURIComponent(image.getAttribute("src")!)).toContain("Team A");
  fireEvent.click(
    screen.getByRole("button", {
      name: t("fcboard.chart.insert"),
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Storage unavailable"),
  );
  expect(close).not.toHaveBeenCalled();
  expect(insert.mock.calls[0][0]).toMatchObject({
    type: "line",
    rows: [{ title: "Team A", value: 20 }, { value: 55 }, { value: 88 }],
  });
  for (let index = 0; index < 3; index++) {
    fireEvent.click(
      screen.getByRole("button", { name: `${t("fcboard.chart.delete")} 1` }),
    );
  }
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.chart.addRow") }),
  );
  expect(
    screen.getByRole("textbox", { name: `${t("fcboard.chart.legend")} 1` }),
  ).toHaveValue(`${t("fcboard.chart.defaultTitle")}3`);
  fireEvent.click(
    screen.getByRole("button", { name: `${t("fcboard.chart.delete")} 1` }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: t("fcboard.chart.insert"),
    }),
  );
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(insert.mock.lastCall?.[0]).toMatchObject({ rows: [] });
});

it("inserts the edited chart through the real resource command with one undo, and rejects invalid or stale requests", async () => {
  vi.stubGlobal(
    "Image",
    vi.fn(() => {
      const image = document.createElement("img");
      Object.defineProperties(image, {
        naturalWidth: { value: 507 },
        naturalHeight: { value: 328 },
      });
      Object.defineProperty(image, "src", {
        set: (value: string) => {
          image.setAttribute("src", value);
          queueMicrotask(() => image.dispatchEvent(new Event("load")));
        },
        get: () => image.getAttribute("src") || "",
      });
      return image;
    }),
  );
  let api!: FcboardImperativeAPI;
  const editor = await renderEditor(
    <Fcboard
      handleKeyboardGlobally
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const panel = render(<TeachingResources api={api} />);
  const resource = teachingResources.find((item) => item.action === "chart")!;
  try {
    await act(async () => {
      await classroomCommands.execute({
        name: "resources.use",
        args: { id: resource.id },
      });
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: `${t("fcboard.chart.legend")} 1` }),
      { target: { value: "Physics" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: t("fcboard.chart.insert"),
      }),
    );
    await waitFor(() => expect(api.getSceneElements()).toHaveLength(1));
    const element = api.getSceneElements()[0];
    if (element.type !== "image" || !element.fileId) {
      throw new Error("Missing inserted chart image");
    }
    expect(api.getFiles()[element.fileId].mimeType).toBe("image/svg+xml");
    expect(
      atob(api.getFiles()[element.fileId].dataURL.split(",")[1]),
    ).toContain("Physics");
    Keyboard.undo();
    expect(api.getSceneElements()).toHaveLength(0);
    Keyboard.redo();
    expect(api.getSceneElements()[0].id).toBe(element.id);
    await expect(
      classroomCommands.execute({
        name: "resources.use",
        args: {
          id: resource.id,
          chart: {
            type: "bar",
            rows: [{ title: "bad", value: NaN }],
            width: 500,
            height: 300,
          },
        },
      }),
    ).rejects.toThrow("Invalid chart data");
    await act(async () => {
      await classroomCommands.execute({
        name: "resources.use",
        args: { id: resource.id },
      });
    });
    act(() => classroomCommands.invalidate());
    expect(
      screen.queryByRole("dialog", { name: t("fcboard.chart.title") }),
    ).toBeNull();
    expect(api.getSceneElements()).toHaveLength(1);
  } finally {
    panel.unmount();
    editor.unmount();
  }
});
