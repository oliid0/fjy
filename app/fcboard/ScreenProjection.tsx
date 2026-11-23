import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { sceneCoordsToViewportCoords } from "@fcboard/common";
import {
  CaptureUpdateAction,
  newElement,
  newElementWith,
} from "@fcboard/element";
import { FactoryIcon } from "@fcboard/fcboard/components/FactoryIcon";
import { CloseIcon, fullscreenIcon } from "@fcboard/fcboard/components/icons";
import { useI18n } from "@fcboard/fcboard/i18n";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import type { NativeProjectionSurface } from "@fcboard/fcboard/scene/types";

import { QRCode } from "../share/QRCode";

import { classroomCommands } from "./commands";
import { MaterialPanel } from "./MaterialPanel";
import {
  nativeProjection,
  nativeProtocols,
  watchNativeProjection,
} from "./nativeProjection";

import "./ScreenProjection.scss";

import type { NativeProtocol, NativeReceivers } from "./nativeProjection";

import type { PluginListenerHandle } from "@capacitor/core";

type ProjectionSource =
  import("@fcboard/fcboard/scene/types").SceneProjection["video"];
type Receiver = {
  session: string;
  url: string;
  address: string;
};
type LocalNetwork = {
  address: string;
  name: string;
  transport: "wifi" | "ethernet" | "";
};
type Sender = { session: string; sender: string };
type Signal = Sender &
  ({ kind: "offer" | "restart"; sdp: string } | { kind: "left" });

