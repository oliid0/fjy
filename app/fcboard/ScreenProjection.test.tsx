import { act, screen, waitFor } from "@testing-library/react";
import { Capacitor } from "@capacitor/core";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { classroomCommands } from "./commands";
import { nativeProtocols } from "./nativeProjection";
import { ScreenProjection } from "./ScreenProjection";
import { render } from "./test/render";

const native = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  network: vi.fn(),
  watch: vi.fn(),
}));

vi.mock("@capacitor/core", async (original) => ({
  ...(await original<typeof import("@capacitor/core")>()),
  registerPlugin: (name: string) =>
    name === "FcboardProjection"
      ? {
          start: native.start,
          stop: native.stop,
          network: native.network,
          addListener: vi.fn(async () => ({ remove: async () => {} })),
        }
      : undefined,
}));

vi.mock("./nativeProjection", () => ({
  nativeProtocols: ["airplay", "dlna", "cast", "miracast", "castplus"],
  nativeProjection: {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  },
  watchNativeProjection: (...args: unknown[]) => native.watch(...args),
}));

const api = {
  setSceneProjection: vi.fn(),
  onChange: () => () => {},
} as unknown as FcboardImperativeAPI;

afterEach(() => vi.restoreAllMocks());

it("reports unsupported startup from a browser", async () => {
  vi.spyOn(Capacitor, "getPlatform").mockReturnValue("web");
  const view = render(<ScreenProjection api={api} />);
  try {
    await expect(
      classroomCommands.execute({ name: "projection.start" }),
    ).rejects.toThrow();
    expect(native.start).not.toHaveBeenCalled();
    expect(
      await classroomCommands.execute({ name: "projection.inspect" }),
    ).toMatchObject({ phase: "off" });
  } finally {
    view.unmount();
  }
});

it("waits for the receiver and for its real shutdown before reporting off", async () => {
  vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
  native.network.mockResolvedValue({
    address: "192.168.1.8",
    name: "Test",
    transport: "wifi",
  });
  native.watch.mockReturnValue(() => {});
  let ready!: () => void;
  native.start.mockImplementation(
    ({ session }) =>
      new Promise((resolve) => {
        ready = () =>
          resolve({
            session,
            address: "192.168.1.8",
            url: "http://192.168.1.8",
          });
      }),
  );
  let finishStop!: () => void;
  native.stop.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishStop = resolve;
      }),
  );
  const view = render(<ScreenProjection api={api} />);
  try {
    let started!: Promise<unknown>;
    act(() => {
      started = classroomCommands.execute({ name: "projection.start" });
    });
    await waitFor(() => expect(ready).toBeDefined());
    expect(
      await classroomCommands.execute({ name: "projection.inspect" }),
    ).toMatchObject({ phase: "starting" });
    await act(async () => {
      ready();
    });
    await expect(started).resolves.toMatchObject({
      enabled: true,
      phase: "waiting",
    });
    let stopped!: Promise<unknown>;
    const completed = vi.fn();
    act(() => {
      stopped = classroomCommands
        .execute({ name: "projection.stop" })
        .then(completed);
    });
    await waitFor(() => expect(finishStop).toBeDefined());
    expect(completed).not.toHaveBeenCalled();
    expect(nativeProtocols).toHaveLength(5);
    await act(async () => {
      finishStop();
      await stopped;
    });
    expect(completed).toHaveBeenCalledWith({
      open: false,
      enabled: false,
      phase: "off",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  } finally {
    view.unmount();
  }
});
