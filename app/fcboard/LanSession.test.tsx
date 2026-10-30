import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transferableAbortController } from "node:util";

import { WebSocket } from "ws";
import { convertToFcboardElements } from "@fcboard/fcboard";

import { Capacitor } from "@capacitor/core";
import { getDefaultAppState } from "@fcboard/fcboard/appState";
import { t } from "@fcboard/fcboard/i18n";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { createShareServer } from "../../services/board-share/server.mjs";

import { render } from "./test/render";
import { LanSession } from "./LanSession";
import { Network } from "./network";
import { classroomCommands } from "./commands";

import type { AddressInfo } from "node:net";

vi.mock("./network", () => ({
  Network: {
    startCollaboration: vi.fn(),
    stopCollaboration: vi.fn(),
    setCollaborationPassword: vi.fn(),
    sendScene: vi.fn(),
    addListener: vi.fn(),
  },
}));

const board = () =>
  ({
    getAppState: () => ({ ...getDefaultAppState(), isLoading: false }),
    getFiles: () => ({}),
    getSceneElementsIncludingDeleted: () => [],
    onChange: vi.fn(() => () => {}),
    onPointerUp: vi.fn(() => () => {}),
    addFiles: vi.fn(),
    updateScene: vi.fn(),
  } as unknown as FcboardImperativeAPI);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

it("keeps the host's password switch and code when closing and reopening the live-share QR", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.mocked(Network.addListener).mockResolvedValue({ remove: vi.fn() });
  vi.mocked(Network.startCollaboration)
    .mockClear()
    .mockResolvedValue({ urls: ["http://board.test/#lan=123"] });
  vi.mocked(Network.setCollaborationPassword)
    .mockClear()
    .mockResolvedValue(undefined);
  vi.mocked(Network.sendScene).mockResolvedValue(undefined);
  vi.mocked(Network.stopCollaboration).mockResolvedValue(undefined);
  const view = render(<LanSession api={board()} />);
  await act(async () => {
    await classroomCommands.execute({ name: "network.panel" });
  });
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.live_share.local") }),
  );
  const toggle = await screen.findByRole("switch");
  expect(toggle).not.toBeChecked();
  expect(Network.startCollaboration).toHaveBeenCalledWith({
    scene: expect.objectContaining({ kind: "scene" }),
  });
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toBeEnabled());
  const code = (screen.getByRole("textbox") as HTMLInputElement).value;
  expect(Network.setCollaborationPassword).toHaveBeenCalledWith({
    password: code,
  });
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.close_network_panel") }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => {
    await classroomCommands.execute({ name: "network.panel" });
  });
  expect(screen.getByRole("switch")).toBeChecked();
  expect(screen.getByRole("textbox")).toHaveValue(code);
  expect(Network.startCollaboration).toHaveBeenCalledTimes(1);
  view.unmount();
});

it.each([false, true])(
  "asks the scanner for a password only when the host enabled protection (%s)",
  async (protectedShare) => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    class Socket {
      static OPEN = 1;
      readyState = 1;
      onmessage?: (event: { data: string }) => void;
      onclose?: (event: { code: number; reason: string }) => void;
      onerror?: () => void;
      send = vi.fn();
      close = vi.fn();
      constructor() {
        sockets.push(this);
      }
    }
    const sockets: Socket[] = [];
    vi.stubGlobal("WebSocket", Socket);
    history.replaceState(null, "", "/#lan=0123456789abcdef0123456789abcdef");
    const stopBoards = classroomCommands.context("boards", () => ({
      active: "shared",
      boards: [{ id: "shared" }],
    }));
    const stopNew = classroomCommands.register(
      "board.new",
      "@internal",
      () => {},
    );
    const stopSwitch = classroomCommands.register(
      "board.switch",
      "@internal",
      () => {},
    );
    const api = board();
    const view = render(<LanSession api={api} />);
    try {
      await waitFor(() => expect(sockets).toHaveLength(1));
      const socket = sockets[0];
      if (protectedShare) {
        act(() =>
          socket.onmessage?.({
            data: JSON.stringify({
              kind: "auth",
              required: true,
              incorrect: false,
            }),
          }),
        );
        const input = screen.getByRole("textbox", {
          name: t("fcboard.qr_enter_password"),
        });
        expect(api.updateScene).not.toHaveBeenCalled();
        fireEvent.change(input, { target: { value: "0123" } });
        fireEvent.click(
          screen.getByRole("button", { name: t("buttons.confirm") }),
        );
        expect(socket.send).toHaveBeenCalledWith(
          JSON.stringify({ kind: "join", password: "0123" }),
        );
        act(() =>
          socket.onmessage?.({
            data: JSON.stringify({
              kind: "auth",
              required: true,
              incorrect: true,
            }),
          }),
        );
        expect(screen.getByRole("alert")).toHaveTextContent(
          t("fcboard.qr_password_error"),
        );
      } else {
        expect(screen.queryByRole("textbox")).toBeNull();
      }
      act(() =>
        socket.onmessage?.({
          data: JSON.stringify({ kind: "initial", elements: [], files: {} }),
        }),
      );
      expect(api.updateScene).toHaveBeenCalledWith(
        expect.objectContaining({ elements: [] }),
      );
      expect(screen.queryByRole("textbox")).toBeNull();
    } finally {
      view.unmount();
      stopBoards();
      stopNew();
      stopSwitch();
    }
  },
);

