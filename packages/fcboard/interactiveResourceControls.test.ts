import { interactiveResource } from "../../app/fcboard/test/interactiveResource";

import { resourceFrame } from "./tests/resourceFrame";

import { requestResourceControl } from "./interactiveResourceControls";

const target = {
  surface: "whiteboard" as const,
  id: "lesson",
  html: interactiveResource.html,
};
const options = { current: () => true };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("waits for the actual frame, changes its input and reads the computed output, then resets it", async () => {
  const pending = requestResourceControl(target, { type: "inspect" }, options);
  const frame = resourceFrame(target);
  try {
    expect(frame.post).not.toHaveBeenCalled();
    frame.loaded();
    const initial = await pending;
    const force = initial.controls.find((item) => item.type === "range")!;
    expect(force).toMatchObject({
      label: "Force (N)",
      min: "0",
      max: "20",
      value: "4",
    });
    expect(initial.outputs).toEqual(["2 m/s²"]);
    const updated = await requestResourceControl(
      target,
      {
        type: "set",
        version: initial.version,
        control: force.id,
        value: 10,
      },
      options,
    );
    expect(updated.outputs).toEqual(["5 m/s²"]);
    expect(
      frame.window.document.querySelector("#block")?.getAttribute("x"),
    ).toBe("150");
    const reset = updated.controls.find((item) => item.label === "Reset")!;
    expect(
      (
        await requestResourceControl(
          target,
          {
            type: "click",
            version: updated.version,
            control: reset.id,
          },
          options,
        )
      ).outputs,
    ).toEqual(["2 m/s²"]);
  } finally {
    frame.dispose();
  }
});

it("rejects stale versions, out-of-range/step values and unavailable controls without changing output", async () => {
  const frame = resourceFrame(target);
  frame.loaded();
  try {
    const initial = await requestResourceControl(
      target,
      { type: "inspect" },
      options,
    );
    const force = initial.controls.find((item) => item.type === "range")!;
    for (const value of [21, -1, 10.5, "not a number", true]) {
      await expect(
        requestResourceControl(
          target,
          {
            type: "set",
            version: initial.version,
            control: force.id,
            value,
          },
          options,
        ),
      ).rejects.toThrow("RESOURCE_INVALID_VALUE");
    }
    await expect(
      requestResourceControl(
        target,
        {
          type: "set",
          version: "old",
          control: force.id,
          value: 10,
        },
        options,
      ),
    ).rejects.toThrow("RESOURCE_STALE_CONTROL");
    frame.window.document.querySelector("input")!.disabled = true;
    await expect(
      requestResourceControl(
        target,
        {
          type: "set",
          version: initial.version,
          control: force.id,
          value: 10,
        },
        options,
      ),
    ).rejects.toThrow("RESOURCE_CONTROL_UNAVAILABLE");
    expect(frame.window.document.querySelector("output")?.textContent).toBe(
      "2 m/s²",
    );
  } finally {
    frame.dispose();
  }
});

it("validates actual select options and checkbox types, and never exposes hidden/file/password controls", async () => {
  const html = interactiveResource.html.replace(
    "<h1>",
    `<input type="hidden"><input type="file"><input type="password"><input hidden><button style="display:none">Hidden</button>
  <label>Mode<select id="mode"><option value="a">A</option><option value="b">B</option><optgroup disabled><option value="c">C</option></optgroup></select></label>
  <label>Show force<input id="show" type="checkbox"></label><input id="readonly" value="result" readonly><h1>`,
  );
  const local = { ...target, html };
  const frame = resourceFrame(local);
  frame.loaded();
  try {
    const initial = await requestResourceControl(
      local,
      { type: "inspect" },
      options,
    );
    expect(
      initial.controls.filter((item) => item.type !== "graphic"),
    ).toHaveLength(5);
    const readonly = initial.controls.find((item) => item.type === "text")!;
    expect(readonly.disabled).toBe(true);
    await expect(
      requestResourceControl(
        local,
        {
          type: "set",
          version: initial.version,
          control: readonly.id,
          value: "changed",
        },
        options,
      ),
    ).rejects.toThrow("RESOURCE_CONTROL_UNAVAILABLE");
    expect(
      frame.window.document.querySelector<HTMLInputElement>("#readonly")?.value,
    ).toBe("result");
    const mode = initial.controls.find((item) => item.type === "select")!;
    const checkbox = initial.controls.find((item) => item.type === "checkbox")!;
    for (const value of ["missing", "c"]) {
      await expect(
        requestResourceControl(
          local,
          {
            type: "set",
            version: initial.version,
            control: mode.id,
            value,
          },
          options,
        ),
      ).rejects.toThrow("RESOURCE_INVALID_VALUE");
    }
    const updated = await requestResourceControl(
      local,
      {
        type: "set",
        version: initial.version,
        control: mode.id,
        value: "b",
      },
      options,
    );
    expect(updated.controls.find((item) => item.id === mode.id)?.value).toBe(
      "b",
    );
    await expect(
      requestResourceControl(
        local,
        {
          type: "set",
          version: initial.version,
          control: checkbox.id,
          value: "true",
        },
        options,
      ),
    ).rejects.toThrow("RESOURCE_INVALID_VALUE");
    expect(
      (
        await requestResourceControl(
          local,
          {
            type: "set",
            version: initial.version,
            control: checkbox.id,
            value: true,
          },
          options,
        )
      ).controls.find((item) => item.id === checkbox.id)?.value,
    ).toBe(true);
  } finally {
    frame.dispose();
  }
});

