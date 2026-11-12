import { Capacitor } from "@capacitor/core";

import { createLanSocket } from "./lanSocket";

const transport = vi.hoisted(() => ({
  listen: vi.fn(),
  connect: vi.fn(),
  send: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./network", () => ({
  Network: {
    addListener: transport.listen,
    connectPeer: transport.connect,
    sendPeer: transport.send,
    closePeer: transport.close,
  },
}));

beforeEach(() => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  transport.listen.mockReset();
  transport.connect.mockReset().mockResolvedValue(undefined);
  transport.send.mockReset().mockResolvedValue(undefined);
  transport.close.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

it("connects and exchanges native packets without constructing an insecure browser WebSocket", async () => {
  const remove = vi.fn().mockResolvedValue(undefined);
  transport.listen.mockResolvedValue({ remove });
  const socket = createLanSocket(
    "ws://192.168.0.48:1234/board/0123456789abcdef0123456789abcdef",
  );
  const message = vi.fn();
  const closed = vi.fn();
  socket.onmessage = message;
  socket.onclose = closed;
  await vi.waitFor(() => expect(transport.connect).toHaveBeenCalledTimes(1));
  const { id } = transport.connect.mock.calls[0][0];
  const receive = transport.listen.mock.calls[0][1];
  expect(() => socket.send("before open")).toThrow();
  receive({ id: "another connection", type: "open" });
  expect(socket.readyState).toBe(0);
  receive({ id, type: "open" });
  socket.send("snapshot");
  expect(transport.send).toHaveBeenCalledWith({ id, text: "snapshot" });
  receive({ id, type: "message", text: '{"kind":"initial"}' });
  expect(message.mock.calls[0][0].data).toBe('{"kind":"initial"}');
  socket.close();
  receive({ id, type: "close", code: 1000, text: "" });
  expect(closed).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(transport.close).toHaveBeenCalledWith({ id });
});

it("cancels before listener registration without starting a late native connection", async () => {
  let ready!: (value: { remove: () => Promise<void> }) => void;
  transport.listen.mockReturnValue(
    new Promise((resolve) => {
      ready = resolve;
    }),
  );
  const socket = createLanSocket(
    "ws://board/board/0123456789abcdef0123456789abcdef",
  );
  const remove = vi.fn().mockResolvedValue(undefined);
  socket.close();
  ready({ remove });
  await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  expect(transport.connect).not.toHaveBeenCalled();
  expect(socket.readyState).toBe(3);
});

it("reports a failed native handshake as a reconnectable close and removes the listener", async () => {
  const remove = vi.fn().mockResolvedValue(undefined);
  transport.listen.mockResolvedValue({ remove });
  transport.connect.mockRejectedValue(new Error("offline"));
  const socket = createLanSocket(
    "ws://board/board/0123456789abcdef0123456789abcdef",
  );
  const closed = vi.fn();
  socket.onclose = closed;
  await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
  expect(closed.mock.calls[0][0].code).toBe(1006);
  expect(remove).toHaveBeenCalledTimes(1);
});
