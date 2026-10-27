import { createRequire } from "node:module";

import runtime from "../../android/app/src/main/assets/web-controls.js?raw";

const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (
    html: string,
    options: { runScripts: "dangerously"; url: string },
  ) => {
    window: Window &
      typeof globalThis & {
        fcNativeWebControls: (args: Record<string, unknown>) => string;
      };
  };
};

const page = () => {
  const dom = new JSDOM(
    `<title>Newton's second law</title><h1>Force and acceleration</h1>
<label>Force<input id="force" type="range" min="0" max="20" step="2" value="4"></label>
<label>Mass<select id="mass"><option value="2">2 kg</option><option value="4">4 kg</option><option value="0" disabled>Unavailable</option></select></label>
<button id="reset">Reset</button><button id="disabled" disabled>Disabled</button>
<input aria-label="Password" type="password" value="hidden-password">
<input aria-label="API key" name="api_key" value="private-token">
<label>Private token<textarea name="token">textarea-secret</textarea></label>
<div contenteditable="true">editable-secret</div>
<output id="acceleration"></output>`,
    { runScripts: "dangerously", url: "https://example.test/newton" },
  );
  const { window } = dom;
  Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
    value: () => ({ x: 0, y: 0, width: 120, height: 30 }),
  });
  const force = window.document.querySelector<HTMLInputElement>("#force")!;
  const mass = window.document.querySelector<HTMLSelectElement>("#mass")!;
  const output = window.document.querySelector("output")!;
  const update = () => {
    output.textContent = `${Number(force.value) / Number(mass.value)} m/s²`;
  };
  force.addEventListener("input", update);
  mass.addEventListener("change", update);
  window.document.querySelector("#reset")!.addEventListener("click", () => {
    force.value = "4";
    update();
  });
  update();
  window.eval(runtime);
  type State = {
    version: string;
    text: string;
    error?: string;
    total: number;
    offset: number;
    truncated: boolean;
    controls: {
      id: string;
      label: string;
      value?: string;
      sensitive?: boolean;
      hasValue?: boolean;
    }[];
  };
  return {
    window,
    force,
    read: (args: Record<string, unknown> = { action: "read" }) =>
      JSON.parse(window.fcNativeWebControls(args)) as State,
    dispose: () => window.close(),
  };
};

it("uses actual DOM controls and reports the measured result after set, select and click", () => {
  const browser = page();
  try {
    let state = browser.read();
    const force = state.controls.find((item) => item.label === "Force")!;
    state = browser.read({
      action: "set",
      control: force.id,
      version: state.version,
      value: 12,
    });
    expect(browser.force.value).toBe("12");
    expect(state.text).toContain("6 m/s²");
    const mass = state.controls.find((item) => item.label === "Mass")!;
    state = browser.read({
      action: "set",
      control: mass.id,
      version: state.version,
      value: "4",
    });
    expect(state.text).toContain("3 m/s²");
    const reset = state.controls.find((item) => item.label === "Reset")!;
    state = browser.read({
      action: "click",
      control: reset.id,
      version: state.version,
    });
    expect(state.text).toContain("1 m/s²");
    expect(browser.force.value).toBe("4");
  } finally {
    browser.dispose();
  }
});

it("activates an inspected SVG button through its actual click handler", () => {
  const browser = page();
  try {
    const svg = browser.window.document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    const button = browser.window.document.createElementNS(
      "http://www.w3.org/2000/svg",
      "g",
    );
    button.setAttribute("role", "button");
    button.setAttribute("aria-label", "Double force");
    Object.defineProperty(button, "getBoundingClientRect", {
      value: () => ({ x: 0, y: 0, width: 120, height: 30 }),
    });
    button.addEventListener("click", () => {
      browser.force.value = "8";
      browser.force.dispatchEvent(
        new browser.window.Event("input", { bubbles: true }),
      );
    });
    svg.append(button);
    browser.window.document.body.append(svg);
    const state = browser.read();
    const control = state.controls.find(
      (item) => item.label === "Double force",
    )!;
    const result = browser.read({
      action: "click",
      control: control.id,
      version: state.version,
    });
    expect(result.error).toBeUndefined();
    expect(browser.force.value).toBe("8");
    expect(result.text).toContain("4 m/s²");
  } finally {
    browser.dispose();
  }
});