const projection = registerPlugin<{
  start(options: { session: string }): Promise<Receiver>;
  network(options: { address?: string }): Promise<LocalNetwork>;
  answer(options: Sender & { sdp: string }): Promise<void>;
  disconnect(options: Sender): Promise<void>;
  stop(options: { session: string }): Promise<void>;
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

const startErrorKey = (error: unknown) =>
  (error as { code?: string } | null)?.code === "NETWORK"
    ? ("projection.networkError" as const)
    : ("projection.startError" as const);

type ProjectionErrorKey =
  | ReturnType<typeof startErrorKey>
  | "projection.connectionError";

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

function attachProjection(api: FcboardImperativeAPI, video: ProjectionSource) {
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

function resizeProjection(api: FcboardImperativeAPI, video: ProjectionSource) {
  const current = api.getSceneProjection?.();
  if (!current || current.video !== video) {
    return;
  }
  const tile = api.getSceneElementsMapIncludingDeleted().get(current.elementId);
  const ratio =
    "position" in video
      ? video.width / video.height
      : video.videoWidth / video.videoHeight;
  if (!tile || tile.isDeleted || !Number.isFinite(ratio) || ratio <= 0) {
    return;
  }
  if (Math.abs(tile.width - tile.height * ratio) > 0.5) {
    const state = api.getAppState();
    const width = Math.min(
      Math.sqrt(tile.width * tile.height * ratio),
      state.width / state.zoom.value,
      (state.height * ratio) / state.zoom.value,
    );
    const height = width / ratio;
    api.updateScene({
      elements: api.getSceneElementsIncludingDeleted().map((element) =>
        element.id === tile.id
          ? newElementWith(element, {
              x: tile.x + (tile.width - width) / 2,
              y: tile.y + (tile.height - height) / 2,
              width,
              height,
            })
          : element,
      ),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }
  api.setSceneProjection?.({ ...current, video });
}

const restoreIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 9h5V4m6 0v5h5M4 15h5v5m11-5h-5v5" />
  </svg>
);

function projectionWindow(api: FcboardImperativeAPI) {
  const cast = api.getSceneProjection?.();
  const bounds = api.getAppState();
  if (!cast) {
    return;
  }
  if (cast.fullscreen) {
    const { offsetLeft, offsetTop, width, height } = bounds;
    return {
      x: offsetLeft + width / 2,
      y: offsetTop + height / 2,
      width,
      height,
      angle: 0,
    };
  }
  const tile = api.getSceneElementsMapIncludingDeleted().get(cast.elementId);
  if (!tile || tile.isDeleted) {
    return;
  }
  const center = sceneCoordsToViewportCoords(
    { sceneX: tile.x + tile.width / 2, sceneY: tile.y + tile.height / 2 },
    bounds,
  );
  return {
    ...center,
    width: Math.abs(tile.width * bounds.zoom.value),
    height: Math.abs(tile.height * bounds.zoom.value),
    angle: tile.angle,
  };
}

const CONTROLS_TIMEOUT = 3000;
const TAP_SLOP = 10;

function ProjectionControls({
  api,
  fullscreen,
  onFullscreen,
  onDisconnect,
}: {
  api: FcboardImperativeAPI;
  fullscreen: boolean;
  onFullscreen: () => void;
  onDisconnect: () => void;
}) {
  const { t } = useI18n();
  const controls = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showing = useRef(true);
  const reveal = useCallback(() => {
    showing.current = true;
    setVisible(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      showing.current = false;
      setVisible(false);
    }, CONTROLS_TIMEOUT);
  }, []);

  useLayoutEffect(() => {
    const board = document.querySelector(
      `.fcboard[data-fcboard-id="${CSS.escape(api.id)}"]`,
    );
    const overlay = controls.current;
    if (!board || !overlay) {
      return;
    }
    let pressed: { id: number; x: number; y: number } | undefined;
    const contains = (event: { clientX: number; clientY: number }) => {
      if (fullscreen) {
        return true;
      }
      const frame = projectionWindow(api);
      if (!frame) {
        return false;
      }
      const dx = event.clientX - frame.x;
      const dy = event.clientY - frame.y;
      const cos = Math.cos(frame.angle);
      const sin = Math.sin(frame.angle);
      return (
        Math.abs(dx * cos + dy * sin) <= frame.width / 2 &&
        Math.abs(dy * cos - dx * sin) <= frame.height / 2
      );
    };
    const position = () => {
      const frame = projectionWindow(api);
      if (!frame) {
        overlay.hidden = true;
        return;
      }
      const cos = Math.cos(frame.angle);
      const sin = Math.sin(frame.angle);
      const right = frame.x + (frame.width * cos + frame.height * sin) / 2;
      const top = frame.y + (frame.width * sin - frame.height * cos) / 2;
      const halfWidth =
        (frame.width * Math.abs(cos) + frame.height * Math.abs(sin)) / 2;
      const halfHeight =
        (frame.width * Math.abs(sin) + frame.height * Math.abs(cos)) / 2;
      const boardBounds = board.getBoundingClientRect();
      const hidden =
        frame.x + halfWidth < boardBounds.left ||
        frame.x - halfWidth > boardBounds.right ||
        frame.y + halfHeight < boardBounds.top ||
        frame.y - halfHeight > boardBounds.bottom;
      if (overlay.hidden !== hidden) {
        overlay.hidden = hidden;
      }
      const rightEdge = Math.min(
        boardBounds.right,
        Math.max(boardBounds.left + overlay.offsetWidth + 12, right),
      );
      const topEdge = Math.max(
        boardBounds.top,
        Math.min(top, boardBounds.bottom - overlay.offsetHeight - 12),
      );
      const rightOffset = `${innerWidth - rightEdge}px`;
      const topOffset = `${topEdge}px`;
      if (overlay.style.getPropertyValue("--cast-right") !== rightOffset) {
        overlay.style.setProperty("--cast-right", rightOffset);
      }
      if (overlay.style.getPropertyValue("--cast-top") !== topOffset) {
        overlay.style.setProperty("--cast-top", topOffset);
      }
    };
    const tap = () => {
      if (fullscreen && showing.current) {
        clearTimeout(timer.current);
        showing.current = false;
        setVisible(false);
      } else {
        reveal();
      }
    };
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) {
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest(".fc-projection__controls, .fc-unified-toolbar")
      ) {
        if (fullscreen || overlay.contains(event.target)) {
          reveal();
        }
        return;
      }
      if (
        event.target instanceof Element &&
        board.contains(event.target) &&
        (fullscreen ||
          event.target.matches(
            "canvas.interactive, .fcboard__canvas-wrapper",
          )) &&
        contains(event)
      ) {
        pressed = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }
    };
    const up = (event: PointerEvent) => {
      if (pressed?.id !== event.pointerId) {
        return;
      }
      if (
        Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) <=
          TAP_SLOP &&
        contains(event)
      ) {
        tap();
      }
      pressed = undefined;
    };
    const move = (event: PointerEvent) => {
      if (
        pressed?.id === event.pointerId &&
        Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) >
          TAP_SLOP
      ) {
        pressed = undefined;
      }
    };
    const cancel = () => {
      pressed = undefined;
    };
    const nativeTap = (event: Event) => {
      const { owner, clientX, clientY } = (
        event as CustomEvent<{
          owner: string;
          clientX: number;
          clientY: number;
        }>
      ).detail;
      if (owner === api.id && contains({ clientX, clientY })) {
        tap();
      }
    };
    const unsubscribe = api.onChange(position);
    position();
    if (fullscreen) {
      showing.current = false;
      setVisible(false);
      clearTimeout(timer.current);
    } else {
      reveal();
    }
    window.addEventListener("resize", position);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("fcboard:projection-tap", nativeTap);
    return () => {
      clearTimeout(timer.current);
      unsubscribe();
      window.removeEventListener("resize", position);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("fcboard:projection-tap", nativeTap);
    };
  }, [api, fullscreen, reveal]);

  useLayoutEffect(() => {
    if (!fullscreen) {
      return;
    }
    const prior = api.getAppState().toolbarHidden;
    const board = document.querySelector(
      `.fcboard[data-fcboard-id="${CSS.escape(api.id)}"]`,
    );
    board?.classList.add("fc-projection-fullscreen");
    return () => {
      board?.classList.remove("fc-projection-fullscreen");
      api.updateScene({ appState: { toolbarHidden: prior } });
    };
  }, [api, fullscreen]);

  useLayoutEffect(() => {
    if (fullscreen) {
      api.updateScene({ appState: { toolbarHidden: !visible } });
    }
  }, [api, fullscreen, visible]);

  const fullscreenLabel = t(
    fullscreen ? "projection.restore" : "projection.fullscreen",
  );
  const disconnectLabel = t("projection.disconnect");
  return (
    <div
      ref={controls}
      className={
        visible
          ? "fc-projection__controls fc-projection__controls--visible"
          : "fc-projection__controls"
      }
    >
      <button
        type="button"
        aria-label={fullscreenLabel}
        onClick={(event) => {
          event.currentTarget.blur();
          onFullscreen();
        }}
      >
        {fullscreen ? restoreIcon : fullscreenIcon}
      </button>
      <button type="button" aria-label={disconnectLabel} onClick={onDisconnect}>
        {CloseIcon}
      </button>
    </div>
  );
}

