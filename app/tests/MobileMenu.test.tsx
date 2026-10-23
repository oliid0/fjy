import { t } from "@excalidraw/excalidraw/i18n";
import { UI } from "@excalidraw/excalidraw/tests/helpers/ui";
import {
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  screen,
  fireEvent,
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

  it("uses one anchored Material menu with back navigation and a dedicated factory background page", async () => {
    fireEvent.click(screen.getByTestId("main-menu-trigger"));
    expect(
      document.querySelector(".fc-material-menu.MuiPaper-root"),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: t("fcboard.设置") }));
    expect(screen.queryByTestId("load-button")).toBeNull();
    fireEvent.click(
      screen.getByRole("menuitem", { name: t("buttons.export") }),
    );
    expect(screen.getByTestId("image-export-button")).toBeVisible();
    fireEvent.click(
      screen.getByRole("menuitem", { name: t("fcboard.返回设置") }),
    );
    expect(screen.queryByTestId("image-export-button")).toBeNull();
    fireEvent.click(
      screen.getByRole("menuitem", { name: t("fcboard.白板设置") }),
    );
    await screen.findByRole("dialog", { name: t("fcboard.白板设置") });
    fireEvent.click(screen.getByRole("button", { name: /Background.*›/ }));
    const pattern = screen.getByRole("button", {
      name: t("fcboard.背景图案 {{number}}", { number: 4 }),
    });
    fireEvent.click(pattern);
    expect(h.state.whiteboardBackground?.pattern).toBe(4);
    expect(pattern).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelectorAll(".fc-background-picker img")).toHaveLength(
      13,
    );
    fireEvent.keyDown(
      screen.getByRole("dialog", { name: t("fcboard.白板设置") }),
      { key: "Escape" },
    );
    expect(
      screen.queryByRole("dialog", { name: t("fcboard.白板设置") }),
    ).toBeNull();
  });

  it("keeps a blank board and the same toolbar before and after choosing a drawing tool", async () => {
    const toolbar = screen.getByRole("toolbar", {
      name: t("fcboard.白板工具栏"),
    });
    expect(document.querySelector(".welcome-screen-center")).toBeNull();
    expect(toolbar.querySelector(".zoom-actions")).toBeNull();
    expect(toolbar.querySelector(".undo-redo-buttons")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.插入") }));
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.图形") }));
    expect(
      screen
        .getByRole("dialog", { name: t("fcboard.插入与工具") })
        .querySelector(".zoom-actions"),
    ).toBeNull();
    UI.clickTool("rectangle");
    expect(h.state.activeTool.type).toBe("rectangle");
    expect(screen.getByRole("toolbar", { name: t("fcboard.白板工具栏") })).toBe(
      toolbar,
    );
    expect(document.querySelector(".welcome-screen-center")).toBeNull();
  });
});
