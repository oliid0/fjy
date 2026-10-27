import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { act, fireEvent, screen } from "@testing-library/react";
import Slider from "@mui/material/Slider";
import Switch from "@mui/material/Switch";
import { MaterialSelect } from "@excalidraw/excalidraw/components/MaterialSelect";

import { render } from "./test/render";
import { sceneAPI } from "./test/scene";
import { classroomCommands } from "./commands";
import { registerUICommands } from "./uiControls";

import type { UIControlState } from "./uiControls";

const Harness = () => {
  const [title, setTitle] = useState("Lesson");
  const [secret, setSecret] = useState("session-secret");
  const [token, setToken] = useState("token-secret");
  const [palm, setPalm] = useState(false);
  const [width, setWidth] = useState(2);
  const [mode, setMode] = useState("local");
  const [count, setCount] = useState(0);
  return (
    <div data-testid="editor-root">
      <label>
        Title
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
        />
      </label>
      <label>
        API token
        <input
          name="api_token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </label>
      <label>
        Palm erasing
        <Switch checked={palm} onChange={(_, checked) => setPalm(checked)} />
      </label>
      <Slider
        aria-label="Thickness"
        value={width}
        min={1}
        max={10}
        step={1}
        onChange={(_, value) => setWidth(value)}
      />
      <MaterialSelect
        aria-label="Recognition"
        value={mode}
        onChange={(event) => setMode(event.target.value)}
      >
        <option value="local">Local</option>
        <option value="cloud">Cloud</option>
      </MaterialSelect>
      <button onClick={() => setCount((value) => value + 1)}>Increment</button>
      <button disabled>Unavailable</button>
      <input aria-label="Read only" readOnly value="fixed" />
      <div hidden>
        <button>Hidden</button>
      </div>
      <div className="fc-document-surface">
        <button>External document</button>
      </div>
      <output>
        {title}/{palm ? "palm" : "pen"}/{width}/{mode}/{count}
      </output>
    </div>
  );
};
const setup = (component = <Harness />) => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 20,
    y: 20,
    left: 20,
    top: 20,
    right: 220,
    bottom: 60,
    width: 200,
    height: 40,
    toJSON: () => ({}),
  });
  const view = render(component);
  const root = screen.getByTestId("editor-root");
  const stop = registerUICommands(sceneAPI(), () => root);
  const inspect = () =>
    classroomCommands.execute({
      name: "ui.inspect",
    }) as Promise<UIControlState>;
  const change = async (
    label: string,
    action: string,
    args: Record<string, unknown> = {},
  ) => {
    const state = await inspect();
    const control = state.controls.find((item) => item.label === label)!;
    let next!: UIControlState;
    await act(async () => {
      next = (await classroomCommands.execute({
        name: "ui.interact",
        args: { version: state.version, control: control.id, action, ...args },
      })) as UIControlState;
    });
    return next;
  };
  return { ...view, root, stop, inspect, change };
};
afterEach(() => vi.restoreAllMocks());

it("inspects only visible controls in the owned editor and never returns credential values", async () => {
  const { inspect, stop } = setup();
  try {
    const state = await inspect();
    expect(
      state.controls.some(
        (item) => item.label === "Hidden" || item.label === "External document",
      ),
    ).toBe(false);
    expect(
      state.controls.find((item) => item.label === "Password"),
    ).toMatchObject({ sensitive: true, hasValue: true });
    expect(
      state.controls.find((item) => item.label === "API token"),
    ).toMatchObject({ sensitive: true, hasValue: true });
    expect(JSON.stringify(state)).not.toMatch(/session-secret|token-secret/);
    expect(
      state.controls.find((item) => item.label === "Unavailable")?.actions,
    ).toEqual([]);
  } finally {
    stop();
  }
});

it("changes real React text, MUI switches and slider values, and returns their measured outputs", async () => {
  const { change, stop } = setup();
  try {
    await change("Title", "set", { value: "Newton" });
    expect(screen.getByLabelText("Title")).toHaveValue("Newton");
    await change("Palm erasing", "set", { value: true });
    const state = await change("Thickness", "set", { value: 7 });
    expect(screen.getByLabelText("Thickness")).toHaveValue("7");
    expect(state.outputs).toEqual(["Newton/palm/7/local/0"]);
    await expect(change("Thickness", "set", { value: 50 })).rejects.toThrow(
      "UI_VALUE_OUT_OF_RANGE",
    );
    await expect(
      change("Read only", "set", { value: "changed" }),
    ).rejects.toThrow("UI_CONTROL_DISABLED");
  } finally {
    stop();
  }
});