export const ScreenProjection = ({ api }: { api: FcboardImperativeAPI }) => {
  const [request, setRequest] = useState(0);
  const release = useCallback(() => setRequest(0), []);
  useEffect(
    () =>
      classroomCommands.register("projection.open", "@internal", () => {
        setRequest((previous) => previous + 1);
      }),
    [],
  );
  return request ? (
    <ProjectionSession api={api} request={request} release={release} />
  ) : null;
};

const ProjectionSession = ({
  api,
  request,
  release,
}: {
  api: FcboardImperativeAPI;
  request: number;
  release: () => void;
}) => {
  const { t } = useI18n();
  const supported =
    Capacitor.getPlatform() === "android" && !!api.setSceneProjection;
  const receiver = useRef<Receiver>(undefined);
  const connection = useRef<Connection>(undefined);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const nativeLive = useRef<{
    revision: number;
    protocol: NativeProtocol;
    tile: string;
    video: NativeProjectionSurface;
  }>(undefined);
  const [native, setNative] = useState<NativeReceivers>();
  const disconnectCurrent = useRef<() => void>(undefined);
  const [open, setOpen] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [foreground, setForeground] = useState(() => !document.hidden);
  const [web, setWeb] = useState<Receiver>();
  const [network, setNetwork] = useState<LocalNetwork>();
  const [webError, setWebError] = useState<ProjectionErrorKey>();
  const [nativeError, setNativeError] = useState(false);
  const [error, setError] = useState<ProjectionErrorKey>();
  const [stage, setStage] = useState<"idle" | "connecting" | "live">("idle");
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!enabled || !foreground || !supported) {
      return;
    }
    const session = crypto.randomUUID();
    let disposed = false;
    const dismissed = new Map<NativeProtocol, number>();
    const close = () => {
      const current = connection.current;
      const video = videoRef.current;
      const tile = current?.tile || nativeLive.current?.tile;
      if (!current && !nativeLive.current) {
        return;
      }
      connection.current = undefined;
      if (nativeLive.current) {
        document.documentElement.classList.remove("fc-native-projection");
      }
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
      if (!disposed) {
        setStage("idle");
        setFullscreen(false);
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
    const stopSender = () => {
      const current = connection.current;
      const source = nativeLive.current;
      source?.video.position(null);
      close();
      if (current) {
        void projection.disconnect(current.sender).catch(() => {});
      }
      if (source) {
        const { protocol, revision } = source;
        dismissed.set(protocol, revision);
        void nativeProjection
          .disconnect({ protocol, session, revision })
          .catch(() => {
            if (!disposed) {
              setNativeError(true);
            }
          });
      }
    };
    let latestRevision = 0;
    let minimumRevision = 0;
    const unwatch = watchNativeProjection(
      session,
      (receivers) => {
        latestRevision = Math.max(
          latestRevision,
          ...nativeProtocols.map((p) => receivers[p].revision),
        );
        setNative(receivers);
      },
      (protocol, revision) =>
        revision >= minimumRevision && dismissed.get(protocol) !== revision,
      (protocol, video, revision) => {
        if (connection.current) {
          stopSender();
        }
        minimumRevision = revision;
        if (nativeLive.current) {
          nativeLive.current.video = video;
          resizeProjection(api, video);
          return;
        }
        document.documentElement.classList.add("fc-native-projection");
        nativeLive.current = {
          revision,
          protocol,
          video,
          tile: attachProjection(api, video),
        };
        setStage("live");
        setError(undefined);
        setOpen(false);
      },
      (protocol, replaced) => {
        if (nativeLive.current?.protocol === protocol) {
          if (replaced) {
            stopSender();
          } else {
            close();
          }
          if (!disposed) {
            setOpen(true);
          }
        }
      },
      () => setNativeError(true),
    );
    disconnectCurrent.current = () => {
      stopSender();
      setOpen(true);
    };

    const cancel = api.onChange((elements) => {
      const current = connection.current;
      const nativeSource = nativeLive.current;
      const tile = current?.tile || nativeSource?.tile;
      if (
        tile &&
        !elements.some((element) => element.id === tile && !element.isDeleted)
      ) {
        stopSender();
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
      if (disposed || session !== event.session) {
        return;
      }
      if (event.kind === "left") {
        if (connection.current?.sender.sender === event.sender) {
          close();
          setOpen(true);
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
      if (connection.current) {
        void projection.disconnect(event).catch(() => {});
        return;
      }
      minimumRevision = latestRevision + 1;
      if (nativeLive.current) {
        stopSender();
      }
      const video = document.createElement("video");
      video.playsInline = true;
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
          if (connection.current === active) {
            resizeProjection(api, video);
          }
        };
        const stream = new MediaStream();
        pc.ontrack = ({ track }) => {
          if (connection.current !== active) {
            return;
          }
          stream.addTrack(track);
          if (track.kind !== "video") {
            return;
          }
          track.addEventListener(
            "ended",
            () => {
              if (connection.current === active) {
                close();
                setOpen(true);
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
          if (connection.current !== active) {
            return;
          }
          if (
            pc.connectionState === "failed" ||
            pc.connectionState === "disconnected"
          ) {
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
    let networkTimer: ReturnType<typeof setTimeout>;
    const refreshWeb = async () => {
      try {
        const current = receiver.current;
        const nextNetwork = await projection.network({
          address: current?.address,
        });
        if (disposed) {
          return;
        }
        setNetwork(nextNetwork);
        if (current && current.address !== nextNetwork.address) {
          receiver.current = undefined;
          setWeb(undefined);
          if (connection.current) {
            close();
          }
          await projection.stop(current);
        }
        if (disposed) {
          return;
        }
        if (!nextNetwork.address) {
          setWebError("projection.networkError");
        } else if (!receiver.current) {
          const next = await projection.start({ session });
          if (disposed) {
            await projection.stop(next);
          } else {
            receiver.current = next;
            setWeb(next);
            setWebError(undefined);
          }
        }
      } catch (failure) {
        if (!disposed) {
          setWebError(startErrorKey(failure));
        }
      } finally {
        if (!disposed) {
          networkTimer = setTimeout(() => void refreshWeb(), 3000);
        }
      }
    };
    void listener
      .then(() => {
        if (!disposed) {
          void refreshWeb();
        }
      })
      .catch((failure) => {
        if (!disposed) {
          setWebError(startErrorKey(failure));
        }
      });
    const startNative = async () => {
      // Capacitor permission requests share the foreground Activity.
      for (const protocol of [
        "airplay",
        "dlna",
        "cast",
        "miracast",
        "castplus",
      ] as const) {
        if (disposed) {
          return;
        }
        try {
          await nativeProjection.start({ protocol, session });
        } catch (failure) {
          if (
            !disposed &&
            (failure as { code?: string }).code !== "UNAVAILABLE"
          ) {
            setNativeError(true);
          }
        }
      }
    };
    void startNative();
    return () => {
      disposed = true;
      clearTimeout(networkTimer);
      disconnectCurrent.current = undefined;
      cancel();
      unwatch();
      for (const protocol of nativeProtocols) {
        void nativeProjection.stop({ protocol, session }).catch(() => {});
      }
      close();
      void listener
        .then((subscription) => subscription.remove())
        .catch(() => {});
      receiver.current = undefined;
      void projection.stop({ session }).catch(() => {});
    };
  }, [api, enabled, foreground, supported]);

  useEffect(() => {
    setOpen(true);
  }, [request]);

  useEffect(() => {
    if (!supported || !open || enabled) {
      return;
    }
    let disposed = false;
    void projection
      .network({})
      .then((next) => {
        if (!disposed) {
          setNetwork(next);
        }
      })
      .catch(() => {
        if (!disposed) {
          setNetwork(undefined);
        }
      });
    return () => {
      disposed = true;
    };
  }, [enabled, open, supported]);

  useEffect(() => {
    const visibility = () => {
      setForeground(!document.hidden);
      if (document.hidden) {
        setWeb(undefined);
        setWebError(undefined);
        setError(undefined);
        setNative(undefined);
        setNativeError(false);
        setStage("idle");
        setFullscreen(false);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", release);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", release);
    };
  }, [release]);

  const toggleReception = (active: boolean) => {
    setEnabled(active);
    setError(undefined);
    setWeb(undefined);
    setWebError(undefined);
    setNative(undefined);
    setNativeError(false);
    setStage("idle");
    setFullscreen(false);
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

  const dismiss = () => {
    if (enabled) {
      setOpen(false);
    } else {
      release();
    }
  };
  const readyNames = nativeProtocols
    .map((protocol) => native?.[protocol])
    .filter(
      (engine) =>
        engine &&
        [
          "waiting",
          "connecting",
          "connected",
          "p2pGroup",
          "systemManaged",
        ].includes(engine.state),
    );
  const ready = !!web || readyNames.length > 0;
  const nativeConnecting = readyNames.some(
    (engine) => engine?.state === "connecting",
  );
  const playingTitle = readyNames.find(
    (engine) => engine?.state === "connected" && engine.audio,
  );
  const networkName =
    network?.name ||
    (network?.transport === "wifi"
      ? "Wi-Fi"
      : network?.transport === "ethernet"
      ? t("projection.ethernet")
      : "");

  return (
    <>
      {stage === "live" && (
        <ProjectionControls
          api={api}
          fullscreen={fullscreen}
          onFullscreen={toggleFullscreen}
          onDisconnect={() => disconnectCurrent.current?.()}
        />
      )}
      {open && (
        <MaterialPanel
          centered
          onDismiss={dismiss}
          className="fc-share-qr-dialog fc-projection"
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
              onClick={dismiss}
            >
              ×
            </button>
          </header>
          <div className="fc-qr-content">
            <label className="fc-qr-protection">
              <span>{t("projection.start")}</span>
              <span className="fc-qr-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={enabled}
                  disabled={!supported}
                  onChange={(event) => toggleReception(event.target.checked)}
                />
                <span className="fc-qr-switch-track" aria-hidden="true" />
              </span>
            </label>
            <div className="fc-qr-image fc-projection__qr" role="status">
              {web ? (
                <QRCode key={web.url} value={web.url} />
              ) : (
                <span>
                  {t(
                    !supported
                      ? "projection.androidOnly"
                      : !enabled
                      ? "projection.off"
                      : webError || "projection.starting",
                  )}
                </span>
              )}
            </div>
            <p className="fc-projection__network">
              {[networkName, network?.address].filter(Boolean).join(" · ") ||
                t("projection.networkError")}
            </p>
            {enabled && (ready || stage === "connecting") && (
              <p role="status">
                {stage === "connecting" || nativeConnecting
                  ? t("projection.connecting")
                  : playingTitle
                  ? playingTitle.title || t("projection.audioPlayback")
                  : [
                      ...new Set(
                        readyNames
                          .map((engine) => engine?.name)
                          .filter(Boolean),
                      ),
                    ].join(" · ") || t("projection.waiting")}
              </p>
            )}
            {enabled &&
              (error ||
                nativeError ||
                nativeProtocols.some(
                  (protocol) => native?.[protocol].state === "error",
                )) && (
                <p className="fc-projection__error" role="alert">
                  {t(error || "projection.nativeError")}
                </p>
              )}
            {enabled && native?.miracast.state === "p2pGroup" && (
              <p>{t("projection.miracastGroup")}</p>
            )}
            {enabled && native?.miracast.state === "systemManaged" && (
              <p>{t("projection.miracastSystemManaged")}</p>
            )}
            {enabled && native?.miracast.state === "unavailable" && (
              <p>{t("projection.miracastUnavailable")}</p>
            )}
          </div>
        </MaterialPanel>
      )}
    </>
  );
};
