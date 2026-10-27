import { Excalidraw } from "@excalidraw/excalidraw";
import {
  act,
  fireEvent,
  render,
} from "@excalidraw/excalidraw/tests/test-utils";
import { Keyboard } from "@excalidraw/excalidraw/tests/helpers/ui";
import { screen, waitFor } from "@testing-library/react";
import { t } from "@excalidraw/excalidraw/i18n";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { render as renderControls } from "./test/render";
import { MindMapControls } from "./MindMapControls";
import {
  configureInsertion,
  insertionDefaults,
  readInsertions,
  renderInsertion,
} from "./insertObjects";
import { boardWritingParts, insertionWritingTargets } from "./insertionWriting";

const setup = async (scale = 1) => {
  let api!: ExcalidrawImperativeAPI;
  const editor = await render(
    <Excalidraw
      handleKeyboardGlobally
      UIOptions={{ unifiedToolbar: true }}
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  await act(async () => {
    await renderInsertion(
      api,
      configureInsertion(insertionDefaults("mindmap", { x: 100, y: 100 }), {
        outline: "Root\n  First\n    Leaf\n  Second",
        nodeSize: { width: 140 * scale, height: 48 * scale },
        width: 360 * scale,
        height: 144 * scale,
      }),
    );
    api.setActiveTool({ type: "freedraw" });
  });
  const controls = renderControls(<MindMapControls api={api} />);
  const canvas = editor.container.querySelector("canvas.interactive")!;
  const pointer = (
    target: Element | Window,
    type: string,
    x: number,
    y: number,
  ) =>
    fireEvent(
      target,
      Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
        clientX: x,
        clientY: y,
        pointerId: 1,
        isPrimary: true,
        pointerType: "pen",
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        pressure: 0.6,
        width: 1,
        height: 1,
      }),
    );
  const targets = () =>
    insertionWritingTargets(boardWritingParts(api.getSceneElements()));
  const select = (index: number) => {
    const node = targets()[index];
    pointer(
      canvas,
      "pointerdown",
      node.x + node.width / 2,
      node.y + node.height / 2,
    );
    pointer(
      canvas,
      "pointerup",
      node.x + node.width / 2,
      node.y + node.height / 2,
    );
  };
  return { api, controls, editor, canvas, pointer, select, targets };
};

it("selects a single node without adding ink, then clears, adds and deletes its complete branch", async () => {
  const { api, select } = await setup();
  select(1);
  expect(
    api.getSceneElements().some((element) => element.type === "freedraw"),
  ).toBe(false);
  expect(api.getAppState().selectedElementIds).toEqual({});
  expect(
    screen.getByRole("button", { name: t("fcboard.mindmap_move_node") }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.mindmap_clear_node") }),
  );
  await waitFor(() =>
    expect(readInsertions(api)[0].outline).toBe("Root\n  \n    Leaf\n  Second"),
  );
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.mindmap_add_child") }),
  );
  await waitFor(() =>
    expect(readInsertions(api)[0].outline.split("\n")).toHaveLength(5),
  );
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.mindmap_delete_node") }),
  );
  await waitFor(() =>
    expect(readInsertions(api)[0].outline).toBe("Root\n  Second"),
  );
  expect(
    screen.queryByRole("button", { name: t("fcboard.mindmap_move_node") }),
  ).toBeNull();
  Keyboard.undo();
  expect(readInsertions(api)[0].outline.split("\n")).toHaveLength(5);
});

it.each([1, 2])(
  "drags a node at scale %s without collapsing size, commits one undo and rolls back cancellation",
  async (scale) => {
    const { api, pointer, select, targets } = await setup(scale);
    select(1);
    const before = targets();
    expect(
      before.every(
        (target) =>
          target.width === 140 * scale && target.height === 48 * scale,
      ),
    ).toBe(true);
    const button = screen.getByRole("button", {
      name: t("fcboard.mindmap_move_node"),
    });
    pointer(button, "pointerdown", 200, 200);
    pointer(window, "pointermove", 250, 230);
    expect(targets()[1]).toMatchObject({
      x: before[1].x + 50,
      y: before[1].y + 30,
    });
    expect(targets()[2]).toMatchObject({ x: before[2].x, y: before[2].y });
    pointer(window, "pointerup", 270, 240);
    expect(
      targets().every(
        (target) =>
          target.width === 140 * scale && target.height === 48 * scale,
      ),
    ).toBe(true);
    expect(targets()[1]).toMatchObject({
      x: before[1].x + 70,
      y: before[1].y + 40,
    });
    Keyboard.undo();
    expect(targets()[1]).toMatchObject({ x: before[1].x, y: before[1].y });
    Keyboard.redo();
    expect(targets()[1]).toMatchObject({
      x: before[1].x + 70,
      y: before[1].y + 40,
    });
    pointer(
      screen.getByRole("button", { name: t("fcboard.mindmap_move_node") }),
      "pointerdown",
      200,
      200,
    );
    pointer(window, "pointermove", 300, 300);
    fireEvent(window, new Event("pointercancel", { bubbles: true }));
    await waitFor(() =>
      expect(targets()[1]).toMatchObject({
        x: before[1].x + 70,
        y: before[1].y + 40,
      }),
    );
    pointer(
      screen.getByRole("button", { name: t("fcboard.mindmap_move_node") }),
      "pointerdown",
      200,
      200,
    );
    pointer(window, "pointermove", 250, 250);
    act(() => {
      api.updateScene({ elements: [] });
    });
    pointer(window, "pointerup", 300, 300);
    expect(readInsertions(api)).toEqual([]);
    expect(
      screen.queryByRole("button", { name: t("fcboard.mindmap_move_node") }),
    ).toBeNull();
  },
);

it("lets palm and pen-side-button erasing reach the canvas without selecting a node", async () => {
  const { canvas, targets } = await setup();
  const node = targets()[1];
  for (const contact of [
    { pointerType: "touch", width: 80, height: 90, buttons: 1 },
    { pointerType: "pen", width: 1, height: 1, buttons: 33 },
  ]) {
    for (const type of ["pointerdown", "pointerup"]) {
      fireEvent(
        canvas,
        Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
          pointerId: 20,
          isPrimary: true,
          clientX: node.x + 40,
          clientY: node.y + 20,
          button: 0,
          pressure: 0.6,
          ...contact,
          ...(type === "pointerup" ? { buttons: 0 } : {}),
        }),
      );
    }
    expect(
      screen.queryByRole("button", { name: t("fcboard.mindmap_move_node") }),
    ).toBeNull();
  }
});
