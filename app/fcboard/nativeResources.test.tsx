import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { InteractiveResourceFrame } from "@fcboard/fcboard/components/InteractiveResourceFrame";

import { nativeCalculatorControl } from "./nativeResources";
import { calculatorResource } from "./Calculator";

const backend = vi.hoisted(() => ({
  upsert: vi.fn(),
  remove: vi.fn(),
  control: vi.fn(),
  listeners: new Set<(event: Record<string, unknown>) => void>(),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "android", isNativePlatform: () => true },
  registerPlugin: () => ({
    ...backend,
    addListener: (
      _event: string,
      callback: (event: Record<string, unknown>) => void,
    ) => {
      backend.listeners.add(callback);
      return Promise.resolve({
        remove: async () => {
          backend.listeners.delete(callback);
        },
      });
    },
  }),
}));
beforeEach(() => {
  backend.upsert.mockReset().mockResolvedValue(undefined);
  backend.remove.mockReset().mockResolvedValue(undefined);
  backend.control.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 130,
    bottom: 260,
    width: 120,
    height: 240,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  cleanup();
  backend.listeners.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("mounts native calculator controls before any iframe executes and commits only final native geometry", async () => {
  const commit = vi.fn();
  const close = vi.fn();
  render(
    <InteractiveResourceFrame
      resource={calculatorResource(false)}
      objectId="calc"
      surface="whiteboard"
      window={{
        bounds: { x: 10, y: 20, width: 120, height: 240 },
        scale: 2,
        onCommit: commit,
        onClose: close,
      }}
    />,
  );
  await waitFor(() => expect(backend.upsert).toHaveBeenCalled());
  expect(document.querySelector("iframe")).toBeNull();
  const instance = backend.upsert.mock.calls[0][0].instance;
  act(() =>
    backend.listeners.forEach((listener) =>
      listener({ instance, type: "bounds", dx: 20, dy: 40, dw: 80, dh: 160 }),
    ),
  );
  expect(commit).toHaveBeenCalledWith({
    x: 20,
    y: 40,
    width: 160,
    height: 320,
  });
  backend.control.mockResolvedValue({ version: "1", outputs: ["18"] });
  await expect(
    nativeCalculatorControl("calc", { type: "inspect" }),
  ).resolves.toMatchObject({ outputs: ["18"] });
  expect(backend.control).toHaveBeenCalledWith({
    objectId: "calc",
    type: "inspect",
  });
  act(() =>
    backend.listeners.forEach((listener) =>
      listener({ instance, type: "close" }),
    ),
  );
  expect(close).toHaveBeenCalledTimes(1);
});
it("reports native mount failures and removes the failed native surface", async () => {
  backend.upsert.mockRejectedValue(new Error("native widget unavailable"));
  render(
    <InteractiveResourceFrame
      resource={calculatorResource(false)}
      objectId="broken-calc"
      surface="whiteboard"
      window={{
        bounds: { x: 0, y: 0, width: 120, height: 240 },
        onCommit: vi.fn(),
        onClose: vi.fn(),
      }}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "native widget unavailable",
  );
  expect(document.querySelector("iframe")).toBeNull();
  expect(backend.remove).toHaveBeenCalled();
});

it("passes drawing and erasing contacts through a noninteractive scene host", async () => {
  const host = render(
    <div style={{ pointerEvents: "none" }}>
      <InteractiveResourceFrame
        resource={calculatorResource(false)}
        objectId="drawing-calc"
        surface="whiteboard"
        window={{
          bounds: { x: 10, y: 20, width: 120, height: 240 },
          onCommit: vi.fn(),
          onClose: vi.fn(),
        }}
      />
    </div>,
  );
  await waitFor(() => expect(backend.upsert).toHaveBeenCalled());
  expect(backend.upsert.mock.calls.at(-1)![0].interactive).toBe(false);
  host.rerender(
    <div style={{ pointerEvents: "all" }}>
      <InteractiveResourceFrame
        resource={calculatorResource(false)}
        objectId="drawing-calc"
        surface="whiteboard"
        window={{
          bounds: { x: 10, y: 20, width: 120, height: 240 },
          onCommit: vi.fn(),
          onClose: vi.fn(),
        }}
      />
    </div>,
  );
  await waitFor(() =>
    expect(backend.upsert.mock.calls.at(-1)![0].interactive).toBe(true),
  );
});
