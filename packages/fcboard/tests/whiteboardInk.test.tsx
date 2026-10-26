import { t } from "@excalidraw/excalidraw/i18n";
import { factoryBrushWidths } from "@excalidraw/element/factoryBrush";

import { DEFAULT_ELEMENT_PROPS } from "@excalidraw/common";

import type { ExcalidrawFreeDrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { getNormalizedZoom } from "../scene";

import { API } from "./helpers/api";
import { act, fireEvent, render, screen, within } from "./test-utils";

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
  it("switches local and whole-object erasing through buttons rather than an editable field", async () => {
    await render(<Excalidraw UIOptions={{ unifiedToolbar: true }} />);
    const eraser = screen.getByRole("button", {
      name: t("toolBar.eraser"),
    });
    fireEvent.click(eraser);
    fireEvent.click(eraser);
    fireEvent.click(screen.getByText(t("fcboard.touch_and_eraser_settings")));
    fireEvent.click(
      within(
        screen.getByRole("group", { name: t("fcboard.erase_mode") }),
      ).getByRole("button", { name: t("fcboard.erase_entire_object") }),
    );
    expect(h.state.eraserMode).toBe("object");
    fireEvent.click(eraser);
    fireEvent.click(screen.getByText(t("fcboard.touch_and_eraser_settings")));
    fireEvent.click(
      screen.getByRole("button", {
        name: t("fcboard.erase_part_of_a_stroke"),
      }),
    );
    expect(h.state.eraserMode).toBe("stroke");
    expect(
      screen.queryByRole("textbox", { name: t("fcboard.erase_mode") }),
    ).toBeNull();
  });
  it.each([false, true])(
    "finishes fountain tips only on lift in multi-stroke mode %s",
    async (multiStroke) => {
      const { container } = await render(
        <Excalidraw UIOptions={{ unifiedToolbar: true }} />,
      );
      const canvas = container.querySelector("canvas.interactive")!;
      act(() => {
        API.setAppState({ currentItemPenMode: "brush", multiStroke });
        h.app.setActiveTool({ type: "freedraw" });
      });
      const current = () => live()[0] as ExcalidrawFreeDrawElement;
      pointer(canvas, "pointerdown", 100, 200, { pointerType: "pen" });
      pointer(canvas, "pointermove", 200, 200, {
        pointerType: "pen",
        pressure: 0.8,
      });
      pointer(canvas, "pointermove", 200, 200, {
        pointerType: "pen",
        pressure: 0.2,
      });
      expect(current().pressures.slice(-2)).toEqual([0.8, 0.2]);
      expect(factoryBrushWidths(current()).at(-1)).toBeGreaterThan(0);
      pointer(canvas, "pointerup", 250, 220, {
        pointerType: "pen",
        pressure: 0,
        getCoalescedEvents: () => [
          { clientX: 225, clientY: 210, pressure: 0.1 },
        ],
      });
      expect(current().points.slice(-2)).toEqual([
        [125, 10],
        [150, 20],
      ]);
      expect(current().pressures.slice(-2)).toEqual([0.1, 0]);
      expect(current().customData?.fcInk.finished).toBe(true);
      expect(factoryBrushWidths(current()).at(-1)).toBe(0);
      const completed = current();
      fireEvent.click(screen.getByTestId("button-undo"));
      expect(live()).toHaveLength(0);
      fireEvent.click(screen.getByTestId("button-redo"));
      expect(current().points).toEqual(completed.points);
      expect(factoryBrushWidths(current()).at(-1)).toBe(0);
    },
  );

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
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.pen") }));
    let settings = screen.getByRole("dialog", {
      name: t("fcboard.pen_and_object_properties"),
    });
    const thickness = settings.querySelector("input[type='range']")!;
    expect(thickness).toHaveAttribute("min", "2");
    expect(thickness).toHaveAttribute("max", "20");
    expect(thickness).toHaveAttribute("step", "1");
    fireEvent.change(thickness, { target: { value: "8" } });
    fireEvent.click(
      settings.querySelector(`button[aria-label='${t("fcboard.fountain")}']`)!,
    );
    pointer(canvas, "pointerdown", 100, 250);
    pointer(canvas, "pointermove", 200, 250);
    pointer(canvas, "pointerup", 200, 250);
    expect(live().at(-1)!.strokeWidth).toBeCloseTo(15);
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.pen") }));
    settings = screen.getByRole("dialog", {
      name: t("fcboard.pen_and_object_properties"),
    });
    fireEvent.change(settings.querySelector("input[type='range']")!, {
      target: { value: "20" },
    });
    fireEvent.click(
      settings.querySelector(`button[aria-label='${t("fcboard.pen")}']`)!,
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
  it.each([0.5, 1, 2])(
    "converts provisional single-touch ink to a pinch at zoom %s without leaving a stroke or undo entry",
    async (zoom) => {
      const { container } = await render(
        <Excalidraw UIOptions={{ unifiedToolbar: true }} />,
      );
      const canvas = container.querySelector("canvas.interactive")!;
      act(() => {
        API.setAppState({
          multiStroke: false,
          penMode: true,
          zoom: { value: getNormalizedZoom(zoom) },
        });
        h.app.setActiveTool({ type: "freedraw" });
      });
      const touch = (type: string, id: number, x: number, y: number) =>
        pointer(canvas, type, x, y, { pointerId: id, pointerType: "touch" });
      touch("pointerdown", 71, 100, 100);
      touch("pointermove", 71, 120, 100);
      expect(live()).toHaveLength(1);
      touch("pointerdown", 72, 320, 100);
      expect(live()).toHaveLength(0);
      touch("pointermove", 72, 220, 100);
      expect(h.state.zoom.value).toBeCloseTo(Math.max(0.5, zoom / 2));
      const beforeThird = h.state.zoom.value;
      touch("pointerdown", 73, 120, 300);
      expect(h.state.zoom.value).toBe(beforeThird);
      touch("pointermove", 73, 120, 500);
      expect(h.state.zoom.value).toBeGreaterThan(beforeThird);
      expect(live()).toHaveLength(0);
      for (const id of [73, 72, 71]) {
        touch("pointerup", id, 120, 100);
      }
      fireEvent.click(screen.getByTestId("button-undo"));
      expect(live()).toHaveLength(0);
      touch("pointerdown", 74, 150, 250);
      touch("pointermove", 74, 200, 250);
      touch("pointerup", 74, 210, 250);
      expect(live()).toHaveLength(1);
      fireEvent.click(screen.getByTestId("button-undo"));
      expect(live()).toHaveLength(0);
    },
  );
  it("uses every coalesced screen sample to lock single-touch writing at the APK threshold", async () => {
    const { container } = await render(
      <Excalidraw UIOptions={{ unifiedToolbar: true }} />,
    );
    const canvas = container.querySelector("canvas.interactive")!;
    act(() => {
      API.setAppState({ multiStroke: false });
      h.app.setActiveTool({ type: "freedraw" });
    });
    pointer(canvas, "pointerdown", 100, 100, { pointerType: "touch" });
    // Endpoint displacement is zero; the full travelled path is 40 pixels.
    pointer(canvas, "pointermove", 100, 100, {
      pointerType: "touch",
      getCoalescedEvents: () => [
        { clientX: 120, clientY: 100, pressure: 0.5 },
        { clientX: 100, clientY: 100, pressure: 0.5 },
      ],
    });
    pointer(canvas, "pointerdown", 300, 100, {
      pointerId: 2,
      pointerType: "touch",
    });
    pointer(canvas, "pointermove", 500, 100, {
      pointerId: 2,
      pointerType: "touch",
    });
    expect(h.state.zoom.value).toBe(1);
    expect(live()).toHaveLength(1);
    pointer(canvas, "pointerup", 500, 100, {
      pointerId: 2,
      pointerType: "touch",
    });
    pointer(canvas, "pointerup", 150, 100, { pointerType: "touch" });
    expect(live()).toHaveLength(1);
    expect((live()[0] as ExcalidrawFreeDrawElement).points).toContainEqual([
      20, 0,
    ]);
    fireEvent.click(screen.getByTestId("button-undo"));
    expect(live()).toHaveLength(0);
  });
  it.each(["pointercancel", "lostpointercapture", "blur"])(
    "recovers single-touch writing after an early pinch is interrupted by %s",
    async (type) => {
      const { container } = await render(
        <Excalidraw UIOptions={{ unifiedToolbar: true }} />,
      );
      const canvas = container.querySelector("canvas.interactive")!;
      act(() => {
        API.setAppState({ multiStroke: false });
        h.app.setActiveTool({ type: "freedraw" });
      });
      for (const id of [81, 82]) {
        pointer(canvas, "pointerdown", id * 4, 100, {
          pointerId: id,
          pointerType: "touch",
        });
      }
      if (type === "blur") {
        fireEvent(window, new Event(type));
      } else {
        pointer(canvas, type, 324, 100, {
          pointerId: 81,
          pointerType: "touch",
        });
      }
      pointer(canvas, "pointerup", 328, 100, {
        pointerId: 82,
        pointerType: "touch",
      });
      pointer(canvas, "pointerdown", 100, 300, {
        pointerId: 83,
        pointerType: "touch",
      });
      pointer(canvas, "pointermove", 200, 300, {
        pointerId: 83,
        pointerType: "touch",
      });
      pointer(canvas, "pointerup", 200, 300, {
        pointerId: 83,
        pointerType: "touch",
      });
      expect(live()).toHaveLength(1);
      expect(live()[0].width).toBeCloseTo(100);
    },
  );
  it("scales with three and four contacts, and rebases when fingers join or leave", async () => {
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
    const touch = (type: string, id: number, x: number, y: number) =>
      pointer(canvas, type, x, y, { pointerId: id, pointerType: "touch" });
    const view = () => [h.state.zoom.value, h.state.scrollX, h.state.scrollY];
    touch("pointerdown", 31, 100, 100);
    touch("pointerdown", 32, 300, 100);
    const beforeThird = view();
    touch("pointerdown", 33, 100, 300);
    expect(view()).toEqual(beforeThird);
    touch("pointermove", 33, 100, 500);
    expect(h.state.zoom.value).toBeCloseTo(1.5);
    // The same scene point remains below the old/new first-last midpoint.
    expect(100 / h.state.zoom.value - h.state.scrollX).toBeCloseTo(100);
    expect(300 / h.state.zoom.value - h.state.scrollY).toBeCloseTo(200);
    const beforeFourth = view();
    touch("pointerdown", 34, 500, 500);
    expect(view()).toEqual(beforeFourth);
    touch("pointermove", 34, 600, 500);
    const expanded = h.state.zoom.value;
    expect(expanded).toBeGreaterThan(1.5);
    const beforeLift = view();
    touch("pointerup", 34, 600, 500);
    touch("pointerup", 33, 100, 500);
    expect(view()).toEqual(beforeLift);
    touch("pointermove", 32, 250, 100);
    expect(h.state.zoom.value).toBeCloseTo(expanded * 0.75);
    touch("pointerup", 31, 100, 100);
    touch("pointerup", 32, 250, 100);
    expect(live()).toHaveLength(0);
  });

  it("reacquires a valid multi-finger baseline after coincident contacts separate", async () => {
    const { container } = await render(
      <Excalidraw UIOptions={{ unifiedToolbar: true }} />,
    );
    const canvas = container.querySelector("canvas.interactive")!;
    act(() => {
      API.setAppState({ zoom: { value: getNormalizedZoom(1) } });
      h.app.setActiveTool({ type: "hand" });
    });
    for (const id of [51, 52, 53]) {
      pointer(canvas, "pointerdown", 300, 300, {
        pointerId: id,
        pointerType: "touch",
      });
    }
    pointer(canvas, "pointermove", 400, 300, {
      pointerId: 53,
      pointerType: "touch",
    });
    expect(h.state.zoom.value).toBe(1);
    pointer(canvas, "pointermove", 500, 300, {
      pointerId: 53,
      pointerType: "touch",
    });
    expect(h.state.zoom.value).toBe(2);
    pointer(canvas, "pointermove", 480, 300, {
      pointerId: 53,
      pointerType: "touch",
    });
    expect(h.state.zoom.value).toBeCloseTo(1.8);
    for (const id of [51, 52, 53]) {
      pointer(canvas, "pointerup", 300, 300, {
        pointerId: id,
        pointerType: "touch",
      });
    }
  });

  it.each(["pointercancel", "lostpointercapture", "blur", "focus"])(
    "cleans gesture contacts on %s and allows the next single-finger drag",
    async (type) => {
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
      for (const id of [61, 62, 63]) {
        pointer(canvas, "pointerdown", 100 + (id - 61) * 100, 100, {
          pointerId: id,
          pointerType: "touch",
        });
      }
      if (type === "blur" || type === "focus") {
        fireEvent(window, new Event(type));
      } else {
        pointer(canvas, type, 100, 100, {
          pointerId: 61,
          pointerType: "touch",
        });
      }
      pointer(canvas, "pointermove", 900, 900, {
        pointerId: 61,
        pointerType: "touch",
      });
      expect(h.state.zoom.value).toBe(1);
      expect(h.state.scrollX).toBe(0);
      expect(h.state.scrollY).toBe(0);
      for (const id of [62, 63]) {
        pointer(document.body, "pointerup", 200, 100, {
          pointerId: id,
          pointerType: "touch",
        });
      }
      pointer(canvas, "pointerdown", 100, 100, {
        pointerId: 64,
        pointerType: "touch",
      });
      pointer(canvas, "pointermove", 150, 120, {
        pointerId: 64,
        pointerType: "touch",
      });
      pointer(canvas, "pointerup", 150, 120, {
        pointerId: 64,
        pointerType: "touch",
      });
      expect(h.state.scrollX).toBeCloseTo(50);
      expect(h.state.scrollY).toBeCloseTo(20);
      expect(live()).toHaveLength(0);
    },
  );

  it("dismisses tool settings with Escape without cancelling the selected tool", async () => {
    await render(
      <Excalidraw
        handleKeyboardGlobally
        UIOptions={{ unifiedToolbar: true }}
      />,
    );
    const eraser = screen.getByRole("button", { name: t("fcboard.eraser") });
    fireEvent.click(eraser);
    fireEvent.click(eraser);
    fireEvent.keyDown(screen.getByLabelText(t("fcboard.eraser_settings")), {
      key: "Escape",
    });
    expect(
      screen.queryByLabelText(t("fcboard.eraser_settings")),
    ).not.toBeInTheDocument();
    expect(h.state.activeTool.type).toBe("eraser");
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.insert") }));
    fireEvent.keyDown(screen.getByLabelText(t("fcboard.insert_tools")), {
      key: "Escape",
    });
    expect(
      screen.queryByLabelText(t("fcboard.insert_tools")),
    ).not.toBeInTheDocument();
    expect(h.state.activeTool.type).toBe("eraser");
  });
  it("dismisses anchored tool settings when hiding the toolbar and keeps them dismissed after restoring it", async () => {
    await render(<Excalidraw UIOptions={{ unifiedToolbar: true }} />);
    act(() => h.app.setActiveTool({ type: "freedraw" }));
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.pen") }));
    expect(
      screen.getByRole("dialog", {
        name: t("fcboard.pen_and_object_properties"),
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.hide_toolbar") }),
    );
    expect(
      screen.queryByRole("dialog", {
        name: t("fcboard.pen_and_object_properties"),
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.show_toolbar") }),
    );
    expect(
      screen.queryByRole("dialog", {
        name: t("fcboard.pen_and_object_properties"),
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.eraser") }));
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.eraser") }));
    expect(
      screen.getByLabelText(t("fcboard.eraser_settings")),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.hide_toolbar") }),
    );
    expect(
      screen.queryByLabelText(t("fcboard.eraser_settings")),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.show_toolbar") }),
    );
    expect(
      screen.queryByLabelText(t("fcboard.eraser_settings")),
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
    const eraser = screen.getByRole("button", { name: t("fcboard.eraser") });
    fireEvent.click(eraser);
    fireEvent.click(eraser);
    const slider = screen.getByRole("slider", {
      name: t("fcboard.slide_to_clear_this_board"),
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
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.pen") }));
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.highlighter") }),
    );
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.pen") }));
    fireEvent.change(
      screen.getByRole("slider", { name: t("fcboard.pen_thickness") }),
      {
        target: { value: "10" },
      },
    );
    draw(canvas);
    expect(live()[0].opacity).toBe(43);
    expect(live()[0].strokeWidth).toBe(10);
    expect(live()[0].customData?.fcInk.pen).toBe("highlighter");
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.pen") }));
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.dashed_pen") }),
    );
    draw(canvas);
    expect(live().at(-1)!.strokeStyle).toBe("dashed");
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.pen") }));
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.fountain") }),
    );
    draw(canvas);
    expect(live().at(-1)!.customData?.fcInk.pen).toBe("brush");
    expect(live().at(-1)!.opacity).toBe(100);
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.pen") }));
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.rainbow_pen") }),
    );
    API.setAppState({ width: 1000, zoom: { value: getNormalizedZoom(2) } });
    draw(canvas);
    const rainbow = live().at(-1)!;
    expect(rainbow.customData?.fcInk.pen).toBe("rainbow");
    expect(rainbow.customData?.fcInk.rainbow.width).toBe(500);
    expect(rainbow.strokeStyle).toBe("solid");
  });

  it("keeps committed single-touch writing when another contact joins", async () => {
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
    pointer(canvas, "pointermove", 150, 200, {
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
        screen.getByRole("button", { name: t("fcboard.multi_touch_writing") }),
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