it("keeps IDs stable across reordering and rejects stale, replaced, hidden or disabled controls", () => {
  const browser = page();
  try {
    const initial = browser.read();
    const force = initial.controls.find((item) => item.label === "Force")!;
    browser.window.document.body.prepend(
      browser.window.document.querySelector("#reset")!,
    );
    const moved = browser.read();
    expect(moved.controls.find((item) => item.label === "Force")!.id).toBe(
      force.id,
    );
    expect(
      browser.read({
        action: "set",
        control: force.id,
        version: initial.version,
        value: 10,
      }).error,
    ).toBe("WEB_STATE_CHANGED_READ_AGAIN");
    const disabled = moved.controls.find((item) => item.label === "Disabled")!;
    expect(
      browser.read({
        action: "click",
        control: disabled.id,
        version: moved.version,
      }).error,
    ).toBe("WEB_CONTROL_UNAVAILABLE");
    browser.force.replaceWith(browser.force.cloneNode(true));
    const replaced = browser.read();
    expect(
      replaced.controls.find((item) => item.label === "Force")!.id,
    ).not.toBe(force.id);
    expect(
      browser.read({
        action: "set",
        control: force.id,
        version: replaced.version,
        value: 10,
      }).error,
    ).toBe("WEB_CONTROL_UNAVAILABLE");
    browser.window.document.querySelector<HTMLElement>("#force")!.hidden = true;
    expect(browser.read().controls.some((item) => item.label === "Force")).toBe(
      false,
    );
  } finally {
    browser.dispose();
  }
});

it("masks existing and explicitly replaced password and API key values", () => {
  const browser = page();
  try {
    let state = browser.read();
    expect(JSON.stringify(state)).not.toMatch(
      /hidden-password|private-token|textarea-secret|editable-secret/,
    );
    for (const label of ["Password", "API key"]) {
      const secret = state.controls.find((item) => item.label === label)!;
      expect(secret).toMatchObject({ sensitive: true, hasValue: true });
      expect(secret.value).toBeUndefined();
      state = browser.read({
        action: "set",
        control: secret.id,
        version: state.version,
        value: "new-secret-123",
      });
      expect(JSON.stringify(state)).not.toContain("new-secret-123");
    }
  } finally {
    browser.dispose();
  }
});

it("paginates all visible controls while keeping inspected IDs valid across pages", () => {
  const browser = page();
  try {
    for (let index = 0; index < 230; index++) {
      const button = browser.window.document.createElement("button");
      button.textContent = `Experiment ${index}`;
      button.addEventListener("click", () => {
        browser.window.document.querySelector(
          "output",
        )!.textContent = `Clicked ${index}`;
      });
      browser.window.document.body.append(button);
    }
    const first = browser.read();
    expect(first).toMatchObject({ offset: 0, truncated: true });
    expect(first.total).toBeGreaterThan(230);
    expect(first.controls).toHaveLength(100);
    const later = browser.read({ action: "read", offset: 200 });
    expect(later.version).toBe(first.version);
    expect(later).toMatchObject({ offset: 200, truncated: false });
    const target = later.controls.find(
      (item) => item.label === "Experiment 229",
    )!;
    expect(
      browser.read({
        action: "click",
        control: target.id,
        version: later.version,
      }).text,
    ).toContain("Clicked 229");
    const current = browser.read({ action: "read", offset: 0 });
    const force = current.controls.find((item) => item.label === "Force")!;
    expect(
      browser.read({
        action: "set",
        control: force.id,
        version: current.version,
        value: 12,
      }).text,
    ).toContain("6 m/s²");
  } finally {
    browser.dispose();
  }
});

it.each([
  ["Force", 21, "WEB_VALUE_OUT_OF_RANGE"],
  ["Force", 3, "WEB_VALUE_OFF_STEP"],
  ["Mass", "0", "WEB_OPTION_UNAVAILABLE"],
])(
  "rejects invalid %s values without changing the actual DOM",
  (label, value, error) => {
    const browser = page();
    try {
      const before = browser.read();
      const control = before.controls.find((item) => item.label === label)!;
      expect(
        browser.read({
          action: "set",
          control: control.id,
          version: before.version,
          value,
        }).error,
      ).toBe(error);
      expect(browser.force.value).toBe("4");
    } finally {
      browser.dispose();
    }
  },
);
