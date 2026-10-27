import { t } from "@excalidraw/excalidraw/i18n";
import { within } from "@testing-library/react";

import { Excalidraw, ToolbarExtras } from "../index";

import { render, screen, fireEvent } from "./test-utils";

describe("unified bottom toolbar", () => {
  it("contains the original tools, menus, zoom, history and host controls in a single container", async () => {
    const { container } = await render(
      <Excalidraw UIOptions={{ unifiedToolbar: true }}>
        <ToolbarExtras>
          <button>{t("fcboard.voice_commands")}</button>
        </ToolbarExtras>
      </Excalidraw>,
    );
    const toolbar = screen.getByRole("toolbar", {
      name: t("fcboard.whiteboard_toolbar"),
    });
    expect(
      within(toolbar).getByTestId("main-menu-trigger"),
    ).toBeInTheDocument();
    expect(
      toolbar.querySelector(".default-sidebar-trigger"),
    ).toBeInTheDocument();
    expect(toolbar.querySelector(".zoom-actions")).toBeNull();
    expect(within(toolbar).queryByTestId("toolbar-rectangle")).toBeNull();
    expect(
      within(toolbar).getByRole("button", { name: t("fcboard.insert") }),
    ).toHaveAttribute("data-board-insert");
    fireEvent.click(
      within(toolbar).getByRole("button", { name: t("fcboard.insert") }),
    );
    expect(
      screen.getByRole("dialog", { name: t("fcboard.insert_tools") }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.shape") }));
    expect(screen.getByTestId("toolbar-rectangle")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toolbar-rectangle"));
    expect(window.h.state.activeTool.type).toBe("rectangle");
    expect(
      screen.queryByRole("dialog", { name: t("fcboard.insert_tools") }),
    ).toBeNull();
    expect(toolbar.querySelector(".undo-redo-buttons")).toBeInTheDocument();
    expect(
      within(toolbar).getByRole("button", {
        name: t("fcboard.voice_commands"),
      }),
    ).toBeInTheDocument();
    expect(container.querySelector(".shapes-section-container")).toBeNull();
    expect(container.querySelector(".FixedSideContainer_side_top")).toBeNull();
    expect(container.querySelector(".layer-ui__wrapper__footer")).toBeNull();
    expect(container.querySelector(".fc-editor-properties")).toBeNull();
    const pen = within(toolbar).getByRole("button", {
      name: t("fcboard.pen"),
    });
    fireEvent.click(pen);
    expect(
      screen.queryByRole("dialog", {
        name: t("fcboard.pen_and_object_properties"),
      }),
    ).toBeNull();
    fireEvent.click(pen);
    expect(
      screen.getByRole("dialog", {
        name: t("fcboard.pen_and_object_properties"),
      }),
    ).toBeInTheDocument();
    fireEvent.click(pen);
    expect(
      screen.queryByRole("dialog", {
        name: t("fcboard.pen_and_object_properties"),
      }),
    ).toBeNull();
  });
});
