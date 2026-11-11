import { t, useI18n } from "@fcboard/fcboard/i18n";
import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useRef, useState } from "react";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { TransientMessage } from "./TransientMessage";

import { MaterialPanel } from "./MaterialPanel";

import { Network } from "./network";
import { LiveSceneSync } from "./liveSceneSync";
import { ShareQRCode, useShareProtection } from "./ShareQRCode";
import {
  CloudShare,
  loadCloudShare,
  saveCloudShare,
  publicCloudShareEndpoint,
} from "./cloudShare";
import cloudIcon from "./factory-share-icons/cloud.svg";
import localIcon from "./factory-share-icons/local.svg";
import closeIcon from "./native-toolbar-assets/dialog-close.svg";
import "./LiveShare.scss";

import { classroomCommands } from "./commands";
import {
  collaborationAddress,
  isLocalCollaborationCode,
} from "./collaborationAddress";
import { createLanSocket } from "./lanSocket";

import type { LanSocket } from "./lanSocket";

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
export const LanSession = ({ api }: { api: FcboardImperativeAPI }) => {
  useI18n();
  const native = Capacitor.isNativePlatform();
  const cloud = useRef<CloudShare | undefined>(undefined);
  const starting = useRef<AbortController | undefined>(undefined);
  const guestRequest = useRef<AbortController | undefined>(undefined);
  const lifetime = useRef<AbortController | undefined>(undefined);
  const protection = useShareProtection((password) =>
    cloud.current
      ? cloud.current.setPassword(password)
      : Network.setCollaborationPassword({ password }),
  );
  const resetProtection = protection.reset;
  const [panel, setPanel] = useState<"collab" | null>(null);
  const [view, setView] = useState<"entry" | "choose" | "cloud" | "join">(
    "entry",
  );
  const [joinInput, setJoinInput] = useState("");
  const [joinAddress, setJoinAddress] = useState<string>();
  const [mode, setMode] = useState<"local" | "cloud" | undefined>(undefined);
  const [config, setConfig] = useState(loadCloudShare);
  const cloudConfig = useRef(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [urls, setUrls] = useState<string[]>([]);
  const [roomCode, setRoomCode] = useState("");
  const [sharing, setSharing] = useState(false);
  const [peers, setPeers] = useState(0);
  const [connection, setConnection] = useState("");
  const [authentication, setAuthentication] = useState(false);
  const [guestPassword, setGuestPassword] = useState("");
  const guestCode = useRef("");
  const guestRoomCode = useRef("");
  const awaitingPassword = useRef(false);
  const sync = useRef<LiveSceneSync | null>(null);
  const socket = useRef<LanSocket | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  const joined = useRef(false);
  const hosted = useRef(false);

  const leave = useCallback(async () => {
    starting.current?.abort();
    guestRequest.current?.abort();
    if (cloud.current) {
      await cloud.current.end();
      cloud.current = undefined;
    }
    lifetime.current?.abort();
    lifetime.current = undefined;
    resetProtection();
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
    setMode(undefined);
    setView("entry");
    setJoinAddress(undefined);
    setUrls([]);
    setRoomCode("");
    setConnection("");
    setPeers(0);
    setAuthentication(false);
    guestCode.current = "";
    if (location.hash.startsWith("#lan=")) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    classroomCommands.changed("network");
  }, [resetProtection]);
  const start = async (
    nextMode: "local" | "cloud" = "local",
    source?: AbortSignal,
  ) => {
    if (starting.current || hosted.current || cloud.current || joined.current) {
      throw new Error(t("fcboard.processing"));
    }
    if (nextMode === "local" && !native) {
      throw new Error(
        t(
          "fcboard.start_collaboration_on_the_android_board_then_scan_the_qr_code_on_another_device",
        ),
      );
    }
    const request = new AbortController();
    const abort = () => request.abort(source?.reason);
    source?.throwIfAborted();
    source?.addEventListener("abort", abort, { once: true });
    starting.current = request;
    setBusy(true);
    let controller: LiveSceneSync | undefined;
    let session: CloudShare | undefined;
    let localStarted = false;
    try {
      request.signal.throwIfAborted();
      sync.current?.dispose();
      controller = new LiveSceneSync(
        api,
        (packet) =>
          nextMode === "cloud"
            ? session
              ? session.send(packet)
              : Promise.reject(new Error(t("fcboard.live_share.disconnected")))
            : Network.sendScene({ message: JSON.stringify(packet) }),
        (error) => {
          if (alive.current && !request.signal.aborted) {
            setError(failureMessage(error));
          }
        },
      );
      controller.hostPage(
        (classroomCommands.read("boards") as { active?: string } | undefined)
          ?.active || crypto.randomUUID(),
      );
      const initialized = controller.initialize(request.signal);
      if (initialized) {
        await initialized;
      }
      sync.current = controller;
      if (nextMode === "cloud") {
        session = await CloudShare.start(
          cloudConfig.current,
          controller.snapshot(),
          {
            packet: (packet, transport) => {
              session = transport;
              if (alive.current && !request.signal.aborted) {
                controller?.receive(packet);
              }
            },
            status: (status) => {
              if (alive.current && !request.signal.aborted) {
                setConnection(status);
              }
            },
            peers: (count) => {
              if (alive.current && !request.signal.aborted) {
                setPeers(count);
              }
            },
            error: (error) => {
              if (alive.current && !request.signal.aborted) {
                setError(failureMessage(error));
              }
            },
            ended: () => {
              if (!alive.current || request.signal.aborted) {
                return;
              }
              controller?.dispose();
              request.abort();
              if (lifetime.current === request) {
                lifetime.current = undefined;
              }
              protection.reset();
              cloud.current = undefined;
              setSharing(false);
              setMode(undefined);
              setView("choose");
              setConnection(
                "collaboration_ended_this_device_keeps_its_board_content",
              );
              classroomCommands.changed("network");
            },
          },
          request.signal,
        );
        request.signal.throwIfAborted();
        cloud.current = session;
        setUrls([session.url]);
      } else {
        const result = await Network.startCollaboration({
          scene: controller.snapshot(),
        });
        localStarted = true;
        request.signal.throwIfAborted();
        hosted.current = true;
        setUrls(result.urls);
        setRoomCode(result.code || "");
      }
      setMode(nextMode);
      lifetime.current = request;
      setPanel("collab");
      protection.reset();
      setSharing(true);
      setConnection("started");
      controller.start();
      controller.flush(true);
      classroomCommands.changed("network");
    } catch (error) {
      controller?.dispose();
      sync.current = null;
      if (localStarted) {
        await Network.stopCollaboration().catch(() => {});
      }
      if (session) {
        void session.end().catch(() => session?.dispose());
      }
      if (request.signal.aborted) {
        throw new DOMException("Canceled", "AbortError");
      }
      throw error;
    } finally {
      source?.removeEventListener("abort", abort);
      if (starting.current === request) {
        starting.current = undefined;
        if (alive.current) {
          setBusy(false);
        }
      }
    }
  };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (error) {
      if (
        alive.current &&
        !(error instanceof DOMException && error.name === "AbortError")
      ) {
        setError(failureMessage(error));
      }
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
          if (!alive.current || !hosted.current) {
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
      if (cloud.current) {
        cloud.current.snapshot();
      } else if (native && hosted.current) {
        void Network.collaborationInfo()
          .then((info) => {
            if (alive.current && hosted.current && info.sharing) {
              setUrls(info.urls);
              setRoomCode(info.code || "");
            }
          })
          .catch((error) => setError(failureMessage(error)));
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
    const stopPage = classroomCommands.watch("boards", () => {
      const active = (
        classroomCommands.read("boards") as { active?: string } | undefined
      )?.active;
      if (
        active &&
        (hosted.current || cloud.current) &&
        sync.current?.hostPage(active)
      ) {
        sync.current.flush(true);
      }
    });
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive.current = false;
      stopPage();
      starting.current?.abort();
      lifetime.current?.abort();
      const remote = cloud.current;
      cloud.current = undefined;
      if (remote) {
        void remote.end().catch(() => remote.dispose());
      }
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
  }, [api, native, leave]);

  useEffect(() => {
    let destination = new URL(joinAddress || location.href);
    const token = /^#lan=([a-f0-9]{32})$/.exec(destination.hash)?.[1];
    if (!token || (native && !joinAddress)) {
      return;
    }
    let cancelled = false;
    let started = false;
    const request = new AbortController();
    guestRequest.current = request;
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
      setBusy(true);
      setConnection("joining");
      try {
        const key = `fcboard-lan-${destination.host}-${token}`;
        const existing = sessionStorage.getItem(key);
        if (existing && boards.boards.some((board) => board.id === existing)) {
          await classroomCommands.execute({
            name: "board.switch",
            args: { id: existing, signal: request.signal },
          });
        } else {
          await classroomCommands.execute({
            name: "board.new",
            args: { name: t("fcboard.shared_board"), signal: request.signal },
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
        const controller = new LiveSceneSync(
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
          const address = new URL(`board/${token}`, destination);
          address.protocol = destination.protocol === "https:" ? "wss:" : "ws:";
          address.hash = "";
          const transport = createLanSocket(address.href);
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
              const packet = JSON.parse(String(event.data)) as
                | ScenePacket
                | { kind: "auth"; required: boolean; incorrect: boolean }
                | { error: string };
              if ("error" in packet) {
                throw new Error(packet.error);
              }
              if (packet.kind === "auth") {
                if (!packet.incorrect && guestCode.current) {
                  transport.send(
                    JSON.stringify({
                      kind: "join",
                      password: guestCode.current,
                    }),
                  );
                } else {
                  awaitingPassword.current = true;
                  setAuthentication(true);
                  setPanel("collab");
                  if (packet.incorrect) {
                    setError(t("fcboard.qr_password_error"));
                  }
                }
                return;
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
                setAuthentication(false);
                setPanel(null);
                if (awaitingPassword.current) {
                  awaitingPassword.current = false;
                  setPanel(null);
                  setError("");
                }
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
            const reconnect = async () => {
              if (native && guestRoomCode.current) {
                const id = crypto.randomUUID();
                const cancel = () => {
                  void Network.cancelCollaborationLookup({ id }).catch(
                    () => {},
                  );
                };
                request.signal.addEventListener("abort", cancel, {
                  once: true,
                });
                try {
                  const resolved = await Network.resolveCollaborationCode({
                    id,
                    code: guestRoomCode.current,
                  });
                  if (cancelled || request.signal.aborted) {
                    return;
                  }
                  const next = new URL(
                    collaborationAddress(resolved.url, destination.href),
                  );
                  if (next.hash !== destination.hash) {
                    throw new Error(t("fcboard.collab_code_invalid"));
                  }
                  destination = next;
                } catch (error) {
                  if (cancelled || request.signal.aborted) {
                    return;
                  }
                  setError(failureMessage(error));
                } finally {
                  request.signal.removeEventListener("abort", cancel);
                }
              }
              connect();
            };
            retry.current = setTimeout(
              () => void reconnect(),
              Math.min(10000, 500 * 2 ** Math.min(attempts++, 5)),
            );
          };
          transport.onerror = () =>
            setConnection("connection_interrupted_reconnecting");
        };
        connect();
      } catch (error) {
        if (!cancelled && !request.signal.aborted) {
          setError(failureMessage(error));
          setConnection("");
          // Clear the failed destination so submitting the same code can retry.
          setJoinAddress(undefined);
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    };
    const watch = classroomCommands.watch("boards", () => void boot());
    void boot();
    return () => {
      cancelled = true;
      request.abort();
      if (guestRequest.current === request) {
        guestRequest.current = undefined;
      }
      watch();
    };
  }, [api, native, joinAddress]);

  const dismiss = () => {
    if (starting.current) {
      starting.current.abort();
    }
    if (!sharing) {
      guestRequest.current?.abort();
      setJoinAddress(undefined);
      setBusy(false);
    }
    setPanel(null);
    setError("");
  };
  const configure = (next: typeof config) => {
    cloudConfig.current = next;
    setConfig(next);
    saveCloudShare(next);
  };
  useEffect(() => {
    const registrations = [
      classroomCommands.register(
        "network.panel",
        "打开白板实时协作浮层，args.panel=collab",
        (args) => {
          if (args.panel !== undefined && args.panel !== "collab") {
            throw new Error(t("fcboard.this_panel_does_not_exist"));
          }
          if (!sharing) {
            setView("entry");
          }
          setPanel("collab");
          setError("");
          if (native && hosted.current) {
            void Network.collaborationInfo()
              .then((info) => {
                if (alive.current && hosted.current && info.sharing) {
                  setUrls(info.urls);
                  setRoomCode(info.code || "");
                }
              })
              .catch((failure) => setError(failureMessage(failure)));
          }
        },
      ),
      classroomCommands.register(
        "collaboration.start",
        "开启白板实时协作，args.mode=local|cloud（默认 local）；cloud 先用 collaboration.configure 设置实际服务地址与密钥。两种模式都使用原二维码密码开关及双向场景编辑。",
        (args) => {
          const mode = args.mode === undefined ? "local" : args.mode;
          if (mode !== "local" && mode !== "cloud") {
            throw new Error(t("fcboard.this_panel_does_not_exist"));
          }
          return start(
            mode,
            args.signal instanceof AbortSignal ? args.signal : undefined,
          );
        },
      ),
      classroomCommands.register(
        "collaboration.stop",
        "结束或离开当前白板协作，保留本机内容",
        leave,
      ),
      classroomCommands.register(
        "collaboration.configure",
        "配置实时分享云端连接：args.endpoint 和 args.key，自动保存；密钥只保留当前会话，不进入公开上下文。",
        (args) => {
          if (
            starting.current ||
            sharing ||
            Object.keys(args).some(
              (key) => !["endpoint", "key"].includes(key),
            ) ||
            Object.values(args).some(
              (value) => typeof value !== "string" || value.length > 4096,
            )
          ) {
            throw new Error(t("fcboard.live_share.invalid_server"));
          }
          const next = { ...cloudConfig.current, ...args } as typeof config;
          configure(next);
          return {
            endpoint: publicCloudShareEndpoint(next.endpoint),
            hasKey: !!next.key,
          };
        },
      ),
      classroomCommands.context("network", () => ({
        mode,
        busy: !!starting.current,
        view,
        endpoint: publicCloudShareEndpoint(cloudConfig.current.endpoint),
        hasKey: !!cloudConfig.current.key,
        protected: protection.enabled,
        urls: sharing ? urls : [],
        collaborating: hosted.current || !!cloud.current || joined.current,
        hosting: hosted.current || !!cloud.current,
        code: roomCode || undefined,
        peers,
        connection,
      })),
    ];
    return () => registrations.forEach((stop) => stop());
  });
  let joinCandidate = "";
  try {
    joinCandidate =
      native && isLocalCollaborationCode(joinInput)
        ? joinInput.trim()
        : collaborationAddress(joinInput, config.endpoint);
  } catch {
    /* Keep Join disabled until valid. */
  }
  return (
    <>
      {(panel || error) && (
        <MaterialPanel
          centered
          onDismiss={dismiss}
          className={`fc-network-panel fc-surface ${
            !sharing &&
            !authentication &&
            (view === "choose" || view === "entry")
              ? "fc-live-share-picker"
              : sharing && !!urls.length
              ? "fc-share-qr-dialog"
              : "fc-live-share-config"
          }`}
          role="dialog"
          aria-label={t("fcboard.live_collaboration")}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              dismiss();
            }
          }}
        >
          <header>
            <strong>{t("fcboard.live_collaboration")}</strong>
            <button
              type="button"
              aria-label={t("fcboard.close_network_panel")}
              onClick={dismiss}
            >
              <img src={closeIcon} alt="" />
            </button>
          </header>
          <TransientMessage message={error} role="alert" />
          {panel === "collab" && (
            <>
              {authentication ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (
                      socket.current?.readyState === WebSocket.OPEN &&
                      /^\d{4}$/.test(guestPassword)
                    ) {
                      guestCode.current = guestPassword;
                      socket.current.send(
                        JSON.stringify({
                          kind: "join",
                          password: guestPassword,
                        }),
                      );
                    }
                  }}
                >
                  <label>
                    {t("fcboard.qr_enter_password")}
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]{4}"
                      maxLength={4}
                      value={guestPassword}
                      autoComplete="off"
                      onChange={(event) => {
                        if (/^\d{0,4}$/.test(event.target.value)) {
                          setGuestPassword(event.target.value);
                        }
                      }}
                    />
                  </label>
                  <button type="submit" disabled={guestPassword.length !== 4}>
                    {t("buttons.confirm")}
                  </button>
                </form>
              ) : sharing ? (
                <>
                  <p role="status">
                    {statusText(connection)}
                    {hosted.current || cloud.current
                      ? ` · ${t("fcboard.count_devices", { count: peers })}`
                      : ""}
                  </p>
                  {urls[0] && (
                    <ShareQRCode
                      key={urls[0]}
                      url={urls[0]}
                      protection={protection}
                    />
                  )}
                  {(roomCode ||
                    (urls[0] &&
                      /^#lan=[a-f0-9]{32}$/.test(new URL(urls[0]).hash))) && (
                    <p className="fc-collab-room">
                      {t("fcboard.collab_room", {
                        code: roomCode || new URL(urls[0]).hash.slice(5),
                      })}
                    </p>
                  )}
                  <button disabled={busy} onClick={() => void run(leave)}>
                    {hosted.current || cloud.current
                      ? t("fcboard.end_collaboration")
                      : t("fcboard.leave_collaboration")}
                  </button>
                </>
              ) : view === "entry" ? (
                <div className="fc-collab-entry">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setView("choose")}
                  >
                    {t("fcboard.collab_create")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setJoinInput("");
                      setView("join");
                    }}
                  >
                    {t("fcboard.collab_join")}
                  </button>
                </div>
              ) : view === "join" ? (
                <form
                  className="fc-live-share-cloud"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (joinCandidate && !busy && !sharing) {
                      setError("");
                      setConnection("joining");
                      guestRoomCode.current = isLocalCollaborationCode(
                        joinCandidate,
                      )
                        ? joinCandidate
                        : "";
                      if (!isLocalCollaborationCode(joinCandidate)) {
                        setJoinAddress(joinCandidate);
                      } else {
                        void run(async () => {
                          const request = new AbortController();
                          const id = crypto.randomUUID();
                          guestRequest.current?.abort();
                          guestRequest.current = request;
                          const abort = () => {
                            void Network.cancelCollaborationLookup({
                              id,
                            }).catch(() => {});
                          };
                          request.signal.addEventListener("abort", abort, {
                            once: true,
                          });
                          try {
                            const resolved =
                              await Network.resolveCollaborationCode({
                                id,
                                code: joinCandidate,
                              });
                            request.signal.throwIfAborted();
                            setJoinAddress(
                              collaborationAddress(
                                resolved.url,
                                config.endpoint,
                              ),
                            );
                          } catch (failure) {
                            request.signal.throwIfAborted();
                            throw failure;
                          } finally {
                            request.signal.removeEventListener("abort", abort);
                            if (guestRequest.current === request) {
                              guestRequest.current = undefined;
                            }
                          }
                        });
                      }
                    }
                  }}
                >
                  <button
                    type="button"
                    className="fc-live-share-back"
                    onClick={() => setView("entry")}
                  >
                    {t("fcboard.back")}
                  </button>
                  <label>
                    {t("fcboard.collab_code")}
                    <input
                      type="text"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      maxLength={2048}
                      value={joinInput}
                      onChange={(event) => setJoinInput(event.target.value)}
                    />
                  </label>
                  <p>{t("fcboard.collab_join_hint")}</p>
                  <button type="submit" disabled={busy || !joinCandidate}>
                    {t("fcboard.collab_join_action")}
                  </button>
                  {connection === "joining" && (
                    <p role="status">{t("fcboard.joining")}</p>
                  )}
                </form>
              ) : view === "cloud" ? (
                <form
                  className="fc-live-share-cloud"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(() => start("cloud"));
                  }}
                >
                  <button
                    type="button"
                    className="fc-live-share-back"
                    onClick={() => setView("choose")}
                    disabled={busy}
                  >
                    {t("fcboard.back")}
                  </button>
                  <label>
                    {t("fcboard.live_share.endpoint")}
                    <input
                      type="url"
                      autoComplete="url"
                      value={config.endpoint}
                      disabled={busy}
                      onChange={(event) =>
                        configure({ ...config, endpoint: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    {t("fcboard.live_share.key_label")}
                    <input
                      type="password"
                      autoComplete="off"
                      value={config.key}
                      disabled={busy}
                      onChange={(event) =>
                        configure({ ...config, key: event.target.value })
                      }
                    />
                  </label>
                  <p>{t("fcboard.live_share.cloud_description")}</p>
                  <button
                    type="submit"
                    disabled={
                      busy || !config.endpoint.trim() || !config.key.trim()
                    }
                  >
                    {busy
                      ? t("fcboard.starting")
                      : t("fcboard.start_collaboration")}
                  </button>
                </form>
              ) : (
                <div className="fc-live-share-choices" aria-busy={busy}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setView("cloud")}
                  >
                    <img src={cloudIcon} alt="" />
                    <span>{t("fcboard.live_share.cloud")}</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy || !native}
                    title={
                      !native
                        ? t(
                            "fcboard.start_collaboration_on_the_android_board_then_scan_the_qr_code_on_another_device",
                          )
                        : undefined
                    }
                    onClick={() => void run(() => start("local"))}
                  >
                    <img src={localIcon} alt="" />
                    <span>{t("fcboard.live_share.local")}</span>
                  </button>
                </div>
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
