import { useState } from "react";
import {
  Fcboard,
  CaptureUpdateAction,
  convertToFcboardElements,
} from "@fcboard/fcboard";

import { t } from "@fcboard/fcboard/i18n";
import { newFreeDrawElement } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";

import { Keyboard } from "@fcboard/fcboard/tests/helpers/ui";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@fcboard/fcboard/tests/test-utils";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { InsertMenu } from "./InsertMenu";
import { SelectionActions } from "./SelectionActions";
import { classroomCommands } from "./commands";
import {
  configureInsertion,
  insertionDefaults,
  readInsertions,
  renderInsertion,
} from "./insertObjects";

import type { InsertObject } from "./insertObjects";

let api: FcboardImperativeAPI;

const table = () => readInsertions(api)[0];
const click = async (
  label: "add_row" | "remove_row" | "add_column" | "remove_column",
) => {
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: t(`fcboard.${label}`) }),
    );
  });
};

beforeEach(async () => {
  let ready: FcboardImperativeAPI | undefined;
  const ReadyHarness = () => {
    const [current, setCurrent] = useState<FcboardImperativeAPI | null>(null);
    return (
      <Fcboard
        handleKeyboardGlobally
        UIOptions={{ unifiedToolbar: true }}
        onFcboardAPI={(value) => {
          ready = value;
          setCurrent(value);
        }}
      >
        {current && (
          <>
            <InsertMenu api={current} />
            <SelectionActions
              api={current}
              onPlot={vi.fn()}
              onRequest={vi.fn()}
            />
          </>
        )}
      </Fcboard>
    );
  };
  await render(<ReadyHarness />);
  api = ready!;
});
afterEach(() => vi.restoreAllMocks());

it("shows the four original actions after copy/delete, preserves uneven separators, and undoes once", async () => {
  await act(async () => {
    await renderInsertion(
      api,
      configureInsertion(insertionDefaults("table", { x: 100, y: 100 }), {
        width: 480,
        height: 240,
        columnWidths: [240, 120, 120],
        rowHeights: [120, 60, 60],
        cells: ["A", "B", "C", "D"],
      }),
    );
  });
  expect(
    within(
      screen.getByRole("toolbar", { name: t("fcboard.selection_actions") }),
    )
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label")),
  ).toEqual([
    t("labels.copy"),
    t("labels.delete"),
    t("fcboard.add_row"),
    t("fcboard.remove_row"),
    t("fcboard.add_column"),
    t("fcboard.remove_column"),
    "AI",
  ]);
  await click("add_row");
  expect(table()).toMatchObject({
    rows: 4,
    height: 320,
    rowHeights: [120, 60, 60, 80],
    position: { x: 100, y: 100 },
  });
  Keyboard.undo();
  expect(table()).toMatchObject({ rows: 3, height: 240 });
  Keyboard.redo();
  await click("add_column");
  expect(table()).toMatchObject({
    columns: 4,
    width: 640,
    columnWidths: [240, 120, 120, 160],
  });
  expect(table().cells.slice(0, 5)).toEqual(["A", "B", "C", "", "D"]);
  await click("remove_row");
  expect(table()).toMatchObject({
    rows: 3,
    height: 240,
    rowHeights: [120, 60, 60],
  });
  await click("remove_column");
  expect(table()).toMatchObject({
    columns: 3,
    width: 480,
    columnWidths: [240, 120, 120],
  });
});

