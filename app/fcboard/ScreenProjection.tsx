import { Capacitor, registerPlugin } from "@capacitor/core";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  CaptureUpdateAction,
  newElement,
  newElementWith,
} from "@fcboard/element";
import { FactoryIcon } from "@fcboard/fcboard/components/FactoryIcon";
import { useI18n } from "@fcboard/fcboard/i18n";

import type { PluginListenerHandle } from "@capacitor/core";
import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { QRCode } from "../share/QRCode";

import { classroomCommands } from "./commands";
import { MaterialPanel } from "./MaterialPanel";
import {
  nativeProjection,
  nativeProtocols,
  watchNativeProjection,
} from "./nativeProjection";
import type { NativeProtocol, NativeReceivers } from "./nativeProjection";
import "./ScreenProjection.scss";

type ProjectionSource = import("@fcboard/fcboard/scene/types").SceneProjection["video"];
type Receiver = { session: string; url: string };
type Sender = { session: string; sender: string };
type Signal = Sender & ({ kind: "offer" | "restart"; sdp: string } | { kind: "left" });

const projection = registerPlugin<{
  start(options: {
    host?: string;
    certificate?: string;
    password?: string;
    resume?: boolean;
  }): Promise<Receiver>;
  answer(options: Sender & { sdp: string }): Promise<void>;
  disconnect(options: Sender): Promise<void>;
  stop(options: { session: string }): Promise<void>;
  immersive(options: { active: boolean }): Promise<void>;
  addListener(
    event: "signal",
    listener: (event: Signal) => void,
  ): Promise<PluginListenerHandle>;
}>("FcboardProjection");

type Connection = {
  sender: Sender;
  pc: RTCPeerConnection;
  timer: ReturnType<typeof setTimeout>;
  tile?: string;
};

const startErrors = {
  CERTIFICATE: "projection.certificateError",
  NETWORK: "projection.networkError",
  HOST: "projection.hostError",
} as const;

const startErrorKey = (error: unknown) => {
  const code = (error as { code?: keyof typeof startErrors } | null)?.code;
  return code && Object.prototype.hasOwnProperty.call(startErrors, code)
    ? startErrors[code]
    : ("projection.startError" as const);
};

type ProjectionErrorKey =
  | ReturnType<typeof startErrorKey>
  | "projection.nearbyError"
  | "projection.connectionError"
  | "projection.certificateSize";

const readCertificate = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  // Keep each spread below the WebView's argument limit.
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
};

function gatherIce(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        done();
      }
    };
    const timer = setTimeout(done, 4000);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

function attachProjection(
  api: FcboardImperativeAPI,
  video: ProjectionSource,
) {
  const state = api.getAppState();
  const zoom = state.zoom.value;
  const ratio =
    ("position" in video
      ? video.width / video.height
      : video.videoWidth / video.videoHeight) || 16 / 9;
  const width =
    Math.min(state.width * 0.76, state.height * 0.68 * ratio, 900) / zoom;
  const height = width / ratio;
  const element = newElement({
    type: "rectangle",
    x: (state.width / zoom - width) / 2 - state.scrollX,
    y: (state.height / zoom - height) / 2 - state.scrollY,
    width,
    height,
    roughness: 0,
    strokeColor: "#424739",
    backgroundColor: "#252623",
    fillStyle: "solid",
  });
  api.setSceneProjection?.({
    elementId: element.id,
    video,
    fullscreen: false,
  });
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), element],
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  return element.id;
}

const nativeStatusKeys = {
  starting: "projection.starting",
  off: "projection.off",
  waiting: "projection.waiting",
  connecting: "projection.connecting",
  connected: "projection.live",
  error: "projection.startError",
  unavailable: "projection.unavailable",
} as const;

export const ScreenProjection = ({ api }: { api: FcboardImperativeAPI }) => {
  const [request, setRequest] = useState(0);
  const release = useCallback(() => setRequest(0), []);
  useEffect(() => classroomCommands.register("projection.open", "@internal", () => {
    setRequest((previous) => previous + 1);
  }), []);
  return request ? <ProjectionSession api={api} request={request} release={release} /> : null;
};