it("opens the real MUI select and chooses an inspected option rather than mutating aria attributes", async () => {
  const { change, stop } = setup();
  try {
    const open = await change("Recognition", "click");
    const option = open.controls.find(
      (item) => item.role === "option" && item.label === "Cloud",
    );
    expect(option).toBeDefined();
    await act(async () => {
      await classroomCommands.execute({
        name: "ui.interact",
        args: { version: open.version, control: option!.id, action: "click" },
      });
    });
    expect(screen.getByLabelText("Recognition")).toHaveTextContent("Cloud");
    expect(
      (
        (await classroomCommands.execute({
          name: "ui.inspect",
        })) as UIControlState
      ).outputs,
    ).toEqual(["Lesson/pen/2/cloud/0"]);
  } finally {
    stop();
  }
});

it("sets explicit new secrets through React while all returned observations remain masked", async () => {
  const { change, inspect, stop } = setup();
  try {
    const before = await inspect();
    const after = await change("Password", "set", {
      value: "new-user-provided-secret",
    });
    expect(screen.getByLabelText("Password")).toHaveValue(
      "new-user-provided-secret",
    );
    expect(JSON.stringify(after)).not.toContain("new-user-provided-secret");
    expect(after.version).not.toBe(before.version);
    expect(
      after.controls.find((item) => item.label === "Password"),
    ).toMatchObject({ sensitive: true, hasValue: true });
  } finally {
    stop();
  }
});

it("discovers only portals belonging to this editor and invokes real SVG controls", async () => {
  const own = document.createElement("div");
  own.dataset.excalidrawOwner = "owned-editor";
  const other = document.createElement("div");
  other.dataset.excalidrawOwner = "other-editor";
  other.innerHTML = "<button>Other editor</button>";
  document.body.append(own, other);
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 20,
    y: 20,
    left: 20,
    top: 20,
    right: 220,
    bottom: 60,
    width: 200,
    height: 40,
    toJSON: () => ({}),
  });
  const clicked = vi.fn();
  const { root, stop: stopDefault } = setup(
    <div data-testid="editor-root">
      <svg>
        <g role="button" aria-label="Compass handle" onClick={clicked} />
      </svg>
      {createPortal(<button>Owned dialog</button>, own)}
    </div>,
  );
  stopDefault();
  const api = sceneAPI();
  Object.defineProperty(api, "id", { value: "owned-editor" });
  const stop = registerUICommands(api, () => root);
  try {
    const state = (await classroomCommands.execute({
      name: "ui.inspect",
    })) as UIControlState;
    expect(state.controls.map((control) => control.label)).toContain(
      "Owned dialog",
    );
    expect(state.controls.map((control) => control.label)).not.toContain(
      "Other editor",
    );
    const handle = state.controls.find(
      (control) => control.label === "Compass handle",
    )!;
    await act(async () => {
      await classroomCommands.execute({
        name: "ui.interact",
        args: {
          version: state.version,
          control: handle.id,
          action: "click",
        },
      });
    });
    expect(clicked).toHaveBeenCalledTimes(1);
    await act(async () => {
      await classroomCommands.execute({
        name: "ui.interact",
        args: {
          version: state.version,
          control: handle.id,
          action: "key",
          key: "Enter",
        },
      });
    });
    expect(clicked).toHaveBeenCalledTimes(2);
  } finally {
    stop();
    own.remove();
    other.remove();
  }
});