it("opens the original cloud/local chooser, autoretains cloud configuration and receives real guest edits through the visible cloud QR", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.mocked(Network.addListener).mockResolvedValue({ remove: vi.fn() });
  vi.mocked(Network.stopCollaboration).mockResolvedValue(undefined);
  vi.mocked(Network.startCollaboration).mockClear();
  const connections: WebSocket[] = [];
  class Transport extends WebSocket {
    constructor(url: string) {
      super(url);
      connections.push(this);
    }
  }
  vi.stubGlobal("WebSocket", Transport);
  vi.stubGlobal(
    "AbortController",
    class {
      constructor() {
        return transferableAbortController();
      }
    },
  );
  const directory = await mkdtemp(join(tmpdir(), "fcboard-share-ui-"));
  await writeFile(
    join(directory, "index.html"),
    "<!doctype html><title>Whiteboard</title>",
  );
  const key = "test-live-share-service-key-123";
  const service = createShareServer({
    publicDir: directory,
    createToken: key,
  });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const endpoint = `http://127.0.0.1:${
    (service.server.address() as AddressInfo).port
  }/`;
  const api = board();
  let active = "first";
  const stopBoards = classroomCommands.context("boards", () => ({
    active,
    boards: [{ id: "first" }, { id: "second" }],
  }));
  const view = render(<LanSession api={api} />);
  let guest: WebSocket | undefined;
  try {
    await act(async () => {
      await classroomCommands.execute({ name: "network.panel" });
    });
    expect(
      screen.getByRole("button", { name: t("fcboard.live_share.local") }),
    ).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.live_share.cloud") }),
    );
    fireEvent.change(screen.getByLabelText(t("fcboard.live_share.endpoint")), {
      target: { value: endpoint },
    });
    fireEvent.change(screen.getByLabelText(t("fcboard.live_share.key_label")), {
      target: { value: key },
    });
    expect(localStorage.getItem("fcboard-share-endpoint")).toBe(endpoint);
    expect(sessionStorage.getItem("fcboard-share-key")).toBe(key);
    expect(JSON.stringify(classroomCommands.read("network"))).not.toContain(
      key,
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.start_collaboration") }),
    );
    const toggle = await screen.findByRole("switch");
    expect(toggle).not.toBeChecked();
    expect(Network.startCollaboration).not.toHaveBeenCalled();
    const context = classroomCommands.read("network") as {
      mode: string;
      urls: string[];
    };
    expect(context.mode).toBe("cloud");
    const room = new URL(context.urls[0]).hash.slice("#lan=".length);
    let sharedPage: unknown;
    const ownerMessage = (kind: string, id?: string) =>
      new Promise<void>((resolve) => {
        const receive = (data: import("ws").RawData) => {
          const packet = JSON.parse(String(data));
          if (
            packet.kind === kind &&
            (!id ||
              packet.elements?.some(
                (element: { id: string }) => element.id === id,
              ))
          ) {
            connections[0].off("message", receive);
            resolve();
          }
        };
        connections[0].on("message", receive);
      });
    await act(async () => {
      const joined = ownerMessage("peers");
      guest = new WebSocket(`${endpoint.replace("http:", "ws:")}board/${room}`);
      const connected = guest;
      await Promise.all([
        joined,
        new Promise<void>((resolve, reject) => {
          connected.once("message", (data) => {
            sharedPage = JSON.parse(String(data)).page;
            resolve();
          });
          connected.once("error", reject);
        }),
      ]);
    });
    const inserted = convertToFcboardElements([
      { type: "text", text: "共同板书", x: 100, y: 100 },
    ]);
    await act(async () => {
      const received = ownerMessage("scene", inserted[0].id);
      guest!.send(
        JSON.stringify({
          kind: "scene",
          page: sharedPage,
          elements: inserted,
          files: {},
        }),
      );
      await received;
    });
    await waitFor(() =>
      expect(api.updateScene).toHaveBeenCalledWith(
        expect.objectContaining({
          elements: expect.arrayContaining([
            expect.objectContaining({ id: inserted[0].id, text: "共同板书" }),
          ]),
        }),
      ),
    );
    let switched: any;
    await act(async () => {
      const next = new Promise<void>((resolve) => {
        const receive = (data: import("ws").RawData) => {
          const packet = JSON.parse(String(data));
          if (packet.kind === "initial" && packet.page?.id === "second") {
            switched = packet;
            guest!.off("message", receive);
            resolve();
          }
        };
        guest!.on("message", receive);
      });
      active = "second";
      classroomCommands.changed("boards");
      await next;
    });
    expect(switched.page).toEqual({ id: "second", epoch: 1 });
    expect(switched.elements).toEqual([]);
    expect(classroomCommands.read("network")).toMatchObject({
      hosting: true,
      collaborating: true,
      urls: context.urls,
    });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toBeChecked();
    expect(
      (classroomCommands.read("network") as { urls: string[] }).urls,
    ).toEqual(context.urls);
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.end_collaboration") }),
    );
    await screen.findByRole("button", { name: t("fcboard.live_share.cloud") });
    expect(screen.queryByRole("switch")).toBeNull();
  } finally {
    stopBoards();
    guest?.terminate();
    view.unmount();
    await service.close();
    await rm(directory, { recursive: true, force: true });
    localStorage.removeItem("fcboard-share-endpoint");
    sessionStorage.removeItem("fcboard-share-key");
  }
});