it("discovers SVG graphics and drags the actual experiment through pointer capture, then reports its measured output and bounds", async () => {
  const local = {
    ...target,
    html: interactiveResource.html.replace(
      "</script>",
      `
const block = document.getElementById('block');
block.setAttribute('aria-label', 'Draggable mass');
let dragging;
block.addEventListener('pointerdown', event => {
  event.preventDefault();
  dragging = { x: event.clientX, force: Number(force.value) };
  block.setPointerCapture(event.pointerId);
});
block.addEventListener('pointermove', event => {
  if (dragging && block.hasPointerCapture(event.pointerId)) {
    force.value = String(dragging.force + Math.round((event.clientX - dragging.x) / 10));
    force.dispatchEvent(new Event('input'));
  }
});
block.addEventListener('pointerup', event => {
  block.releasePointerCapture(event.pointerId);
  dragging = undefined;
});
block.addEventListener('click', () => { force.value = '8'; update(); });
</script>`,
    ),
  };
  const frame = resourceFrame(local);
  frame.loaded();
  const block = frame.window.document.querySelector<SVGElement>("#block")!;
  vi.spyOn(block, "getBoundingClientRect").mockImplementation(() => ({
    x: Number(block.getAttribute("x")),
    y: 20,
    width: 40,
    height: 40,
    top: 20,
    bottom: 60,
    left: Number(block.getAttribute("x")),
    right: Number(block.getAttribute("x")) + 40,
    toJSON: () => ({}),
  }));
  const descriptor = Object.getOwnPropertyDescriptor(
    frame.window.Element.prototype,
    "setPointerCapture",
  );
  try {
    const initial = await requestResourceControl(
      local,
      { type: "inspect" },
      options,
    );
    const graphic = initial.controls.find(
      (item) => item.label === "Draggable mass",
    )!;
    expect(initial.viewport).toEqual({ width: 1024, height: 768 });
    expect(graphic).toMatchObject({
      type: "graphic",
      kind: "rect",
      bounds: { x: 60, y: 20, width: 40, height: 40 },
    });
    const updated = await requestResourceControl(
      local,
      {
        type: "drag",
        version: initial.version,
        control: graphic.id,
        to: { x: 140, y: 40 },
      },
      options,
    );
    expect(updated.outputs).toEqual(["5 m/s²"]);
    expect(
      updated.controls.find((item) => item.id === graphic.id)?.bounds,
    ).toEqual({
      x: 150,
      y: 20,
      width: 40,
      height: 40,
    });
    expect(
      Object.getOwnPropertyDescriptor(
        frame.window.Element.prototype,
        "setPointerCapture",
      ),
    ).toEqual(descriptor);
    const clicked = await requestResourceControl(
      local,
      { type: "click", version: updated.version, control: graphic.id },
      options,
    );
    expect(clicked.outputs).toEqual(["4 m/s²"]);
    const unchanged = clicked.outputs;
    for (const request of [
      { type: "drag" as const, from: { x: 0, y: 0 }, to: { x: 200, y: 40 } },
      { type: "drag" as const, to: { x: 2000, y: 40 } },
    ]) {
      await expect(
        requestResourceControl(
          local,
          {
            ...request,
            version: updated.version,
            control: graphic.id,
          },
          options,
        ),
      ).rejects.toThrow("RESOURCE_INVALID_POINT");
    }
    expect(
      (await requestResourceControl(local, { type: "inspect" }, options))
        .outputs,
    ).toEqual(unchanged);
    block.remove();
    await expect(
      requestResourceControl(
        local,
        {
          type: "drag",
          version: updated.version,
          control: graphic.id,
          to: { x: 200, y: 40 },
        },
        options,
      ),
    ).rejects.toThrow("RESOURCE_CONTROL_UNAVAILABLE");
  } finally {
    frame.dispose();
  }
});

