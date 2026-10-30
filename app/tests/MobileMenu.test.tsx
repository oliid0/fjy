import { t } from "@fcboard/fcboard/i18n";

import {
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  screen,
  fireEvent,
} from "@fcboard/fcboard/tests/test-utils";

import FcboardApp from "../App";

describe("Test MobileMenu", () => {
  const { h } = window;
  const dimensions = { height: 400, width: 800 };

  beforeAll(() => {
    mockBoundingClientRect(dimensions);
  });

  beforeEach(async () => {
    await render(<FcboardApp />);
    h.app.refreshEditorInterface();
  });

  afterAll(() => {
    restoreOriginalGetBoundingClientRect();
  });

  it("should set editor interface correctly", () => {
    expect(h.app.editorInterface.formFactor).toBe("phone");
  });

  it("opens the original settings home and nested pages, without obsolete toolbox actions", async () => {
    fireEvent.click(screen.getByTestId("main-menu-trigger"));
    expect(
      document.querySelector(".fc-material-menu.MuiPaper-root"),
    ).not.toBeNull();
    fireEvent.click(
      screen.getByRole("menuitem", { name: t("fcboard.settings") }),
    );
    await screen.findByRole("dialog", {
      name: t("fcboard.whiteboard_settings"),
    });
    expect(screen.queryByTestId("dropdown-menu")).toBeNull();
    expect(
      screen.getByRole("navigation", {
        name: t("fcboard.settings_navigation"),
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: t("fcboard.toolbox") }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.background") }),
    );
    expect(screen.queryByTestId("image-export-button")).toBeNull();
    expect(
      document.querySelector("[data-settings-page='background']"),
    ).not.toBeNull();
    const pattern = screen.getByRole("button", {
      name: t("fcboard.background_pattern_number", { number: 4 }),
    });
    fireEvent.click(pattern);
    expect(h.state.whiteboardBackground?.pattern).toBe(4);
    expect(pattern).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelectorAll(".fc-background-picker img")).toHaveLength(
      14,
    );
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.back") }));
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.ai_and_speech_settings") }),
    );
    expect(document.querySelector("[data-settings-page='ai']")).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.models_and_connection") }),
    );
    expect(
      document.querySelector("[data-settings-page='models']"),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: t("fcboard.save_settings") }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: t("fcboard.test_current_settings"),
      }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.back") }));
    expect(document.querySelector("[data-settings-page='ai']")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.back") }));
    expect(
      document.querySelector("[data-settings-page='home']"),
    ).not.toBeNull();
    fireEvent.keyDown(
      screen.getByRole("dialog", { name: t("fcboard.whiteboard_settings") }),
      { key: "Escape" },
    );
    expect(
      screen.queryByRole("dialog", { name: t("fcboard.whiteboard_settings") }),
    ).toBeNull();
  });

  it("keeps a blank board and the same toolbar before and after choosing a drawing tool", async () => {
    const toolbar = screen.getByRole("toolbar", {
      name: t("fcboard.whiteboard_toolbar"),
    });
    expect(document.querySelector(".welcome-screen-center")).toBeNull();
    expect(toolbar.querySelector(".zoom-actions")).toBeNull();
    expect(toolbar.querySelector(".undo-redo-buttons")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.insert") }));
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.shape") }));
    expect(
      screen
        .getByRole("dialog", { name: t("fcboard.insert_tools") })
        .querySelector(".zoom-actions"),
    ).toBeNull();
    expect(
      document.querySelectorAll(".fc-factory-shape-grid button"),
    ).toHaveLength(20);
    const rectangle = screen.getByTestId("factory-shape-rectangle");
    fireEvent.click(rectangle);
    expect(h.state.activeTool).toMatchObject({
      type: "custom",
      customType: "factory-shape:6",
    });
    expect(rectangle).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("toolbar", { name: t("fcboard.whiteboard_toolbar") }),
    ).toBe(toolbar);
    expect(document.querySelector(".welcome-screen-center")).toBeNull();
  });
});