it("reports every control through versioned pages and operates an inspected control beyond the first page", async () => {
  const clicked = vi.fn();
  const { inspect, stop } = setup(
    <div data-testid="editor-root">
      {Array.from({ length: 605 }, (_, index) => (
        <button key={index} onClick={clicked}>{`Control ${index}`}</button>
      ))}
    </div>,
  );
  try {
    const first = await inspect();
    expect(first).toMatchObject({ total: 605, offset: 0, truncated: true });
    expect(first.controls).toHaveLength(600);
    const next = (await classroomCommands.execute({
      name: "ui.inspect",
      args: { offset: 600 },
    })) as UIControlState;
    expect(next).toMatchObject({
      version: first.version,
      total: 605,
      offset: 600,
      truncated: false,
    });
    expect(next.controls).toHaveLength(5);
    await act(async () => {
      await classroomCommands.execute({
        name: "ui.interact",
        args: {
          version: next.version,
          control: next.controls[4].id,
          action: "click",
        },
      });
    });
    expect(clicked).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});

it("rejects stale values, deleted controls, disabled controls and arbitrary selectors before dispatch", async () => {
  const { inspect, root, stop } = setup();
  try {
    const old = await inspect();
    const title = old.controls.find((item) => item.label === "Title")!;
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Manual edit" },
    });
    await expect(
      classroomCommands.execute({
        name: "ui.interact",
        args: {
          version: old.version,
          control: title.id,
          action: "set",
          value: "old",
        },
      }),
    ).rejects.toThrow("UI_STALE_INSPECTION");
    const current = await inspect();
    await expect(
      classroomCommands.execute({
        name: "ui.interact",
        args: {
          version: current.version,
          control: title.id,
          action: "click",
          selector: "body",
        },
      }),
    ).rejects.toThrow("UI_INVALID_OPERATION");
    const disabled = current.controls.find(
      (item) => item.label === "Unavailable",
    )!;
    await expect(
      classroomCommands.execute({
        name: "ui.interact",
        args: {
          version: current.version,
          control: disabled.id,
          action: "click",
        },
      }),
    ).rejects.toThrow("UI_CONTROL_DISABLED");
    root.querySelector<HTMLInputElement>("input")!.hidden = true;
    const hidden = await inspect();
    await expect(
      classroomCommands.execute({
        name: "ui.interact",
        args: {
          version: hidden.version,
          control: title.id,
          action: "set",
          value: "old",
        },
      }),
    ).rejects.toThrow("UI_CONTROL_NOT_VISIBLE");
  } finally {
    stop();
  }
});

const Draggable = ({
  observe,
}: {
  observe: (source?: AbortSignal) => void;
}) => {
  const [x, setX] = useState(0);
  const start = useRef<{ client: number; value: number } | undefined>(
    undefined,
  );
  return (
    <div data-testid="editor-root">
      <button
        aria-label="Move node"
        onPointerDown={(event) => {
          observe(classroomCommands.interactionSource);
          start.current = { client: event.clientX, value: x };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (start.current) {
            setX(start.current.value + event.clientX - start.current.client);
          }
        }}
        onPointerUp={(event) => {
          if (start.current) {
            setX(start.current.value + event.clientX - start.current.client);
          }
          start.current = undefined;
        }}
        onPointerCancel={() => {
          if (start.current) {
            setX(start.current.value);
            start.current = undefined;
          }
        }}
      >
        Move
      </button>
      <output>{x}</output>
    </div>
  );
};
it("drives a real drag with exact command ownership and restores native pointer methods", async () => {
  const observed = vi.fn();
  const { root, change, stop } = setup(<Draggable observe={observed} />);
  const node = root.querySelector("button")!;
  const native = vi.fn(() => {
    throw new DOMException("Synthetic pointer", "NotFoundError");
  });
  Object.defineProperty(node, "setPointerCapture", {
    configurable: true,
    value: native,
  });
  const controller = new AbortController();
  try {
    const state = await change("Move node", "drag", {
      dx: 60,
      dy: 0,
      signal: controller.signal,
    });
    expect(observed).toHaveBeenCalledWith(controller.signal);
    expect(root.querySelector("output")).toHaveTextContent("60");
    expect(state.outputs).toEqual(["60"]);
    expect(classroomCommands.interactionSource).toBeUndefined();
    expect(node.setPointerCapture).toBe(native);
    expect(native).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

it("cancels a drag before the next movement and rolls back instead of committing late", async () => {
  const { inspect, root, stop } = setup(<Draggable observe={() => {}} />);
  const controller = new AbortController();
  try {
    const state = await inspect();
    const node = state.controls.find((item) => item.label === "Move node")!;
    await act(async () => {
      const operation = classroomCommands.execute({
        name: "ui.interact",
        args: {
          version: state.version,
          control: node.id,
          action: "drag",
          dx: 120,
          dy: 0,
          signal: controller.signal,
        },
      });
      controller.abort();
      await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    });
    expect(root.querySelector("output")).toHaveTextContent("0");
    expect(classroomCommands.interactionSource).toBeUndefined();
  } finally {
    stop();
  }
});
