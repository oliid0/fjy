import { act, fireEvent, screen, waitFor } from "@testing-library/react";

import type {
  FcboardImperativeAPI,
  FcboardProps,
} from "@fcboard/fcboard/types";

import { SplitBoard } from "./SplitBoard";
import { classroomCommands } from "./commands";
import { render } from "./test/render";

const mounted = vi.hoisted(() => ({ apis: [] as FcboardImperativeAPI[] }));
vi.mock("@fcboard/fcboard", async (original) => {
  const module = await original<typeof import("@fcboard/fcboard")>();
  return {
    ...module,
    Fcboard: (props: FcboardProps) => (
      <module.Fcboard
        {...props}
        onMount={(event) => {
          mounted.apis.push(event.excalidrawAPI);
          props.onMount?.(event);
        }}
      />
    ),
  };
});

it("opens the APK's writing regions and keeps actual ink, tools and clearing independent", async () => {
  mounted.apis = [];
  const view = render(<SplitBoard />);
  try {
    await act(async () => {
      await classroomCommands.execute({ name: "tools.split" });
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "确定" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "3分屏" }));
    fireEvent.click(screen.getByRole("button", { name: "背景2" }));
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(mounted.apis).toHaveLength(3));
    expect(screen.getByRole("region", { name: "分屏书写白板" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "第2区红笔" }));
    expect(mounted.apis[1].getAppState().currentItemStrokeColor).toBe(
      "#ff0000",
    );
    expect(mounted.apis[0].getAppState().currentItemStrokeColor).toBe(
      "#000000",
    );
    const canvases = view.container.querySelectorAll("canvas.interactive");
    const pointer = (type: string, x: number, pane = 1, pointerId = 1) =>
      fireEvent(
        canvases[pane],
        Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
          pointerId,
          pointerType: "pen",
          clientX: x,
          clientY: 100,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          pressure: 0.5,
          width: 1,
          height: 1,
        }),
      );
    pointer("pointerdown", 30);
    pointer("pointermove", 130);
    pointer("pointerup", 150);
    expect(
      mounted.apis[1]
        .getSceneElements()
        .filter((element) => element.type === "freedraw"),
    ).toHaveLength(1);
    expect(mounted.apis[0].getSceneElements()).toHaveLength(0);
    pointer("pointerdown", 20, 0, 2);
    pointer("pointerdown", 30, 1, 3);
    pointer("pointermove", 100, 0, 2);
    pointer("pointermove", 160, 1, 3);
    pointer("pointerup", 130, 0, 2);
    pointer("pointerup", 190, 1, 3);
    expect(mounted.apis[0].getSceneElements()).toHaveLength(1);
    expect(mounted.apis[1].getSceneElements()).toHaveLength(2);
    expect(mounted.apis[1].getAppState().viewBackgroundColor).toBe("#5c7c62");
    fireEvent.click(screen.getByRole("button", { name: "清空第1区" }));
    expect(mounted.apis[0].getSceneElements()).toHaveLength(0);
    expect(mounted.apis[1].getSceneElements()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "退出分屏" }));
    fireEvent.click(screen.getByRole("button", { name: /^退出$/ }));
    expect(screen.queryByRole("region", { name: "分屏书写白板" })).toBeNull();
  } finally {
    view.unmount();
  }
});
