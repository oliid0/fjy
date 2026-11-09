import { t } from "@fcboard/fcboard/i18n";
import { waitFor, within } from "@testing-library/react";

import { Fcboard, ToolbarExtras } from "../index";
import { saveToolbarItems, TOOLBAR_STORAGE } from "../toolbarPreferences";

import { render, screen, fireEvent } from "./test-utils";

describe("unified bottom toolbar", () => {
  afterEach(() => {
    localStorage.removeItem(TOOLBAR_STORAGE);
    vi.restoreAllMocks();
  });
  it("updates pinned actions immediately and keeps all drawing controls when optional items are hidden", async () => {
    await render(
      <Fcboard UIOptions={{ unifiedToolbar: true }}>
        <ToolbarExtras toolId="mindmap">
          <button>Mapped mind map action</button>
        </ToolbarExtras>
      </Fcboard>,
    );
    const toolbar = screen.getByRole("toolbar", {
      name: t("fcboard.whiteboard_toolbar"),
    });
    expect(within(toolbar).queryByText("Mapped mind map action")).toBeNull();
    const { act } = await import("@testing-library/react");
    act(() => saveToolbarItems(["mindmap", "shape"]));
    expect(
      await within(toolbar).findByText("Mapped mind map action"),
    ).toBeVisible();
    expect(
      within(toolbar).queryByRole("button", { name: t("fcboard.toolbox") }),
    ).toBeNull();
    expect(
      within(toolbar).getByRole("button", { name: t("fcboard.shape") }),
    ).toBeVisible();
    act(() => saveToolbarItems([]));
    expect(within(toolbar).queryByText("Mapped mind map action")).toBeNull();
    for (const label of ["pen", "eraser", "select"] as const) {
      expect(
        within(toolbar).getByRole("button", { name: t(`fcboard.${label}`) }),
      ).toBeVisible();
    }
    expect(toolbar.querySelector(".fc-board-mode")).toBeNull();
    expect(within(toolbar).queryByTestId("button-undo")).toBeNull();
    expect(within(toolbar).queryByTestId("button-redo")).toBeNull();
  });
  it("activates the current shape before opening its picker, dismisses outside, and reopens the insertion menu", async () => {
    const { container } = await render(
      <Fcboard UIOptions={{ unifiedToolbar: true }} />,
    );
    const insert = screen.getByRole("button", { name: t("fcboard.toolbox") });
    let clock = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    fireEvent.click(insert);
    fireEvent.click(
      within(screen.getByRole("toolbar")).getByRole("button", {
        name: t("fcboard.shape"),
      }),
    );
    expect(window.h.state.activeTool.type).toBe("line");
    const modal = container.querySelector(".MuiDialog-root")!;
    expect(modal).not.toBeNull();
    fireEvent.keyDown(
      screen.getByRole("dialog", { name: t("fcboard.shape") }),
      { key: "Escape" },
    );
    await waitFor(() =>
      expect(screen.queryByTestId("toolbar-rectangle")).toBeNull(),
    );
    clock += 400;
    fireEvent.click(insert);
    expect(
      screen.getByRole("button", { name: t("fcboard.shape") }),
    ).toBeVisible();
    expect(screen.queryByTestId("toolbar-rectangle")).toBeNull();
  });
  it("contains the original tools, menus, zoom, history and host controls in a single container", async () => {
    const { container } = await render(
      <Fcboard UIOptions={{ unifiedToolbar: true }}>
        <ToolbarExtras>
          <button>{t("fcboard.voice_commands")}</button>
        </ToolbarExtras>
      </Fcboard>,
    );
    const toolbar = screen.getByRole("toolbar", {
      name: t("fcboard.whiteboard_toolbar"),
    });
    expect(
      within(toolbar).getByTestId("main-menu-trigger"),
    ).toBeInTheDocument();
    expect(toolbar.querySelector(".default-sidebar-trigger")).toBeNull();
    expect(toolbar.querySelector(".zoom-actions")).toBeNull();
    expect(within(toolbar).queryByTestId("toolbar-rectangle")).toBeNull();
    expect(
      within(toolbar).getByRole("button", { name: t("fcboard.toolbox") }),
    ).toHaveAttribute("data-board-insert");
    fireEvent.click(
      within(toolbar).getByRole("button", { name: t("fcboard.toolbox") }),
    );
    expect(
      screen.getByRole("dialog", { name: t("fcboard.toolbox") }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole("toolbar")).getByRole("button", {
        name: t("fcboard.shape"),
      }),
    );
    expect(screen.getByTestId("toolbar-rectangle")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toolbar-rectangle"));
    expect(window.h.state.activeTool.type).toBe("rectangle");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: t("fcboard.shape") }),
      ).toBeNull(),
    );
    expect(toolbar.querySelector(".undo-redo-buttons")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(toolbar).getByRole("button", {
          name: t("fcboard.voice_commands"),
        }),
      ).toBeInTheDocument(),
    );
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

  it("matches first/repeated/rapid clicks and activates a held pen only on release", async () => {
    await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
    let time = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => time);
    const eraser = screen.getByRole("button", { name: t("fcboard.eraser") });
    const pen = screen.getByRole("button", { name: t("fcboard.pen") });
    fireEvent.click(eraser);
    expect(
      screen.getByRole("dialog", { name: t("fcboard.eraser_settings") }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.eraser_sizes") }),
    );
    expect(
      screen.getByRole("slider", { name: t("fcboard.eraser_sizes") }),
    ).toBeVisible();
    time += 399;
    fireEvent.click(eraser);
    expect(
      screen.getByRole("slider", { name: t("fcboard.eraser_sizes") }),
    ).toBeVisible();
    time++;
    fireEvent.click(eraser);
    expect(
      screen.queryByRole("slider", { name: t("fcboard.eraser_sizes") }),
    ).toBeNull();
    expect(
      screen.getByRole("dialog", { name: t("fcboard.eraser_settings") }),
    ).toBeVisible();
    vi.useFakeTimers();
    try {
      fireEvent.pointerDown(pen, {
        pointerId: 1,
        pointerType: "touch",
        button: 0,
      });
      await vi.advanceTimersByTimeAsync(600);
      expect(window.h.state.activeTool.type).toBe("eraser");
      expect(
        screen.queryByRole("dialog", {
          name: t("fcboard.pen_and_object_properties"),
        }),
      ).toBeNull();
      fireEvent.pointerUp(pen, {
        pointerId: 1,
        pointerType: "touch",
        button: 0,
      });
      fireEvent.click(pen);
      expect(window.h.state.activeTool.type).toBe("freedraw");
      expect(
        screen.queryByRole("dialog", { name: t("fcboard.eraser_settings") }),
      ).toBeNull();
      fireEvent.click(pen);
      expect(
        screen.getByRole("dialog", {
          name: t("fcboard.pen_and_object_properties"),
        }),
      ).toBeVisible();
      fireEvent.click(pen);
      expect(
        screen.queryByRole("dialog", {
          name: t("fcboard.pen_and_object_properties"),
        }),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});