it("keeps last-cell writing and text on the board after removing an edge, reindexes other rows, and restores them on undo", async () => {
  let original!: InsertObject;
  await act(async () => {
    original = configureInsertion(
      insertionDefaults("table", { x: 100, y: 100 }),
      { cells: ["", "", "", "", "", "", "", "", "last cell"] },
    );
    await renderInsertion(api, original);
    const raw = [7, 8].map((cell) =>
      newFreeDrawElement({
        type: "freedraw",
        x: 125 + (cell % 3) * 120,
        y: 245,
        points: [pointFrom(0, 0), pointFrom(20, 10)],
        simulatePressure: true,
        groupIds: [original.id],
        customData: {
          fcInk: { version: 2, pen: "hard" },
          fcInsertion: {
            ...original,
            inkCell: cell,
            origin: { x: 125 + (cell % 3) * 120, y: 245 },
          },
        },
      }),
    );
    const front = convertToFcboardElements(
      [
        {
          type: "rectangle",
          id: "front",
          x: 800,
          y: 100,
          width: 60,
          height: 60,
        },
      ],
      { regenerateIds: false },
    );
    api.updateScene({
      elements: [...api.getSceneElements(), ...raw, ...front],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      appState: {
        selectedElementIds: {
          ...Object.fromEntries(
            api
              .getSceneElements()
              .filter(
                (item) => item.customData?.fcInsertion?.id === original.id,
              )
              .map((item) => [item.id, true as const]),
          ),
          front: true,
        },
      },
    });
  });
  const originalInk = api
    .getSceneElements()
    .filter((item) => item.type === "freedraw");
  const front = api.getSceneElements().at(-1)!;
  await click("remove_column");
  expect(table()).toMatchObject({ columns: 2, width: 240 });
  const kept = api
    .getSceneElements()
    .find((item) => item.id === originalInk[0].id)!;
  const outside = api
    .getSceneElements()
    .find((item) => item.id === originalInk[1].id)!;
  if (outside.type !== "freedraw") {
    throw new Error("Cell ink must remain a single stroke");
  }
  expect(kept.customData?.fcInsertion.inkCell).toBe(5);
  expect([outside.x, outside.y, outside.points]).toEqual([
    originalInk[1].x,
    originalInk[1].y,
    originalInk[1].points,
  ]);
  expect(outside.customData?.fcInsertion).toBeUndefined();
  expect(api.getAppState().selectedElementIds[outside.id]).toBeUndefined();
  const outsideText = api
    .getSceneElements()
    .find((item) => item.type === "text" && item.text === "last cell")!;
  expect(outsideText.customData?.fcInsertion).toBeUndefined();
  expect(api.getSceneElements().at(-1)).toBe(front);
  expect(api.getAppState().selectedElementIds.front).toBe(true);
  Keyboard.undo();
  expect(table().columns).toBe(3);
  expect(
    api.getSceneElements().find((item) => item.id === originalInk[1].id)
      ?.customData?.fcInsertion.inkCell,
  ).toBe(8);
  expect(
    api
      .getSceneElements()
      .filter((item) => item.type === "text" && item.text === "last cell"),
  ).toHaveLength(1);
  Keyboard.redo();
  await click("add_column");
  expect(table().columns).toBe(3);
  expect(table().cells[8]).toBe("");
  expect(
    api
      .getSceneElements()
      .filter((item) => item.type === "text" && item.text === "last cell"),
  ).toHaveLength(1);
  expect(new Set(api.getSceneElements().map((item) => item.id)).size).toBe(
    api.getSceneElements().length,
  );
  await act(async () => {
    api.updateScene({
      elements: api
        .getSceneElements()
        .map((item) =>
          item.customData?.fcInsertion?.id === table().id
            ? { ...item, x: item.x + 40, y: item.y + 30 }
            : item,
        ),
    });
  });
  const movedInk = api.getSceneElements().find((item) => item.id === kept.id)!;
  await click("add_row");
  expect(table().position).toEqual({ x: 140, y: 130 });
  expect(
    api.getSceneElements().find((item) => item.id === kept.id),
  ).toMatchObject({ x: movedInk.x, y: movedInk.y });
});

it("retains a final row/column with the original feedback and exposes the same operations to AI", async () => {
  await act(async () => {
    await renderInsertion(
      api,
      configureInsertion(insertionDefaults("table", { x: 100, y: 100 }), {
        rows: 1,
        columns: 1,
        width: 50,
        height: 30,
      }),
    );
  });
  const before = api.getSceneElements();
  await click("remove_row");
  expect(screen.getByRole("alert")).toHaveTextContent(
    t("fcboard.only_one_row_left"),
  );
  await click("remove_column");
  expect(screen.getByRole("alert")).toHaveTextContent(
    t("fcboard.only_one_column_left"),
  );
  expect(api.getSceneElements()).toBe(before);
  expect(classroomCommands.isPublic("table.track")).toBe(true);
  await act(async () => {
    await classroomCommands.execute({
      name: "table.track",
      args: { id: table().id, action: "row.add" },
    });
  });
  expect(table()).toMatchObject({ rows: 2, height: 60 });
});

it("extends and reloads tables beyond the old 12-column and viewport-size restrictions", async () => {
  await act(async () => {
    await renderInsertion(
      api,
      configureInsertion(insertionDefaults("table", { x: 100, y: 100 }), {
        columns: 13,
        width: 1560,
      }),
    );
  });
  await click("add_column");
  expect(table()).toMatchObject({ columns: 14, width: 1680 });
  const saved = JSON.parse(JSON.stringify(table()));
  await act(async () => {
    await renderInsertion(api, saved, false, { exact: true });
  });
  expect(table()).toMatchObject({ columns: 14, width: 1680 });
  await expect(
    classroomCommands.execute({
      name: "table.track",
      args: { id: table().id, action: "row.clear" },
    }),
  ).rejects.toThrow();
});