const ProjectionSession = ({ api, request, release }: {
  api: FcboardImperativeAPI;
  request: number;
  release: () => void;
}) => {
  const { t } = useI18n();
  const supported =
    Capacitor.getPlatform() === "android" && !!api.setSceneProjection;
  const mounted = useRef(false);
  const receiver = useRef<Receiver>(undefined);
  const connection = useRef<Connection>(undefined);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const nativeLive = useRef<{
    protocol: NativeProtocol;
    tile: string;
    video: ProjectionSource;
  }>(undefined);
  const [native, setNative] = useState<NativeReceivers>();
  const nativeStarted = useRef(false);
  const [nativeBusy, setNativeBusy] = useState<NativeProtocol>();
  const starting = useRef(false);
  const activate = useRef<() => void>(undefined);
  const choosingCertificate = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<ProjectionErrorKey>();
  const [stage, setStage] = useState<"idle" | "connecting" | "live">("idle");
  const [fullscreen, setFullscreen] = useState(false);
  const [muted, setMuted] = useState(true);
  const [hasAudio, setHasAudio] = useState(false);
  const [file, setFile] = useState<File>();
  const [host, setHost] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    mounted.current = true;
    const close = () => {
      const current = connection.current;
      const video = videoRef.current;
      const tile = current?.tile || nativeLive.current?.tile;
      if (!current && !nativeLive.current) {
        return;
      }
      connection.current = undefined;
      if (nativeLive.current) document.documentElement.classList.remove("fc-native-projection");
      nativeLive.current = undefined;
      if (current) {
        clearTimeout(current.timer);
        current.pc.close();
      }
      if (video) {
        video.onresize = null;
        video.pause();
        video.srcObject = null;
        video.muted = true;
        video.remove();
        videoRef.current = null;
      }
      api.setSceneProjection?.();
      if (tile && api.getSceneElements().some(({ id }) => id === tile)) {
        api.updateScene({
          elements: api
            .getSceneElementsIncludingDeleted()
            .map((element) =>
              element.id === tile
                ? newElementWith(element, { isDeleted: true })
                : element,
            ),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
      if (mounted.current) {
        setStage("idle");
        setFullscreen(false);
        setMuted(true);
        setHasAudio(false);
      }
    };
    const endWithError = (current: Connection) => {
      if (connection.current === current) {
        close();
        void projection.disconnect(current.sender).catch(() => {});
        setError("projection.connectionError");
        setOpen(true);
      }
    };
    let disposed = false;
    let unwatch: (() => void) | undefined;
    const enableNative = async () => {
      try {
        const capabilities = await nativeProjection.status();
        if (disposed) return;
        unwatch = watchNativeProjection(
          setNative,
          (protocol) =>
            !connection.current &&
            (!nativeLive.current || nativeLive.current.protocol === protocol),
          (protocol, video) => {
            if (nativeLive.current) {
              nativeLive.current.video = video;
              const current = api.getSceneProjection?.();
              if (current) api.setSceneProjection?.({ ...current, video });
              return;
            }
            document.documentElement.classList.add("fc-native-projection");
            nativeLive.current = {
              protocol,
              video,
              tile: attachProjection(api, video),
            };
            setStage("live");
            setError(undefined);
            setOpen(false);
          },
          (protocol) => {
            if (nativeLive.current?.protocol === protocol) close();
          },
          () => setError("projection.connectionError"),
        );
        for (const protocol of nativeProtocols) {
          if (disposed) break;
          if (capabilities[protocol].state !== "off") continue;
          try {
            await nativeProjection.start({ protocol });
            if (disposed) await nativeProjection.stop({ protocol });
          } catch {
            if (!disposed)
              setError(
                protocol === "miracast"
                  ? "projection.nearbyError"
                  : "projection.startError",
              );
          }
        }
      } catch {
        if (!disposed) setError("projection.startError");
      }
    };
    const resumeWeb = async () => {
      if (starting.current || receiver.current) return;
      starting.current = true;
      setBusy(true);
      try {
        const next = await projection.start({ resume: true });
        if (disposed) {
          await projection.stop(next);
        } else {
          receiver.current = next;
          setUrl(next.url);
          setError(undefined);
        }
      } catch (failure) {
        if (
          !disposed &&
          (failure as { code?: string })?.code !== "NOT_CONFIGURED"
        ) {
          setError(startErrorKey(failure));
        }
      } finally {
        starting.current = false;
        if (!disposed) setBusy(false);
      }
    };
    activate.current = () => {
      setOpen(true);
      if (supported) void resumeWeb();
      if (supported && !nativeStarted.current) {
        nativeStarted.current = true;
        void enableNative();
      }
    };
    if (!supported) {
      return () => { mounted.current = false; activate.current = undefined; };
    }

    const cancel = api.onChange((elements) => {
      const current = connection.current;
      const nativeSource = nativeLive.current;
      const tile = current?.tile || nativeSource?.tile;
      if (
        tile &&
        !elements.some((element) => element.id === tile && !element.isDeleted)
      ) {
        close();
        if (current) void projection.disconnect(current.sender).catch(() => {});
        if (nativeSource)
          void nativeProjection
            .stop({ protocol: nativeSource.protocol })
            .catch(() => {});
      }
    });
    const answerOffer = async (active: Connection, sdp: string) => {
      const { pc, sender } = active;
      await pc.setRemoteDescription({ type: "offer", sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gatherIce(pc);
      if (connection.current === active && pc.localDescription) {
        await projection.answer({ ...sender, sdp: pc.localDescription.sdp });
      }
    };
    const listener = projection.addListener("signal", async (event) => {
      if (!mounted.current || receiver.current?.session !== event.session) {
        return;
      }
      if (event.kind === "left") {
        if (connection.current?.sender.sender === event.sender) {
          close();
        }
        return;
      }
      if (event.kind === "restart") {
        const active = connection.current;
        if (!active || active.sender.sender !== event.sender) {
          void projection.disconnect(event).catch(() => {});
          return;
        }
        try {
          await answerOffer(active, event.sdp);
        } catch {
          endWithError(active);
        }
        return;
      }
      if (connection.current || nativeLive.current) {
        void projection.disconnect(event).catch(() => {});
        return;
      }
      const video = document.createElement("video");
      video.playsInline = true;
      video.muted = true;
      video.className = "fc-projection__video";
      video.setAttribute("aria-hidden", "true");
      document.body.appendChild(video);
      videoRef.current = video;
      let current: Connection | undefined;
      try {
        const sender = { session: event.session, sender: event.sender };
        const pc = new RTCPeerConnection({ iceServers: [] });
        const active: Connection = {
          sender,
          pc,
          timer: setTimeout(() => endWithError(active), 20000),
        };
        current = active;
        connection.current = active;
        setStage("connecting");
        setError(undefined);
        video.onresize = () => {
          const projection = api.getSceneProjection?.();
          if (connection.current === active && projection?.video === video)
            api.setSceneProjection?.({ ...projection });
        };
        const stream = new MediaStream();
        pc.ontrack = ({ track }) => {
          if (connection.current !== active) {
            return;
          }
          stream.addTrack(track);
          if (track.kind === "audio") {
            setHasAudio(true);
            return;
          }
          track.addEventListener(
            "ended",
            () => {
              if (connection.current === active) {
                close();
                void projection.disconnect(sender).catch(() => {});
              }
            },
            { once: true },
          );
          const onPlaying = () => {
            if (connection.current !== active || active.tile) {
              return;
            }
            clearTimeout(active.timer);
            active.tile = attachProjection(api, video);
            setStage("live");
            setOpen(false);
          };
          video.srcObject = stream;
          void video
            .play()
            .then(onPlaying)
            .catch(() => endWithError(active));
        };
        pc.onconnectionstatechange = () => {
          if (connection.current !== active) return;
          if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
            clearTimeout(active.timer);
            active.timer = setTimeout(() => endWithError(active), 25000);
          } else if (pc.connectionState === "connected" && active.tile) {
            clearTimeout(active.timer);
          }
        };
        await answerOffer(active, event.sdp);
      } catch {
        if (current) {
          endWithError(current);
        } else {
          video.remove();
          videoRef.current = null;
          void projection.disconnect(event).catch(() => {});
          setError("projection.connectionError");
          setOpen(true);
        }
      }
    });
    void listener.catch(() => {
      if (mounted.current) {
        setError("projection.startError");
      }
    });
    return () => {
      mounted.current = false;
      activate.current = undefined;
      cancel();
      disposed = true;
      unwatch?.();
      if (nativeStarted.current) {
        nativeStarted.current = false;
        for (const protocol of nativeProtocols)
          void nativeProjection.stop({ protocol }).catch(() => {});
      }
      close();
      void listener
        .then((subscription) => subscription.remove())
        .catch(() => {});
      const current = receiver.current;
      receiver.current = undefined;
      if (current) {
        void projection.stop(current).catch(() => {});
      }
    };
  }, [api, supported]);

  useEffect(() => { activate.current?.(); }, [request, api, supported]);

  const receiving = stage !== "idle" || nativeProtocols.some((p) => native?.[p].state === "connected");
  useEffect(() => {
    if (receiving) return;
    const timeout = setTimeout(release, 5 * 60 * 1000);
    return () => clearTimeout(timeout);
  }, [request, receiving, release]);

  useEffect(() => {
    const visibility = () => {
      if (document.hidden && !choosingCertificate.current) release();
      if (!document.hidden) choosingCertificate.current = false;
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", release);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", release);
    };
  }, [release]);

  useEffect(() => {
    if (!fullscreen) {
      return;
    }
    void projection.immersive({ active: true }).catch(() => {});
    return () => {
      void projection.immersive({ active: false }).catch(() => {});
    };
  }, [fullscreen]);

  const start = async () => {
    if (!file || starting.current) {
      return;
    }
    if (file.size > 384 * 1024) {
      setError("projection.certificateSize");
      return;
    }
    starting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const certificate = await readCertificate(file);
      if (!mounted.current) return;
      const next = await projection.start({
        host,
        certificate,
        password,
      });
      if (!mounted.current) {
        await projection.stop(next);
        return;
      }
      receiver.current = next;
      setUrl(next.url);
      setPassword("");
      setFile(undefined);
    } catch (failure) {
      if (mounted.current) {
        setError(startErrorKey(failure));
      }
    } finally {
      starting.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  };

  const stop = async () => {
    const current = receiver.current;
    if (!current || starting.current) {
      return;
    }
    starting.current = true;
    setBusy(true);
    try {
      await projection.stop(current);
      receiver.current = undefined;
      setUrl("");
      setError(undefined);
    } catch {
      setError("projection.connectionError");
    } finally {
      starting.current = false;
      setBusy(false);
    }
  };

  const toggleFullscreen = () => {
    const tile = connection.current?.tile || nativeLive.current?.tile;
    const video = nativeLive.current?.video || videoRef.current;
    if (tile && video) {
      api.setSceneProjection?.({
        elementId: tile,
        video,
        fullscreen: !fullscreen,
      });
      setFullscreen(!fullscreen);
    }
  };

  const toggleNative = async (protocol: NativeProtocol, stop: boolean) => {
    setNativeBusy(protocol);
    setError(undefined);
    try {
      if (stop) await nativeProjection.stop({ protocol });
      else await nativeProjection.start({ protocol });
      if (mounted.current) setNative(await nativeProjection.status());
    } catch (failure) {
      if (mounted.current)
        setError(
          (failure as { code?: string })?.code === "PERMISSION"
            ? "projection.nearbyError"
            : "projection.startError",
        );
    } finally {
      if (mounted.current) setNativeBusy(undefined);
    }
  };

  const disconnect = () => {
    if (nativeLive.current) {
      void toggleNative(nativeLive.current.protocol, true);
      return;
    }
    const current = connection.current;
    if (current) {
      void projection.disconnect(current.sender).catch(() => {
        setError("projection.connectionError");
        setOpen(true);
      });
    }
  };

  return (
    <>
      {stage === "live" && (
        <div
          className="fc-projection__controls"
          aria-label={t("projection.title")}
        >
          <button type="button" onClick={toggleFullscreen}>
            {t(fullscreen ? "projection.restore" : "projection.fullscreen")}
          </button>
          {hasAudio && (
            <button
              type="button"
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.muted = !muted;
                  setMuted(!muted);
                }
              }}
            >
              {t(muted ? "projection.unmute" : "projection.mute")}
            </button>
          )}
          <button type="button" onClick={disconnect}>
            {t("projection.disconnect")}
          </button>
        </div>
      )}
      {open && (
        <MaterialPanel
          centered
          onDismiss={() => setOpen(false)}
          className="fc-projection"
          aria-label={t("projection.title")}
        >
          <header>
            <h2>
              <FactoryIcon name="media" />
              {t("projection.title")}
            </h2>
            <button
              type="button"
              aria-label={t("buttons.close")}
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>
          <div className="fc-projection__protocols">
            {nativeProtocols.map((protocol) => {
              const engine = native?.[protocol];
              const state =
                engine?.state ?? (supported ? "starting" : "unavailable");
              const running = [
                "waiting",
                "connecting",
                "connected",
                "starting",
              ].includes(state);
              return (
                <div key={protocol}>
                  <strong>
                    {protocol === "airplay" ? "AirPlay 2" : protocol === "dlna" ? "DLNA" : "Miracast"}
                  </strong>
                  <span>
                    {protocol === "airplay"
                      ? "iPhone · iPad · Mac"
                      : protocol === "dlna" ? t("projection.dlnaApps") : "Wi-Fi Direct · Win + K"}
                  </span>
                  {engine?.audio && <span>{engine.title || t("projection.audioPlayback")}</span>}
                  {engine?.name && <span>{engine.name}</span>}
                  <small
                    role="status"
                    data-ready={state === "waiting" || state === "connected"}
                  >
                    {t(
                      state === "unavailable" &&
                        protocol === "miracast" &&
                        supported
                        ? "projection.wfdUnavailable"
                        : nativeStatusKeys[state === "connected" && !engine?.hasFrames && !engine?.audio ? "connecting" : state],
                    )}
                  </small>
                  {supported && engine && state !== "unavailable" && (
                    <button
                      type="button"
                      disabled={!!nativeBusy || state === "starting"}
                      onClick={() => void toggleNative(protocol, running)}
                    >
                      {t(running ? "projection.stop" : "projection.start")}
                    </button>
                  )}
                </div>
              );
            })}
            <div>
              <strong>WebRTC</strong>
              <span>{t("projection.browser")}</span>
              <small data-ready={!!url} role="status">
                {t(
                  connection.current && stage === "live"
                    ? "projection.live"
                    : connection.current && stage === "connecting"
                    ? "projection.connecting"
                    : url
                    ? "projection.waiting"
                    : "projection.off",
                )}
              </small>
            </div>
          </div>
          {!supported ? (
            <p>{t("projection.androidOnly")}</p>
          ) : url ? (
            <div className="fc-projection__pairing">
              <QRCode key={url} value={url} />
              <div>
                <p>{t("projection.scan")}</p>
                <input
                  aria-label={t("projection.senderUrl")}
                  value={url}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void stop()}
                >
                  {t("projection.stop")}
                </button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void start();
              }}
            >
              <p>{t("projection.tls")}</p>
              <label>
                {t("projection.certificate")}
                <input
                  type="file"
                  accept=".p12,.pfx,application/x-pkcs12"
                  disabled={busy}
                  onClick={() => { choosingCertificate.current = true; }}
                  onChange={(event) => {
                    choosingCertificate.current = false;
                    setFile(event.target.files?.[0]);
                  }}
                />
              </label>
              <label>
                {t("projection.host")}
                <input
                  value={host}
                  disabled={busy}
                  onChange={(event) => setHost(event.target.value)}
                />
              </label>
              <label>
                {t("projection.password")}
                <input
                  type="password"
                  value={password}
                  disabled={busy}
                  autoComplete="off"
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <button type="submit" disabled={!file || busy}>
                {t(busy ? "projection.starting" : "projection.start")}
              </button>
            </form>
          )}
          {error && (
            <p className="fc-projection__error" role="alert">
              {t(error)}
            </p>
          )}
        </MaterialPanel>
      )}
    </>
  );
};
