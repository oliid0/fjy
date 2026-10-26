import { resourceFrame } from "../../app/fcboard/test/resourceFrame";
import { interactiveResource } from "../../app/fcboard/test/interactiveResource";

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
    expect(initial.controls).toHaveLength(5);
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
