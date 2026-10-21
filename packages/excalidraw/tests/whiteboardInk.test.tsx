import { t } from "@excalidraw/excalidraw/i18n";
import { DEFAULT_ELEMENT_PROPS } from "@excalidraw/common";

import { Excalidraw } from "../index";
import { getNormalizedZoom } from "../scene";

import { API } from "./helpers/api";
import { act, fireEvent, render, screen } from "./test-utils";

const { h } = window;
const pointer = (
  canvas: Element,
  type: string,
  x: number,
  y: number,
  extra: Record<string, unknown> = {},
) => {
  fireEvent(
    canvas,
    Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      pressure: 0.5,
      width: 1,
      height: 1,
      ...extra,
    }),
  );
};
const draw = (canvas: Element) => {
  act(() => h.app.setActiveTool({ type: "freedraw" }));
  pointer(canvas, "pointerdown", 100, 200);
  pointer(canvas, "pointermove", 200, 200);
  pointer(canvas, "pointermove", 400, 200);
  pointer(canvas, "pointerup", 400, 200);
};
const live = () => h.elements.filter((element) => !element.isDeleted);

describe("APK-style whiteboard ink", () => {
  it("keeps hard and fountain widths independent and uses the firmware's integer thickness range", async () => {
    const { container } = await render(
      <Excalidraw
        UIOptions={{
          unifiedToolbar: true,
          inkProfile: {
            hardPenWidth: 4,
            brushPenWidth: 15,
            palmThreshold: 36,
            eraserSize: 60,
            penWidthMax: 20,
          },
        }}
      />,
    );
    const canvas = container.querySelector("canvas.interactive")!;
    draw(canvas);
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.画笔") }));
    let settings = screen.getByRole("dialog", {
      name: t("fcboard.画笔与对象属性"),
    });
    const thickness = settings.querySelector("input[type='range']")!;
    expect(thickness).toHaveAttribute("min", "2");
    expect(thickness).toHaveAttribute("max", "20");
    expect(thickness).toHaveAttribute("step", "1");
    fireEvent.change(thickness, { target: { value: "8" } });
    fireEvent.click(
      settings.querySelector(`button[aria-label='${t("fcboard.钢笔")}']`)!,
    );
    pointer(canvas, "pointerdown", 100, 250);
    pointer(canvas, "pointermove", 200, 250);
    pointer(canvas, "pointerup", 200, 250);
    expect(live().at(-1)!.strokeWidth).toBeCloseTo(15);
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.画笔") }));
    settings = screen.getByRole("dialog", {
      name: t("fcboard.画笔与对象属性"),
    });
    fireEvent.change(settings.querySelector("input[type='range']")!, {
      target: { value: "20" },
    });
    fireEvent.click(
      settings.querySelector(`button[aria-label='${t("fcboard.画笔")}']`)!,
    );
    pointer(canvas, "pointerdown", 100, 300);
    pointer(canvas, "pointermove", 200, 300);
    pointer(canvas, "pointerup", 200, 300);
    expect(live().at(-1)!.strokeWidth).toBeCloseTo(8);
    expect(live()[1].strokeWidth).toBeCloseTo(15);
  });
  it("moves the canvas one-to-one with the touch centroid and reverses immediately at the native scale limit", async () => {
    const { container } = await render(
      <Excalidraw UIOptions={{ unifiedToolbar: true }} />,
    );
    const canvas = container.querySelector("canvas.interactive")!;
    act(() => {
      API.setAppState({
        scrollX: 0,
        scrollY: 0,
        zoom: { value: getNormalizedZoom(1) },
      });
      h.app.setActiveTool({ type: "hand" });
    });
    pointer(canvas, "pointerdown", 100, 100, {
      pointerId: 31,
      pointerType: "touch",
    });
    pointer(canvas, "pointerdown", 300, 100, {
      pointerId: 32,
      pointerType: "touch",
    });
    pointer(canvas, "pointermove", 150, 120, {
      pointerId: 31,
      pointerType: "touch",
    });
    pointer(canvas, "pointermove", 350, 120, {
      pointerId: 32,
      pointerType: "touch",
    });
    expect(h.state.zoom.value).toBeCloseTo(1);
    expect(h.state.scrollX).toBeCloseTo(50);
    expect(h.state.scrollY).toBeCloseTo(20);
    pointer(canvas, "pointermove", 650, 120, {
      pointerId: 32,
      pointerType: "touch",
    });
    expect(h.state.zoom.value).toBe(2);
    pointer(canvas, "pointermove", 600, 120, {
      pointerId: 32,
      pointerType: "touch",
    });
    expect(h.state.zoom.value).toBeCloseTo(1.8);
    pointer(canvas, "pointerup", 150, 120, {
      pointerId: 31,
      pointerType: "touch",
    });
    pointer(canvas, "pointerup", 600, 120, {
      pointerId: 32,
      pointerType: "touch",
    });
    expect(live()).toHaveLength(0);
  });
  it("dismisses tool settings with Escape without cancelling the selected tool", async () => {
    await render(
      <Excalidraw
        handleKeyboardGlobally
        UIOptions={{ unifiedToolbar: true }}
      />,
    );
    const eraser = screen.getByRole("button", { name: t("fcboard.橡皮") });
    fireEvent.click(eraser);
    fireEvent.click(eraser);
    fireEvent.keyDown(screen.getByLabelText(t("fcboard.橡皮设置")), {
      key: "Escape",
    });
    expect(
      screen.queryByLabelText(t("fcboard.橡皮设置")),
    ).not.toBeInTheDocument();
    expect(h.state.activeTool.type).toBe("eraser");
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.插入") }));
    fireEvent.keyDown(screen.getByLabelText(t("fcboard.插入与工具")), {
      key: "Escape",
    });
    expect(
      screen.queryByLabelText(t("fcboard.插入与工具")),
    ).not.toBeInTheDocument();
    expect(h.state.activeTool.type).toBe("eraser");
  });
  it("dismisses anchored tool settings when hiding the toolbar and keeps them dismissed after restoring it", async () => {
    await render(<Excalidraw UIOptions={{ unifiedToolbar: true }} />);
    act(() => h.app.setActiveTool({ type: "freedraw" }));
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.画笔") }));
    expect(
      screen.getByRole("dialog", { name: t("fcboard.画笔与对象属性") }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.隐藏工具栏") }),
    );
    expect(
      screen.queryByRole("dialog", { name: t("fcboard.画笔与对象属性") }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.显示工具栏") }),
    );
    expect(
      screen.queryByRole("dialog", { name: t("fcboard.画笔与对象属性") }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.橡皮") }));
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.橡皮") }));
    expect(screen.getByLabelText(t("fcboard.橡皮设置"))).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.隐藏工具栏") }),
    );
    expect(
      screen.queryByLabelText(t("fcboard.橡皮设置")),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.显示工具栏") }),
    );
    expect(
      screen.queryByLabelText(t("fcboard.橡皮设置")),
    ).not.toBeInTheDocument();
  });
  it("clears only after the eraser slider reaches its end, preserves the board, and restores content with one undo", async () => {
    const { container } = await render(
      <Excalidraw UIOptions={{ unifiedToolbar: true }} />,
    );
    const canvas = container.querySelector("canvas.interactive")!;
    API.setAppState({
      viewBackgroundColor: "#123d32",
      currentItemPenMode: "brush",
    });
    draw(canvas);
    const eraser = screen.getByRole("button", { name: t("fcboard.橡皮") });
    fireEvent.click(eraser);
    fireEvent.click(eraser);
    const slider = screen.getByRole("slider", {
      name: t("fcboard.滑动清空当前白板"),
    });
    fireEvent.change(slider, { target: { value: "80" } });
    fireEvent.pointerUp(slider);
    expect(live()).toHaveLength(1);
    fireEvent.change(slider, { target: { value: "100" } });
    fireEvent.pointerUp(slider);
    expect(live()).toHaveLength(0);
    expect(h.state.viewBackgroundColor).toBe("#123d32");
    expect(h.state.currentItemPenMode).toBe("brush");
    fireEvent.click(screen.getByTestId("button-undo"));
    expect(live()).toHaveLength(1);
  });
  it("offers working fountain, highlighter, dashed and rainbow pens without replacing the canvas", async () => {
    const { container } = await render(
      <Excalidraw UIOptions={{ unifiedToolbar: true }} />,
    );
    const canvas = container.querySelector("canvas.interactive")!;
    act(() => h.app.setActiveTool({ type: "freedraw" }));
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.画笔") }));
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.荧光笔") }));
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.画笔") }));
    fireEvent.change(
      screen.getByRole("slider", { name: t("fcboard.书写粗细") }),
      {
        target: { value: "10" },
      },
    );
    draw(canvas);
    expect(live()[0].opacity).toBe(43);
    expect(live()[0].strokeWidth).toBe(10);
    expect(live()[0].customData?.fcInk.pen).toBe("highlighter");
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.画笔") }));
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.虚线笔") }));
    draw(canvas);
    expect(live().at(-1)!.strokeStyle).toBe("dashed");
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.画笔") }));
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.钢笔") }));
    draw(canvas);
    expect(live().at(-1)!.customData?.fcInk.pen).toBe("brush");
    expect(live().at(-1)!.opacity).toBe(100);
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.画笔") }));
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.彩虹笔") }));
    API.setAppState({ width: 1000, zoom: { value: getNormalizedZoom(2) } });
    draw(canvas);
    const rainbow = live().at(-1)!;
    expect(rainbow.customData?.fcInk.pen).toBe("rainbow");
    expect(rainbow.customData?.fcInk.rainbow.width).toBe(500);
    expect(rainbow.strokeStyle).toBe("solid");
  });

  it("ignores a second writing contact in explicit single mode without starting a pinch", async () => {
    const { container } = await render(
      <Excalidraw UIOptions={{ unifiedToolbar: true }} />,
    );
    const canvas = container.querySelector("canvas.interactive")!;
    API.setAppState({ multiStroke: false });
    act(() => h.app.setActiveTool({ type: "freedraw" }));
    const zoom = h.state.zoom.value;
    pointer(canvas, "pointerdown", 100, 200, {
      pointerType: "touch",
      pointerId: 1,
    });
    pointer(canvas, "pointerdown", 100, 300, {
      pointerType: "touch",
      pointerId: 2,
    });
    pointer(canvas, "pointermove", 400, 200, {
      pointerType: "touch",
      pointerId: 1,
    });
    pointer(canvas, "pointermove", 600, 300, {
      pointerType: "touch",
      pointerId: 2,
    });
    pointer(canvas, "pointerup", 600, 300, {
      pointerType: "touch",
      pointerId: 2,
    });
    pointer(canvas, "pointerup", 400, 200, {
      pointerType: "touch",
      pointerId: 1,
    });
    expect(live()).toHaveLength(1);
    expect(live()[0].width).toBe(300);
    expect(h.state.zoom.value).toBe(zoom);
  });
  it.each([false, true])(
    "undoes each completed stroke separately with batched lifts: %s",
    async (batched) => {
      const { container } = await render(
        <Excalidraw UIOptions={{ unifiedToolbar: true }} />,
      );
      const canvas = container.querySelector("canvas.interactive")!;
      act(() => h.app.setActiveTool({ type: "freedraw" }));
      expect(
        screen.getByRole("button", { name: t("fcboard.多点书写") }),
      ).toBeInTheDocument();
      const zoom = h.state.zoom.value;
      pointer(canvas, "pointerdown", 100, 200, {
        pointerType: "touch",
        pointerId: 1,
      });
      pointer(canvas, "pointerdown", 100, 300, {
        pointerType: "touch",
        pointerId: 2,
        isPrimary: false,
      });
      pointer(canvas, "pointermove", 400, 200, {
        pointerType: "touch",
        pointerId: 1,
      });
      pointer(canvas, "pointermove", 300, 300, {
        pointerType: "touch",
        pointerId: 2,
        isPrimary: false,
      });
      const finishBoth = () => {
        pointer(canvas, "pointerup", 400, 200, {
          pointerType: "touch",
          pointerId: 1,
        });
        pointer(canvas, "pointermove", 500, 300, {
          pointerType: "touch",
          pointerId: 2,
          isPrimary: false,
        });
        pointer(canvas, "pointerup", 500, 300, {
          pointerType: "touch",
          pointerId: 2,
          isPrimary: false,
        });
      };
      if (batched) {
        act(finishBoth);
      } else {
        finishBoth();
      }
      expect(h.state.zoom.value).toBe(zoom);
      expect(live()).toHaveLength(2);
      expect(live().map((el) => el.width)).toEqual([300, 400]);
      fireEvent.click(screen.getByTestId("button-undo"));
      expect(live()).toHaveLength(1);
      expect(live()[0].width).toBe(300);
      fireEvent.click(screen.getByTestId("button-undo"));
      expect(live()).toHaveLength(0);
      fireEvent.click(screen.getByTestId("button-redo"));
      expect(live()).toHaveLength(1);
      expect(live()[0].width).toBe(300);
      fireEvent.click(screen.getByTestId("button-redo"));
      expect(live()).toHaveLength(2);
    },
  );

  it("cancels only the affected contact while another user keeps writing", async () => {
    const { container } = await render(
      <Excalidraw UIOptions={{ unifiedToolbar: true }} />,
    );
    const canvas = container.querySelector("canvas.interactive")!;
    API.setAppState({ multiStroke: true });
    act(() => h.app.setActiveTool({ type: "freedraw" }));
    pointer(canvas, "pointerdown", 100, 200, {
      pointerType: "touch",
      pointerId: 1,
    });
    pointer(canvas, "pointerdown", 100, 300, {
      pointerType: "touch",
      pointerId: 2,
    });
    pointer(canvas, "pointercancel", 100, 200, {
      pointerType: "touch",
      pointerId: 1,
    });
    pointer(canvas, "pointermove", 400, 300, {
      pointerType: "touch",
      pointerId: 2,
    });
    pointer(canvas, "pointerup", 400, 300, {
      pointerType: "touch",
      pointerId: 2,
    });
    expect(live()).toHaveLength(1);
    expect(live()[0].width).toBe(300);
    fireEvent.click(screen.getByTestId("button-undo"));
    expect(live()).toHaveLength(0);
  });

  it("uses the host device calibration without persisting it as a drawing preference", async () => {
    const { container } = await render(
      <Excalidraw
        UIOptions={{
          unifiedToolbar: true,
          inkProfile: {
            hardPenWidth: 4 / 3,
            brushPenWidth: 5,
            eraserSize: 50,
            palmThreshold: 80 / 3,
          },
        }}
      />,
    );
    const canvas = container.querySelector("canvas.interactive")!;
    draw(canvas);
    expect(live()[0].strokeWidth).toBeCloseTo(
      ((h.state.currentItemStrokeWidth / DEFAULT_ELEMENT_PROPS.strokeWidth) *
        4) /
        3,
    );
    pointer(canvas, "pointerdown", 250, 200, {
      pointerType: "touch",
      width: 30,
      height: 30,
    });
    expect(live()).toHaveLength(2);
    expect(h.state.activeTool.type).toBe("freedraw");
    pointer(canvas, "pointerup", 250, 200);
  });
  it("erases only the middle of handwriting and undoes the entire eraser gesture once", async () => {
    const { container } = await render(
      <Excalidraw UIOptions={{ unifiedToolbar: true }} />,
    );
    const canvas = container.querySelector("canvas.interactive")!;
    draw(canvas);
    expect(live()).toHaveLength(1);
    act(() => h.app.setActiveTool({ type: "eraser" }));
    pointer(canvas, "pointerdown", 250, 180);
    pointer(canvas, "pointermove", 250, 220);
    pointer(canvas, "pointerup", 250, 220);
    expect(live()).toHaveLength(2);
    expect(live().every((element) => element.type === "freedraw")).toBe(true);
    expect(container.querySelector(".fc-eraser-preview")).toBeNull();
    fireEvent.click(screen.getByTestId("button-undo"));
    expect(live()).toHaveLength(1);
    const restored = live()[0];
    expect(restored.type === "freedraw" && restored.points.at(-1)![0]).toBe(
      300,
    );
    fireEvent.click(screen.getByTestId("button-redo"));
    expect(live()).toHaveLength(2);
  });
  it("uses a large touch contact to erase temporarily and cancels safely", async () => {
    const { container } = await render(
      <Excalidraw UIOptions={{ unifiedToolbar: true }} />,
    );
    const canvas = container.querySelector("canvas.interactive")!;
    draw(canvas);
    pointer(canvas, "pointerdown", 250, 200, {
      pointerType: "touch",
      width: 70,
      height: 80,
    });
    expect(live()).toHaveLength(2);
    expect(h.state.activeTool.type).toBe("freedraw");
    pointer(canvas, "pointercancel", 250, 200, {
      pointerType: "touch",
      width: 70,
      height: 80,
    });
    expect(live()).toHaveLength(1);
    expect(container.querySelector(".fc-eraser-preview")).toBeNull();
    pointer(canvas, "pointerdown", 250, 200, {
      pointerType: "touch",
      width: 70,
      height: 80,
    });
    pointer(canvas, "pointerup", 250, 200, {
      pointerType: "touch",
      width: 70,
      height: 80,
    });
    expect(live()).toHaveLength(2);
    expect(h.state.activeTool.type).toBe("freedraw");
  });
  it("keeps coalesced handwriting samples and a consistent screen width across zoom and DPR", async () => {
    const { container } = await render(
      <Excalidraw UIOptions={{ unifiedToolbar: true }} />,
    );
    const canvas = container.querySelector("canvas.interactive")!;
    for (const [zoom, dpr] of [
      [1, 1],
      [2, 2],
      [0.5, 3],
    ]) {
      vi.stubGlobal("devicePixelRatio", dpr);
      API.setAppState({ zoom: { value: getNormalizedZoom(zoom) } });
      act(() => h.app.setActiveTool({ type: "freedraw" }));
      pointer(canvas, "pointerdown", 100, 200);
      pointer(canvas, "pointermove", 160, 220, {
        getCoalescedEvents: () => [
          { clientX: 120, clientY: 205, pressure: 0.5 },
          { clientX: 140, clientY: 215, pressure: 0.5 },
        ],
      });
      pointer(canvas, "pointerup", 160, 220);
      const ink = live().at(-1)!;
      expect(ink.type).toBe("freedraw");
      if (ink.type !== "freedraw") {
        throw new Error("Expected ink");
      }
      expect(ink.points.length).toBeGreaterThanOrEqual(4);
      expect(ink.strokeWidth * zoom).toBeCloseTo(
        (h.state.currentItemStrokeWidth / DEFAULT_ELEMENT_PROPS.strokeWidth) *
          4,
      );
      expect(ink.customData?.fcInk.pen).toBe("hard");
    }
    vi.unstubAllGlobals();
  });

  it("promotes a growing touch contact to an eraser without retaining its initial false pen mark", async () => {
    const { container } = await render(
      <Excalidraw UIOptions={{ unifiedToolbar: true }} />,
    );
    const canvas = container.querySelector("canvas.interactive")!;
    draw(canvas);
    pointer(canvas, "pointerdown", 250, 200, {
      pointerType: "touch",
      width: 8,
      height: 8,
    });
    pointer(canvas, "pointermove", 250, 205, {
      pointerType: "touch",
      width: 70,
      height: 80,
    });
    pointer(canvas, "pointerup", 250, 205, {
      pointerType: "touch",
      width: 70,
      height: 80,
    });
    expect(live()).toHaveLength(2);
    expect(h.state.newElement).toBeNull();
    expect(h.state.activeTool.type).toBe("freedraw");
    fireEvent.click(screen.getByTestId("button-undo"));
    expect(live()).toHaveLength(1);
  });

  it("erases immediately with a stylus barrel button and preserves the writing tool", async () => {
    const { container } = await render(
      <Excalidraw UIOptions={{ unifiedToolbar: true }} />,
    );
    const canvas = container.querySelector("canvas.interactive")!;
    draw(canvas);
    pointer(canvas, "pointerdown", 250, 200, {
      pointerType: "pen",
      button: 2,
      buttons: 2,
    });
    pointer(canvas, "pointerup", 250, 200, { pointerType: "pen" });
    expect(live()).toHaveLength(2);
    expect(h.state.activeTool.type).toBe("freedraw");
  });
});