it("lets AI configure and start against the same controls, and cancel a pending native start without reopening a dismissed panel", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.mocked(Network.addListener).mockResolvedValue({ remove: vi.fn() });
  vi.mocked(Network.stopCollaboration).mockClear().mockResolvedValue(undefined);
  let finish!: (value: { urls: string[] }) => void;
  vi.mocked(Network.startCollaboration).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<LanSession api={board()} />);
  try {
    const config = {
      endpoint: "https://share.example.test/",
      key: "test-secret-at-least-sixteen",
    };
    await act(async () => {
      await classroomCommands.execute({
        name: "collaboration.configure",
        args: config,
      });
    });
    expect(classroomCommands.read("network")).toMatchObject({
      endpoint: config.endpoint,
      hasKey: true,
    });
    expect(JSON.stringify(classroomCommands.read("network"))).not.toContain(
      config.key,
    );
    await act(async () => {
      await classroomCommands.execute({ name: "network.panel" });
    });
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.live_share.local") }),
    );
    expect(Network.startCollaboration).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.close_network_panel") }),
    );
    await act(async () => {
      finish({
        urls: ["http://board.test/#lan=0123456789abcdef0123456789abcdef"],
      });
    });
    await waitFor(() => expect(Network.stopCollaboration).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      (classroomCommands.read("network") as { collaborating: boolean })
        .collaborating,
    ).toBe(false);
  } finally {
    view.unmount();
    localStorage.removeItem("fcboard-share-endpoint");
    sessionStorage.removeItem("fcboard-share-key");
  }
});

it("discards a late native publish failure after ending the share instead of reopening an error panel", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.mocked(Network.addListener).mockResolvedValue({ remove: vi.fn() });
  vi.mocked(Network.startCollaboration).mockResolvedValue({
    urls: ["http://board.test/#lan=0123456789abcdef0123456789abcdef"],
  });
  vi.mocked(Network.stopCollaboration).mockResolvedValue(undefined);
  let fail!: (reason: Error) => void;
  vi.mocked(Network.sendScene).mockImplementation(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  const view = render(<LanSession api={board()} />);
  try {
    await act(async () => {
      await classroomCommands.execute({ name: "network.panel" });
    });
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.live_share.local") }),
    );
    await screen.findByRole("switch");
    await waitFor(() => expect(typeof fail).toBe("function"));
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.end_collaboration") }),
    );
    await screen.findByRole("button", { name: t("fcboard.live_share.cloud") });
    await act(async () => {
      fail(new Error("The old session has ended"));
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      (classroomCommands.read("network") as { protected: boolean }).protected,
    ).toBe(false);
  } finally {
    view.unmount();
  }
});
