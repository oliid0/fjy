import { UI } from "@excalidraw/excalidraw/tests/helpers/ui";
import {
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  screen,
} from "@excalidraw/excalidraw/tests/test-utils";

import ExcalidrawApp from "../App";

describe("Test MobileMenu", () => {
  const { h } = window;
  const dimensions = { height: 400, width: 800 };

  beforeAll(() => {
    mockBoundingClientRect(dimensions);
  });

  beforeEach(async () => {
    await render(<ExcalidrawApp />);
    h.app.refreshEditorInterface();
  });

  afterAll(() => {
    restoreOriginalGetBoundingClientRect();
  });

  it("should set editor interface correctly", () => {
    expect(h.app.editorInterface.formFactor).toBe("phone");
  });

  it("keeps a blank board and the same toolbar before and after choosing a drawing tool", async () => {
    const toolbar = screen.getByRole("toolbar", { name: "白板工具栏" });
    expect(document.querySelector(".welcome-screen-center")).toBeNull();
    expect(toolbar.querySelector(".zoom-actions")).not.toBeNull();
    expect(toolbar.querySelector(".undo-redo-buttons")).not.toBeNull();
    UI.clickTool("rectangle");
    expect(h.state.activeTool.type).toBe("rectangle");
    expect(screen.getByRole("toolbar", { name: "白板工具栏" })).toBe(toolbar);
    expect(document.querySelector(".welcome-screen-center")).toBeNull();
  });
});
