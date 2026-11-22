import { watchNativeProjection, nativeProtocols } from "./nativeProjection";

import type { NativeReceivers } from "./nativeProjection";

const bridge = vi.hoisted(() => ({
  status: vi.fn(),
  addListener: vi.fn(),
  position: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ registerPlugin: () => bridge }));

it("displays the first ready native frame and hands the surface to the newer connection", async () => {
  let change!: (event: { session: string }) => void;
  const remove = vi.fn();
  bridge.addListener.mockImplementation(async (_event, listener) => {
    change = listener;
    return { remove };
  });
  const receivers = Object.fromEntries(
    nativeProtocols.map((protocol) => [
      protocol,
      {
        state: "waiting",
        revision: 0,
        hasFrames: false,
        audio: false,
        width: 1280,
        height: 720,
        name: "",
        title: "",
      },
    ]),
  ) as NativeReceivers;
  bridge.status.mockImplementation(async () => receivers);
  const display = vi.fn();
  const ended = vi.fn();
  const stop = watchNativeProjection(
    "board",
    vi.fn(),
    () => true,
    display,
    ended,
    vi.fn(),
  );
  await vi.waitFor(() => expect(bridge.status).toHaveBeenCalledTimes(1));
  Object.assign(receivers.airplay, { state: "connected", revision: 3 });
  change({ session: "board" });
  await Promise.resolve();
  expect(display).not.toHaveBeenCalled();
  receivers.airplay.hasFrames = true;
  change({ session: "board" });
  await vi.waitFor(() =>
    expect(display).toHaveBeenCalledWith("airplay", expect.anything(), 3),
  );
  Object.assign(receivers.dlna, {
    state: "connected",
    revision: 4,
    hasFrames: true,
  });
  change({ session: "board" });
  await vi.waitFor(() =>
    expect(display).toHaveBeenLastCalledWith("dlna", expect.anything(), 4),
  );
  expect(ended).toHaveBeenCalledWith("airplay", true);
  stop();
  expect(ended).toHaveBeenLastCalledWith("dlna", false);
  await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
});