it("clicks and drags a canvas-only demonstration using iframe coordinates without inventing native controls", async () => {
  const local = {
    ...target,
    html: `<html><body><h1>Position experiment</h1><canvas aria-label="Position" width="400" height="200"></canvas><output>0</output><script>
const canvas = document.querySelector('canvas');
let dragging = false;
canvas.addEventListener('pointerdown', event => { dragging = true; canvas.setPointerCapture(event.pointerId); });
canvas.addEventListener('pointermove', event => { if (dragging) document.querySelector('output').textContent = String(event.clientX - 10); });
canvas.addEventListener('pointerup', event => { dragging = false; canvas.releasePointerCapture(event.pointerId); });
canvas.addEventListener('click', () => { document.querySelector('output').textContent = 'clicked'; });
</script></body></html>`,
  };
  const frame = resourceFrame(local);
  frame.loaded();
  const canvas = frame.window.document.querySelector("canvas")!;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    x: 10,
    y: 20,
    width: 400,
    height: 200,
    left: 10,
    top: 20,
    right: 410,
    bottom: 220,
    toJSON: () => ({}),
  });
  try {
    const state = await requestResourceControl(
      local,
      { type: "inspect" },
      options,
    );
    expect(state.controls).toHaveLength(1);
    expect(state.controls[0]).toMatchObject({
      type: "graphic",
      kind: "canvas",
      label: "Position",
    });
    const dragged = await requestResourceControl(
      local,
      {
        type: "drag",
        version: state.version,
        control: state.controls[0].id,
        from: { x: 30, y: 40 },
        to: { x: 130, y: 40 },
      },
      options,
    );
    expect(dragged.outputs).toEqual(["120"]);
    expect(
      (
        await requestResourceControl(
          local,
          {
            type: "click",
            version: state.version,
            control: state.controls[0].id,
          },
          options,
        )
      ).outputs,
    ).toEqual(["clicked"]);
  } finally {
    frame.dispose();
  }
});

it("pages through every inspected graphic and keeps later-page ids usable without allowing guessed controls", async () => {
  const local = {
    ...target,
    html: interactiveResource.html.replace(
      '<svg viewBox="0 0 400 100">',
      `<svg viewBox="0 0 400 100">${Array.from(
        { length: 95 },
        (_, i) =>
          `<circle aria-label="Particle ${i}" cx="${i}" cy="20" r="2"/>`,
      ).join("")}`,
    ),
  };
  const frame = resourceFrame(local);
  frame.loaded();
  try {
    const first = await requestResourceControl(
      local,
      { type: "inspect" },
      options,
    );
    expect(first).toMatchObject({ offset: 0, total: 99, truncated: true });
    expect(first.controls).toHaveLength(80);
    await expect(
      requestResourceControl(
        local,
        {
          type: "click",
          version: first.version,
          control: "c81",
        },
        options,
      ),
    ).rejects.toThrow("RESOURCE_CONTROL_UNAVAILABLE");
    const second = await requestResourceControl(
      local,
      { type: "inspect", offset: 80 },
      options,
    );
    expect(second).toMatchObject({ offset: 80, total: 99 });
    expect(second.controls).toHaveLength(19);
    const reset = second.controls.find((item) => item.label === "Reset")!;
    const updated = await requestResourceControl(
      local,
      {
        type: "click",
        version: second.version,
        control: reset.id,
      },
      options,
    );
    expect(updated).toMatchObject({ offset: 80, outputs: ["2 m/s²"] });
    expect(updated.controls.find((item) => item.id === reset.id)?.label).toBe(
      "Reset",
    );
    for (const offset of [-1, 0.5, 99]) {
      await expect(
        requestResourceControl(local, { type: "inspect", offset }, options),
      ).rejects.toThrow("RESOURCE_INVALID_OFFSET");
    }
  } finally {
    frame.dispose();
  }
});

it("cancels pending loading and closes disposed/reloaded channels instead of reporting success", async () => {
  const controller = new AbortController();
  const loading = requestResourceControl(
    target,
    { type: "inspect" },
    { ...options, signal: controller.signal },
  );
  controller.abort();
  await expect(loading).rejects.toMatchObject({ name: "AbortError" });
  const frame = resourceFrame(target);
  frame.loaded();
  frame.post.mockImplementation(() => {});
  try {
    const pending = requestResourceControl(
      target,
      { type: "inspect" },
      options,
    );
    frame.loaded();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const again = requestResourceControl(target, { type: "inspect" }, options);
    frame.dispose();
    await expect(again).rejects.toMatchObject({ name: "AbortError" });
  } finally {
    frame.dispose();
  }
});

it("rejects forged sender messages before any experiment action", async () => {
  const frame = resourceFrame(target);
  try {
    const port = { postMessage: vi.fn(), close: vi.fn() };
    frame.window.dispatchEvent(
      new frame.window.MessageEvent("message", {
        source: window,
        data: { type: "fc-resource-control-v1", request: { type: "inspect" } },
        ports: [port as unknown as MessagePort],
      }),
    );
    expect(port.postMessage).not.toHaveBeenCalled();
  } finally {
    frame.dispose();
  }
});

it("rejects missing or ambiguous objects and changed visible targets", async () => {
  vi.useFakeTimers();
  const missing = requestResourceControl(target, { type: "inspect" }, options);
  const rejection = expect(missing).rejects.toThrow("RESOURCE_NOT_READY");
  await vi.advanceTimersByTimeAsync(5000);
  await rejection;
  const first = resourceFrame(target);
  const second = resourceFrame(target);
  try {
    await expect(
      requestResourceControl(target, { type: "inspect" }, options),
    ).rejects.toThrow("RESOURCE_AMBIGUOUS_OBJECT");
    await expect(
      requestResourceControl(
        target,
        { type: "inspect" },
        { current: () => false },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(first.post).not.toHaveBeenCalled();
    expect(second.post).not.toHaveBeenCalled();
  } finally {
    first.dispose();
    second.dispose();
  }
});
