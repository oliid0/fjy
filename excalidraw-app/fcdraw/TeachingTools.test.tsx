import { act, render } from "@testing-library/react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { TeachingTools } from "./TeachingTools";
import { classroomCommands } from "./commands";
import { readWidgets } from "./widgets";

vi.mock("@excalidraw/excalidraw", async (original) => ({
  ...(await original<typeof import("@excalidraw/excalidraw")>()),
  ToolbarExtras: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

it("executes one AI request that inserts, configures and starts a timer before React commits the selection", async () => {
  let scene: readonly ExcalidrawElement[] = [];
  const api = {
    getSceneElements: () => scene,
    getAppState: () => ({
      selectedElementIds: {},
      scrollX: 0,
      scrollY: 0,
      width: 1600,
      height: 900,
      zoom: { value: 1 },
    }),
    onChange: () => () => {},
    setActiveTool: vi.fn(),
    updateScene: (value: { elements?: readonly ExcalidrawElement[] }) => {
      if (value.elements) {
        scene = value.elements;
      }
    },
  } as unknown as ExcalidrawImperativeAPI;
  render(<TeachingTools api={api} />);
  await act(async () => {
    await classroomCommands.execute({
      name: "tools.insert",
      args: { kind: "timer" },
    });
    await classroomCommands.execute({
      name: "tools.configure",
      args: { duration: 300 },
    });
    await classroomCommands.execute({
      name: "tools.play",
      args: { enabled: true },
    });
  });
  const timer = readWidgets(api)[0];
  expect(timer.params.duration).toBe(300);
  expect(timer.params.running).toBe(true);
});
