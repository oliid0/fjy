import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import { Capacitor } from "@capacitor/core";
import { useEffect, useRef, useState } from "react";
import { CloseIcon } from "@excalidraw/excalidraw/components/icons";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { QRCode } from "../share/QRCode";

import { TransientMessage } from "./TransientMessage";

import { MaterialPanel } from "./MaterialPanel";

import { Network } from "./network";
import { SceneSync } from "./sceneSync";

import { classroomCommands } from "./commands";
import { useAnchoredPanel } from "./floating";

import type { ScenePacket } from "./sceneSync";

const failureMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const networkStatus = () => ({
  leave_collaboration: t("fcboard.leave_collaboration"),
  started: t("fcboard.started"),
  joining: t("fcboard.joining"),
  syncing_live: t("fcboard.syncing_live"),
  connection_interrupted_reconnecting: t(
    "fcboard.connection_interrupted_reconnecting",
  ),
  collaboration_ended_this_device_keeps_its_board_content: t(
    "fcboard.collaboration_ended_this_device_keeps_its_board_content",
  ),
});
const statusText = (value: string) =>
  (networkStatus() as Record<string, string>)[value] || value;
const native = Capacitor.isNativePlatform();
export const LanSession = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  useI18n();
  const [panel, setPanel] = useState<"collab" | null>(null);
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
    socket.current?.close(1000, "leave_collaboration");
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
      throw new Error(
        t(
          "fcboard.start_collaboration_on_the_android_board_then_scan_the_qr_code_on_another_device",
        ),
      );
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
      setConnection("started");
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
          } else if (message.kind === "ended") {
            void leave();
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
      setConnection("joining");
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
            args: { name: t("fcboard.shared_board") },
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
              throw new Error(
                t(
                  "fcboard.connection_interrupted_changes_will_sync_after_reconnection",
                ),
              );
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
                setConnection("syncing_live");
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
              setConnection(
                "collaboration_ended_this_device_keeps_its_board_content",
              );
              classroomCommands.changed("network");
              return;
            }
            setConnection("connection_interrupted_reconnecting");
            retry.current = setTimeout(
              connect,
              Math.min(10000, 500 * 2 ** Math.min(attempts++, 5)),
            );
          };
          transport.onerror = () =>
            setConnection("connection_interrupted_reconnecting");
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
        "打开白板实时协作浮层，args.panel=collab",
        (args) => {
          if (args.panel !== undefined && args.panel !== "collab") {
            throw new Error(t("fcboard.this_panel_does_not_exist"));
          }
          setPanel("collab");
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
      classroomCommands.context("network", () => ({
        collaborating: hosted.current || joined.current,
        peers,
        connection,
      })),
    ];
    return () => registrations.forEach((stop) => stop());
  });
  return (
    <>
      {(panel || error) && (
        <MaterialPanel
          ref={surface}
          className="fc-network-panel fc-surface"
          style={panelStyle}
          role="dialog"
          aria-label={t("fcboard.live_collaboration")}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              setPanel(null);
              setError("");
            }
          }}
        >
          <header>
            <strong>{t("fcboard.live_collaboration")}</strong>
            <button
              aria-label={t("fcboard.close_network_panel")}
              onClick={() => {
                setPanel(null);
                setError("");
              }}
            >
              {CloseIcon}
            </button>
          </header>
          <TransientMessage message={error} role="alert" />
          {panel === "collab" && (
            <>
              {sharing ? (
                <>
                  <p role="status">
                    {statusText(connection)}
                    {native
                      ? ` · ${t("fcboard.count_devices", { count: peers })}`
                      : ""}
                  </p>
                  {urls.map((url) => (
                    <div key={url}>
                      <QRCode value={url} />
                      <p className="fc-network-address">{url}</p>
                    </div>
                  ))}
                  <button disabled={busy} onClick={() => void run(leave)}>
                    {hosted.current
                      ? t("fcboard.end_collaboration")
                      : t("fcboard.leave_collaboration")}
                  </button>
                </>
              ) : native ? (
                <>
                  <p>
                    {t(
                      "fcboard.scan_on_the_same_network_to_join_writing_images_and_undo_sync_live",
                    )}
                  </p>
                  <button disabled={busy} onClick={() => void run(start)}>
                    {busy
                      ? t("fcboard.starting")
                      : t("fcboard.start_collaboration")}
                  </button>
                </>
              ) : (
                <p>
                  {connection ||
                    t(
                      "fcboard.scan_the_android_board_s_collaboration_qr_code_with_this_device_to_join",
                    )}
                </p>
              )}
            </>
          )}
        </MaterialPanel>
      )}
      {sharing &&
        !panel &&
        connection &&
        connection !== "started" &&
        connection !== "syncing_live" && (
          <TransientMessage
            className="fc-notice"
            message={statusText(connection)}
          />
        )}
    </>
  );
};
