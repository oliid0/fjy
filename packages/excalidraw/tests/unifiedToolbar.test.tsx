import { within } from "@testing-library/react";

import { Excalidraw, ToolbarExtras } from "../index";

import { render, screen, fireEvent } from "./test-utils";

describe("unified bottom toolbar", () => {
  it("contains the original tools, menus, zoom, history and host controls in a single container", async () => {
    const { container } = await render(
      <Excalidraw UIOptions={{ unifiedToolbar: true }}>
        <ToolbarExtras>
          <button>语音指令</button>
        </ToolbarExtras>
      </Excalidraw>,
    );
    const toolbar = screen.getByRole("toolbar", { name: "白板工具栏" });
    expect(
      within(toolbar).getByTestId("main-menu-trigger"),
    ).toBeInTheDocument();
    expect(
      toolbar.querySelector(".default-sidebar-trigger"),
    ).toBeInTheDocument();
    expect(toolbar.querySelector(".zoom-actions")).toBeInTheDocument();
    expect(toolbar.querySelector(".undo-redo-buttons")).toBeInTheDocument();
    expect(
      within(toolbar).getByRole("button", { name: "语音指令" }),
    ).toBeInTheDocument();
    expect(container.querySelector(".shapes-section-container")).toBeNull();
    expect(container.querySelector(".FixedSideContainer_side_top")).toBeNull();
    expect(container.querySelector(".layer-ui__wrapper__footer")).toBeNull();
    expect(container.querySelector(".fc-editor-properties")).toBeNull();
    fireEvent.click(
      within(toolbar).getByRole("button", { name: "画笔与对象属性" }),
    );
    expect(
      screen.getByRole("dialog", { name: "画笔与对象属性" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭属性" }));
    expect(screen.queryByRole("dialog", { name: "画笔与对象属性" })).toBeNull();
  });
});
