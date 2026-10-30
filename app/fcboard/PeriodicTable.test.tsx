import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { Fcboard } from "@fcboard/fcboard";

import { t } from "@fcboard/fcboard/i18n";

import { Keyboard } from "@fcboard/fcboard/tests/helpers/ui";
import { render as renderEditor } from "@fcboard/fcboard/tests/test-utils";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { PeriodicTable } from "./PeriodicTable";
import { TeachingResources, teachingResources } from "./TeachingResources";
import {
  periodicElements,
  periodicPosition,
  periodicElementSvg,
} from "./periodicTableData";
import { classroomCommands } from "./commands";
import { render } from "./test/render";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("retains all 118 original elements and detail fields in unique periodic and detached-series positions", () => {
  expect(periodicElements).toHaveLength(118);
  const positions = periodicElements.map((element) => {
    const position = periodicPosition(element);
    expect(position.row).toBeGreaterThan(0);
    expect(position.row).toBeLessThanOrEqual(9);
    expect(position.column).toBeGreaterThan(0);
    expect(position.column).toBeLessThanOrEqual(18);
    return `${position.row}:${position.column}`;
  });
  expect(new Set(positions).size).toBe(118);
  expect(periodicPosition(periodicElements[56])).toEqual({ row: 8, column: 4 });
  expect(periodicPosition(periodicElements[102])).toEqual({
    row: 9,
    column: 18,
  });
  expect(periodicElements[5]).toMatchObject({
    symbol: "C",
    atomicWeight: "12.011",
    electronConfiguration: "[He]2s2 2p2",
  });
  const card = new DOMParser().parseFromString(
    periodicElementSvg(periodicElements[5]),
    "image/svg+xml",
  );
  expect(card.documentElement.getAttribute("viewBox")).toBe("0 0 220 180");
  expect(card.querySelector("rect")?.getAttribute("fill")).toBe("#a78bfa");
  expect(card.documentElement.textContent).toContain("12.011");
});

it("selects elements, shows their actual details and keeps a failed insertion open for retry", async () => {
  const close = vi.fn();
  const insert = vi
    .fn()
    .mockRejectedValueOnce(new Error("Storage unavailable"))
    .mockResolvedValueOnce({ inserted: true });
  render(<PeriodicTable onClose={close} onInsert={insert} />);
  expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(117);
  fireEvent.click(screen.getByRole("button", { name: "6 C Carbon" }));
  expect(screen.getByRole("heading", { name: "Carbon" })).toBeVisible();
  expect(screen.getByRole("dialog")).toHaveTextContent("[He]2s2 2p2");
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.periodic.insert") }),
  );
  await screen.findByRole("alert");
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.periodic.insert") }),
  );
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(insert).toHaveBeenLastCalledWith(periodicElements[5]);
});

it("opens through the real resource command and inserts one saved, undoable element card into the board", async () => {
  vi.stubGlobal(
    "Image",
    vi.fn(() => {
      const image = document.createElement("img");
      Object.defineProperties(image, {
        naturalWidth: { value: 220 },
        naturalHeight: { value: 180 },
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
  try {
    const resource = teachingResources.find(
      (item) => item.action === "periodic-table",
    )!;
    await act(async () => {
      await classroomCommands.execute({
        name: "resources.use",
        args: { id: resource.id },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "8 O Oxygen" }));
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.periodic.insert") }),
    );
    await waitFor(() => expect(api.getSceneElements()).toHaveLength(1));
    expect(
      screen.queryByRole("dialog", { name: t("fcboard.periodic.title") }),
    ).toBeNull();
    const element = api.getSceneElements()[0];
    expect(element).toMatchObject({ type: "image", width: 220, height: 180 });
    expect(element.type).toBe("image");
    if (element.type !== "image" || !element.fileId) {
      throw new Error("Missing inserted card image");
    }
    const file = api.getFiles()[element.fileId];
    expect(file.mimeType).toBe("image/svg+xml");
    const svg = atob(file.dataURL.split(",")[1]);
    expect(svg).toContain("15.999");
    Keyboard.undo();
    expect(api.getSceneElements()).toHaveLength(0);
    Keyboard.redo();
    expect(api.getSceneElements()[0].id).toBe(element.id);
  } finally {
    panel.unmount();
    editor.unmount();
  }
});
