import { Capacitor } from "@capacitor/core";
import { useEffect, useRef, useState } from "react";
import { CloseIcon } from "@excalidraw/excalidraw/components/icons";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { QRCode } from "../share/QRCode";

import { Network } from "./network";
import { SceneSync } from "./sceneSync";

import { classroomCommands } from "./commands";
import { useAnchoredPanel } from "./floating";

import type { ScenePacket } from "./sceneSync";

const failureMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const native = Capacitor.isNativePlatform();
export const LanSession = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  const [panel, setPanel] = useState<"collab" | "remote" | null>(null);
  const surface = useRef<HTMLElement>(null);
  const panelStyle = useAnchoredPanel(
    surface,
    "[data-testid='main-menu-trigger']",
    !!panel,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [urls, setUrls] = useState<string[]>([]);
  const [sharing, setSharing] = useState(false);
  const [peers, setPeers] = useState(0);
  const [connection, setConnection] = useState("");
  const [remote, setRemote] = useState<{
    urls: string[];
    pin: string;
    expiresAt: number;
  } | null>(null);
  const [remoteState, setRemoteState] = useState("");
  const [now, setNow] = useState(Date.now());
  const sync = useRef<SceneSync | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  const joined = useRef(false);
  const hosted = useRef(false);

  const leave = async () => {
    joined.current = false;
    clearTimeout(retry.current);
    sync.current?.dispose();
    sync.current = null;
    socket.current?.close(1000, "离开协作");
    socket.current = null;
    if (hosted.current) {
      await Network.stopCollaboration();
    }
    hosted.current = false;
    setSharing(false);
    setUrls([]);
    setConnection("");
    setPeers(0);
    if (location.hash.startsWith("#lan=")) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    classroomCommands.changed("network");
  };
  const start = async () => {
    if (!native) {
      throw new Error("请在安卓大屏开启协作，再用其他设备扫描二维码加入");
    }
    if (classroomCommands.has("document.close")) {
      await classroomCommands.execute({
        name: "document.close",
        args: { next: false },
      });
    }
    sync.current?.dispose();
    const controller = new SceneSync(
      api,
      (packet) => Network.sendScene({ message: JSON.stringify(packet) }),
      (error) => setError(failureMessage(error)),
    );
    sync.current = controller;
    try {
      const result = await Network.startCollaboration({
        scene: controller.snapshot(),
      });
      hosted.current = true;
      setSharing(true);
      setConnection("已开启");
      setUrls(result.urls);
      controller.start();
      controller.flush(true);
      classroomCommands.changed("network");
    } catch (error) {
      controller.dispose();
      sync.current = null;
      throw error;
    }
  };
  const startRemote = async () => {
    const result = await Network.startRemote();
    setRemote(result);
    setRemoteState("等待配对");
    setNow(Date.now());
  };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (error) {
      setError(failureMessage(error));
    } finally {
      if (alive.current) {
        setBusy(false);
      }
    }
  };

  useEffect(() => {
    alive.current = true;
    const handle = native
      ? Network.addListener("message", (message) => {
          if (!alive.current) {
            return;
          }
          if (message.kind === "peers") {
            setPeers(message.count);
          } else if (message.kind === "remote") {
            setRemoteState(
              message.state === "paired"
                ? "已配对，等待连接无线调试"
                : "已连接",
            );
          } else if (message.kind === "ended") {
            void leave();
            setRemote(null);
          } else if (message.kind === "scene" || message.kind === "initial") {
            try {
              sync.current?.receive(message);
            } catch (error) {
              setError(failureMessage(error));
            }
          }
        })
      : null;
    const refresh = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      if (native && hosted.current) {
        void Network.getScene()
          .then((packet) => sync.current?.receive(packet))
          .catch((error) => setError(failureMessage(error)));
      } else if (
        joined.current &&
        socket.current?.readyState === WebSocket.OPEN
      ) {
        socket.current.send("snapshot");
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive.current = false;
      joined.current = false;
      clearTimeout(retry.current);
      sync.current?.dispose();
      socket.current?.close();
      void handle?.then((listener) => listener.remove());
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      if (native) {
        void Network.stopCollaboration();
        void Network.stopRemote();
      }
    };
  }, [api]);

  useEffect(() => {
    const token = /^#lan=([a-f0-9]{32})$/.exec(location.hash)?.[1];
    if (!token || native) {
      return;
    }
    let cancelled = false;
    let started = false;
    const boot = async () => {
      const boards = classroomCommands.read("boards") as
        | { active: string; boards: { id: string }[] }
        | undefined;
      if (
        cancelled ||
        started ||
        !boards?.active ||
        api.getAppState().isLoading
      ) {
        return;
      }
      started = true;
      setConnection("正在加入…");
      try {
        const key = `fcboard-lan-${location.host}-${token}`;
        const existing = sessionStorage.getItem(key);
        if (existing && boards.boards.some((board) => board.id === existing)) {
          await classroomCommands.execute({
            name: "board.switch",
            args: { id: existing },
          });
        } else {
          await classroomCommands.execute({
            name: "board.new",
            args: { name: "协作白板" },
          });
        }
        const current = classroomCommands.read("boards") as { active: string };
        sessionStorage.setItem(key, current.active);
        if (cancelled) {
          return;
        }
        joined.current = true;
        setSharing(true);
        classroomCommands.changed("network");
        let first = true;
        let attempts = 0;
        const controller = new SceneSync(
          api,
          async (packet) => {
            if (socket.current?.readyState !== WebSocket.OPEN) {
              throw new Error("连接中断，重连后会自动补同步");
            }
            socket.current.send(JSON.stringify(packet));
          },
          (error) => setConnection(failureMessage(error)),
        );
        sync.current = controller;
        const connect = () => {
          if (!joined.current || cancelled) {
            return;
          }
          const transport = new WebSocket(
            `${location.protocol === "https:" ? "wss:" : "ws:"}//${
              location.host
            }/board/${token}`,
          );
          socket.current = transport;
          const heartbeat = setInterval(() => {
            if (transport.readyState === WebSocket.OPEN) {
              transport.send("ping");
            }
          }, 10000);
          transport.onmessage = (event) => {
            if (event.data === "pong") {
              return;
            }
            try {
              const packet = JSON.parse(String(event.data)) as ScenePacket & {
                error?: string;
              };
              if (packet.error) {
                throw new Error(packet.error);
              }
              if (packet.kind !== "initial" && packet.kind !== "scene") {
                return;
              }
              controller.receive(packet, first);
              if (first) {
                first = false;
                controller.start();
              }
              if (packet.kind === "initial") {
                controller.flush(true);
                attempts = 0;
                setConnection("实时同步中");
              }
            } catch (error) {
              setError(failureMessage(error));
            }
          };
          transport.onclose = (event) => {
            clearInterval(heartbeat);
            if (!joined.current || cancelled) {
              return;
            }
            if (event.code === 1000 && !["连接已断开"].includes(event.reason)) {
              joined.current = false;
              controller.dispose();
              setSharing(false);
              setConnection(event.reason || "协作已结束，本机保留板书");
              classroomCommands.changed("network");
              return;
            }
            setConnection("连接中断，正在重连…");
            retry.current = setTimeout(
              connect,
              Math.min(10000, 500 * 2 ** Math.min(attempts++, 5)),
            );
          };
          transport.onerror = () => setConnection("连接中断，正在重连…");
        };
        connect();
      } catch (error) {
        setError(failureMessage(error));
      }
    };
    const watch = classroomCommands.watch("boards", () => void boot());
    void boot();
    return () => {
      cancelled = true;
      watch();
    };
  }, [api]);

  useEffect(() => {
    if (!remote) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [remote]);
  useEffect(() => {
    if (!panel) {
      return;
    }
    const dismiss = (event: PointerEvent) => {
      if (
        !surface.current?.contains(event.target as Node) &&
        !(event.target as Element).closest?.("[data-network]")
      ) {
        setPanel(null);
      }
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [panel]);
  useEffect(() => {
    const registrations = [
      classroomCommands.register(
        "network.panel",
        "打开协作或设备控制浮层，args.panel=collab|remote",
        (args) => {
          setPanel(args.panel === "remote" ? "remote" : "collab");
          setError("");
        },
      ),
      classroomCommands.register(
        "collaboration.start",
        "开启局域网白板实时协作",
        start,
      ),
      classroomCommands.register(
        "collaboration.stop",
        "结束或离开当前白板协作，保留本机内容",
        leave,
      ),
      classroomCommands.register(
        "device.remote.start",
        "开启整机控制配对，仅用户明确要求时调用",
        startRemote,
      ),
      classroomCommands.register(
        "device.remote.stop",
        "结束整机控制",
        async () => {
          await Network.stopRemote();
          setRemote(null);
        },
      ),
      classroomCommands.context("network", () => ({
        collaborating: hosted.current || joined.current,
        remote: !!remote,
        peers,
        connection,
      })),
    ];
    return () => registrations.forEach((stop) => stop());
  });
  return (
    <>
      {(panel || error) && (
        <section
          ref={surface}
          className="fc-network-panel fc-surface"
          style={panelStyle}
          role="dialog"
          aria-label={panel === "remote" ? "设备控制" : "实时协作"}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              setPanel(null);
              setError("");
            }
          }}
        >
          <header>
            <strong>{panel === "remote" ? "设备控制" : "实时协作"}</strong>
            <button
              aria-label="关闭网络浮层"
              onClick={() => {
                setPanel(null);
                setError("");
              }}
            >
              {CloseIcon}
            </button>
          </header>
          {error && <p role="alert">{error}</p>}
          {panel === "collab" && (
            <>
              {sharing ? (
                <>
                  <p role="status">
                    {connection}
                    {native ? ` · ${peers} 台设备` : ""}
                  </p>
                  {urls.map((url) => (
                    <div key={url}>
                      <QRCode value={url} />
                      <p className="fc-network-address">{url}</p>
                    </div>
                  ))}
                  <button disabled={busy} onClick={() => void run(leave)}>
                    {hosted.current ? "结束协作" : "离开协作"}
                  </button>
                </>
              ) : native ? (
                <>
                  <p>同一局域网扫码加入，书写、图片与撤销实时同步。</p>
                  <button disabled={busy} onClick={() => void run(start)}>
                    {busy ? "正在开启…" : "开启协作"}
                  </button>
                </>
              ) : (
                <p>
                  {connection ||
                    "请用此设备扫描安卓大屏的协作二维码，直接加入白板。"}
                </p>
              )}
            </>
          )}
          {panel === "remote" && (
            <>
              <p>
                手机浏览器控制整个大屏，可切换应用、翻页和书写。先在大屏开启无线调试，再用手机完成配对。
              </p>
              {remote && (
                <>
                  <p role="status">{remoteState}</p>
                  {remoteState === "等待配对" && (
                    <>
                      <output className="fc-pair-pin" aria-label="设备配对码">
                        {remote.pin}
                      </output>
                      <p>
                        {Math.max(
                          0,
                          Math.ceil((remote.expiresAt - now) / 1000),
                        )}{" "}
                        秒内输入
                      </p>
                    </>
                  )}
                  {remote.urls.map((url) => (
                    <div key={url}>
                      <QRCode value={url} />
                      <p className="fc-network-address">{url}</p>
                    </div>
                  ))}
                </>
              )}
              <div className="fc-network-actions">
                <button disabled={busy} onClick={() => void run(startRemote)}>
                  {remote ? "重新配对" : "开启控制"}
                </button>
                {remote && (
                  <>
                    <button
                      onClick={() =>
                        void run(() => Network.openWirelessSettings())
                      }
                    >
                      无线调试
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await Network.stopRemote();
                          setRemote(null);
                        })
                      }
                    >
                      结束控制
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </section>
      )}
      {sharing &&
        !panel &&
        connection &&
        connection !== "已开启" &&
        connection !== "实时同步中" && (
          <div className="fc-notice" role="status">
            {connection}
          </div>
        )}
    </>
  );
};
