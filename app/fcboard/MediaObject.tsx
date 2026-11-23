import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";
import { ResourceWindow } from "@fcboard/fcboard/components/ResourceWindow";

import type { InteractiveResourceFrameProps } from "@fcboard/fcboard/components/InteractiveResourceFrame";

import { nativeErrorMessage } from "./nativeErrorMessage";
import { classroomCommands } from "./commands";
import { Media } from "./builtinNative";
import { pendingMediaPlayback, readMediaFiles } from "./mediaPlaylist";

import type { MediaAction } from "./builtinNative";

const nativeLabels = () => ({
  title: t("fcboard.media"),
  close: t("buttons.close"),
  play: t("fcboard.media_play"),
  pause: t("fcboard.media_pause"),
  previous: t("fcboard.media_previous"),
  next: t("fcboard.media_next"),
  speed: t("fcboard.media_speed"),
  seek: t("fcboard.media_seek"),
  enhance: t("fcboard.media_enhance"),
  fullscreen: t("fcboard.fullscreen"),
  exitFullscreen: t("fcboard.media_exit_fullscreen"),
  volume: t("fcboard.media_volume"),
  off: t("fcboard.media_enhance_off"),
  low: t("fcboard.media_enhance_low"),
  medium: t("fcboard.media_enhance_medium"),
  high: t("fcboard.media_enhance_high"),
  loading: t("fcboard.media_enhance_loading"),
  unavailable: t("fcboard.media_enhance_error"),
});

const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

type LocalMedia = { name: string; url: string; video: boolean };
const mediaFile = (file: File): LocalMedia => ({
  name: file.name,
  url: URL.createObjectURL(file),
  video:
    file.type.startsWith("video/") ||
    (!file.type && /\.(mp4|webm|mkv|mov|avi|m4v|ogv)$/i.test(file.name)),
});

const playbackState = (node: HTMLMediaElement) => ({
  playing: !node.paused && !node.ended,
  position: node.currentTime,
  duration: Number.isFinite(node.duration) ? node.duration : -1,
  speed: node.playbackRate,
  volume: node.volume,
  error: node.error?.message || "",
});
const start = {
  playing: false,
  position: 0,
  duration: -1,
  speed: 1,
  volume: 1,
  error: "",
};

const clock = (seconds: number) => {
  if (seconds < 0) {
    return "–:––";
  }
  const elapsed = Math.floor(seconds);
  return elapsed >= 3600
    ? [Math.floor(elapsed / 3600), Math.floor(elapsed / 60) % 60, elapsed % 60]
        .map((part, i) => (i ? String(part).padStart(2, "0") : part))
        .join(":")
    : `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
};

export const MediaObject = (props: InteractiveResourceFrameProps) =>
  Capacitor.isNativePlatform() ? (
    <NativeMediaObject {...props} />
  ) : (
    <BrowserMediaObject {...props} />
  );

const BrowserMediaObject = ({
  resource,
  objectId,
  window: frame,
}: InteractiveResourceFrameProps) => {
  const [error, setError] = useState("");
  const [items, setItems] = useState<LocalMedia[]>([]);
  const [index, setIndex] = useState(0);
  const [playback, setPlayback] = useState(start);
  const [controls, setControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [boosted, setBoosted] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const autoplay = useRef(false);
  const video = useRef<HTMLVideoElement>(null);
  const current = useRef({ items, index });
  const held = useRef<{ x: number; timer: number; rate?: number } | undefined>(
    undefined,
  );
  const tap = useRef<number | undefined>(undefined);
  const skipTap = useRef(false);
  current.current = { items, index };
  const item = items[index];

  const sync = () => {
    if (video.current) {
      setPlayback(playbackState(video.current));
    }
  };
  const endBoost = useCallback(() => {
    if (!held.current) {
      return;
    }
    window.clearTimeout(held.current.timer);
    if (held.current.rate !== undefined && video.current) {
      video.current.playbackRate = held.current.rate;
      setBoosted(false);
    }
    held.current = undefined;
  }, []);
  const showControls = useCallback((show = true) => setControls(show), []);
  const changeTrack = useCallback(
    (target: number) => {
      const list = current.current.items;
      if (
        target < 0 ||
        target >= list.length ||
        target === current.current.index
      ) {
        return current.current.index;
      }
      endBoost();
      current.current.index = target;
      setIndex(target);
      setPlayback({ ...start, speed: video.current?.playbackRate ?? 1 });
      if (
        !list[target].video &&
        document.fullscreenElement === panel.current &&
        document.fullscreenElement
      ) {
        void document
          .exitFullscreen()
          .catch((failure) => setError(String(failure)));
      }
      showControls(!list[target].video);
      return target;
    },
    [endBoost, showControls],
  );
  const key = resource.media!.key;
  useEffect(() => {
    let live = true;
    let urls: LocalMedia[] = [];
    void readMediaFiles(key)
      .then((files) => {
        if (!live) {
          return;
        }
        if (!files?.length) {
          throw new Error(t("fcboard.media_choose"));
        }
        urls = files.map(mediaFile);
        autoplay.current = pendingMediaPlayback.delete(key);
        setItems(urls);
        current.current = { items: urls, index: 0 };
        showControls(!urls[0].video);
      })
      .catch((failure) => {
        if (live) {
          setError(String(failure));
        }
      });
    const changed = () =>
      setFullscreen(document.fullscreenElement === panel.current);
    document.addEventListener("fullscreenchange", changed);
    return () => {
      live = false;
      urls.forEach(({ url }) => URL.revokeObjectURL(url));
      window.clearTimeout(tap.current);
      window.clearTimeout(held.current?.timer);
      document.removeEventListener("fullscreenchange", changed);
    };
  }, [key, showControls]);
  useEffect(() => {
    return classroomCommands.register(
      `media.object.${objectId}`,
      "@internal",
      async (args) => {
        const action = args as MediaAction;
        const node = video.current;
        if (action.action === "close") {
          frame?.onClose();
          return { open: false };
        }
        if (!node) {
          if (action.action === "read") {
            return { open: false };
          }
          throw new Error(t("fcboard.media_choose"));
        }
        switch (action.action) {
          case "play":
            await node.play();
            break;
          case "pause":
            node.pause();
            break;
          case "seek":
            if (
              typeof action.seconds !== "number" ||
              !Number.isFinite(action.seconds) ||
              action.seconds < 0 ||
              !Number.isFinite(node.duration) ||
              action.seconds > node.duration
            ) {
              throw new Error(t("fcboard.invalid_style_parameters"));
            }
            node.currentTime = action.seconds;
            break;
          case "speed":
            if (
              typeof action.speed !== "number" ||
              !Number.isFinite(action.speed) ||
              action.speed < 0.25 ||
              action.speed > 3
            ) {
              throw new Error(t("fcboard.invalid_style_parameters"));
            }
            endBoost();
            node.playbackRate = action.speed;
            break;
          case "enhance":
            throw new Error(t("fcboard.media_enhance_android"));
          case "next":
          case "previous": {
            const old = current.current.index;
            const next = changeTrack(old + (action.action === "next" ? 1 : -1));
            if (next !== old) {
              return {
                open: true,
                ...start,
                speed: node.playbackRate,
                index: next,
                items: current.current.items.map(({ name }) => name),
              };
            }
          }
        }
        return {
          open: true,
          ...playbackState(node),
          index: current.current.index,
          items: current.current.items.map(({ name }) => name),
        };
      },
    );
  }, [objectId, frame, changeTrack, endBoost]);
  const togglePlayback = () => {
    const node = video.current;
    if (!node) {
      return;
    }
    if (node.paused || node.ended) {
      void node.play().catch((failure) =>
        setPlayback((old) => ({
          ...old,
          error: nativeErrorMessage(String(failure)),
        })),
      );
    } else {
      node.pause();
    }
  };

  if (!frame) {
    return <span>{resource.title}</span>;
  }
  return (
    <div
      ref={panel}
      className="fc-media-player fc-media-object"
      data-video={item?.video || undefined}
      data-hide-controls={
        (!!item?.video && !controls && !error && !playback.error) || undefined
      }
    >
      <ResourceWindow
        {...frame}
        title={item?.name || resource.title}
        headerActions={
          <button
            type="button"
            aria-label={t("buttons.close")}
            onClick={frame.onClose}
          >
            ×
          </button>
        }
      >
        {!item && !error && <progress aria-label={resource.title} />}
        {error && <p role="alert">{nativeErrorMessage(error)}</p>}
        {item && (
          <>
            <video
              ref={video}
              src={item.url}
              hidden={!item.video}
              autoPlay={autoplay.current}
              playsInline
              onTimeUpdate={sync}
              onDurationChange={sync}
              onVolumeChange={sync}
              onLoadedMetadata={({ currentTarget }) => {
                if (!currentTarget.videoWidth || !currentTarget.videoHeight) {
                  return;
                }
                const ratio =
                  currentTarget.videoWidth / currentTarget.videoHeight;
                const box = frame.bounds;
                const width = Math.min(box.width, box.height * ratio);
                frame.onCommit({ ...box, width, height: width / ratio });
              }}
              onPlay={() => {
                autoplay.current = true;
                sync();
              }}
              onPlaying={sync}
              onPause={sync}
              onRateChange={sync}
              onError={() => {
                sync();
                showControls();
              }}
              onEnded={() => {
                sync();
                changeTrack(index + 1);
              }}
              onClick={() => {
                if (skipTap.current) {
                  skipTap.current = false;
                  return;
                }
                window.clearTimeout(tap.current);
                tap.current = window.setTimeout(
                  () => showControls(!controls),
                  275,
                );
              }}
              onDoubleClick={() => {
                window.clearTimeout(tap.current);
                if (!skipTap.current) {
                  togglePlayback();
                }
              }}
              onPointerDown={(event) => {
                skipTap.current = false;
                const node = event.currentTarget;
                const bounds = node.getBoundingClientRect();
                const x = (event.clientX - bounds.left) / bounds.width;
                if (!node.paused && (x <= 0.25 || x >= 0.75)) {
                  held.current = {
                    x: event.clientX,
                    timer: window.setTimeout(() => {
                      if (!held.current || node.paused) {
                        return;
                      }
                      held.current.rate = node.playbackRate;
                      node.playbackRate = 2;
                      setBoosted(true);
                      skipTap.current = true;
                    }, 480),
                  };
                  node.setPointerCapture(event.pointerId);
                }
              }}
              onPointerMove={(event) => {
                if (
                  held.current?.rate === undefined &&
                  held.current &&
                  Math.abs(event.clientX - held.current.x) > 12
                ) {
                  endBoost();
                }
              }}
              onPointerUp={endBoost}
              onPointerCancel={endBoost}
              onLostPointerCapture={endBoost}
            />
            {boosted && <output className="fc-media-boost">2×</output>}
            {(!item.video || controls || !!playback.error) && (
              <div
                className="fc-builtin-body fc-media-controls"
                onPointerDown={() => showControls()}
              >
                <label>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(1, playback.duration)}
                    step={0.01}
                    aria-label={t("fcboard.media_seek")}
                    disabled={playback.duration <= 0}
                    value={playback.position}
                    onChange={(event) => {
                      if (video.current) {
                        video.current.currentTime = Number(event.target.value);
                      }
                      sync();
                    }}
                  />
                  <output>
                    {clock(playback.position)} / {clock(playback.duration)}
                  </output>
                </label>
                <div className="fc-builtin-row">
                  <button
                    type="button"
                    disabled={index === 0}
                    aria-label={t("fcboard.media_previous")}
                    onClick={() => changeTrack(index - 1)}
                  >
                    ⏮
                  </button>
                  <button
                    type="button"
                    onClick={togglePlayback}
                    aria-label={t(
                      playback.playing
                        ? "fcboard.media_pause"
                        : "fcboard.media_play",
                    )}
                  >
                    {playback.playing ? "Ⅱ" : "▶"}
                  </button>
                  <button
                    type="button"
                    disabled={index === items.length - 1}
                    aria-label={t("fcboard.media_next")}
                    onClick={() => changeTrack(index + 1)}
                  >
                    ⏭
                  </button>
                  <select
                    aria-label={t("fcboard.media_speed")}
                    value={playback.speed}
                    onChange={(event) => {
                      if (video.current) {
                        video.current.playbackRate = Number(event.target.value);
                      }
                      sync();
                    }}
                  >
                    {Array.from(new Set([...speeds, playback.speed]))
                      .sort((a, b) => a - b)
                      .map((rate) => (
                        <option key={rate} value={rate}>
                          {rate}×
                        </option>
                      ))}
                  </select>
                  {items.length > 1 && (
                    <select
                      aria-label={t("fcboard.media_playlist")}
                      value={index}
                      onChange={(event) =>
                        changeTrack(Number(event.target.value))
                      }
                    >
                      {items.map((entry, i) => (
                        <option key={entry.url} value={i}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {item.video && (
                    <button
                      type="button"
                      onClick={() => {
                        const change = document.fullscreenElement
                          ? document.exitFullscreen()
                          : panel.current!.requestFullscreen();
                        void change.catch((failure) =>
                          setError(String(failure)),
                        );
                      }}
                      aria-label={t(
                        fullscreen
                          ? "fcboard.media_exit_fullscreen"
                          : "fcboard.fullscreen",
                      )}
                    >
                      ⛶
                    </button>
                  )}
                  <input
                    type="range"
                    className="fc-media-volume"
                    min={0}
                    max={1}
                    step={0.01}
                    aria-label={t("fcboard.media_volume")}
                    value={playback.volume}
                    onChange={(event) => {
                      if (video.current) {
                        video.current.volume = Number(event.target.value);
                      }
                      sync();
                    }}
                  />
                </div>
                {playback.error && (
                  <p role="alert">{nativeErrorMessage(playback.error)}</p>
                )}
              </div>
            )}
          </>
        )}
      </ResourceWindow>
    </div>
  );
};

const NativeMediaObject = ({
  selectedForMove,
  resource,
  objectId,
  window: frame,
}: InteractiveResourceFrameProps) => {
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(frame);
  latest.current = frame;
  const [error, setError] = useState("");
  const active = useRef(false);
  const bounds = () => {
    const box = root.current!.getBoundingClientRect();
    return {
      x: box.left,
      y: box.top,
      width: box.width,
      height: box.height,
      viewport: window.innerWidth,
      selected: root.current!.dataset.selectedForMove === "true",
    };
  };
  const key = resource.media!.key;
  const activate = useCallback(async () => {
    setError("");
    active.current = true;
    try {
      const result = await Media.activate({
        key,
        owner: objectId,
        bounds: bounds(),
        labels: nativeLabels(),
      });
      if (active.current) {
        root.current?.setAttribute("data-native-playing", "");
      }
      return result;
    } catch (failure) {
      active.current = false;
      root.current?.removeAttribute("data-native-playing");
      setError(nativeErrorMessage(String(failure)));
      throw failure;
    }
  }, [key, objectId]);
  useEffect(() => {
    let mounted = true;
    let update = 0;
    let last = "";
    const place = () => {
      if (!active.current || !root.current) {
        return;
      }
      const rect = bounds();
      const signature = JSON.stringify(rect);
      if (last !== signature) {
        last = signature;
        void Media.place({ owner: objectId, bounds: rect }).catch((failure) => {
          if (mounted) {
            setError(nativeErrorMessage(String(failure)));
          }
        });
      }
    };
    const schedule = () => {
      if (!update) {
        update = requestAnimationFrame(() => {
          update = 0;
          place();
        });
      }
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(root.current!);
    const positions = new MutationObserver(schedule);
    for (
      let parent: HTMLElement | null = root.current;
      parent;
      parent = parent.parentElement
    ) {
      positions.observe(parent, {
        attributes: true,
        attributeFilter: [
          "style",
          "class",
          "x",
          "y",
          "transform",
          "viewBox",
          "data-selected-for-move",
        ],
      });
    }
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const listener = Media.addListener("mediaWindow", (event) => {
      if (!mounted || event.owner !== objectId) {
        return;
      }
      const current = latest.current;
      if (event.action === "move" && current) {
        const scale = current.scale || 1;
        const box = current.bounds;
        current.onCommit({
          x: box.x + (event.dx ?? 0) / scale,
          y: box.y + (event.dy ?? 0) / scale,
          width: box.width + (event.dw ?? 0) / scale,
          height: box.height + (event.dh ?? 0) / scale,
        });
      } else {
        active.current = false;
        root.current?.removeAttribute("data-native-playing");
        if (event.action === "close") {
          current?.onClose();
        }
      }
    });
    void listener
      .then(() => {
        if (mounted && pendingMediaPlayback.delete(key)) {
          void activate().catch(() => {});
        }
      })
      .catch((failure) => {
        if (mounted) {
          setError(String(failure));
        }
      });
    const stop = classroomCommands.register(
      `media.object.${objectId}`,
      "@internal",
      async (args) => {
        const action = args as MediaAction;
        if (action.action === "close") {
          latest.current?.onClose();
          return { open: false };
        }
        if (action.action === "play" && !active.current) {
          return activate();
        }
        return Media.action({ ...action, owner: objectId });
      },
    );
    return () => {
      mounted = false;
      resize.disconnect();
      positions.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(update);
      stop();
      void listener.then((handle) => handle.remove()).catch(() => {});
      if (active.current) {
        void Media.action({ action: "close", owner: objectId }).catch(() => {});
      }
      active.current = false;
    };
  }, [activate, key, objectId]);
  return (
    <div
      ref={root}
      className="fc-media-object"
      data-selected-for-move={selectedForMove}
    >
      {frame && (
        <ResourceWindow
          {...frame}
          title={resource.title}
          headerActions={
            <button
              type="button"
              aria-label={t("buttons.close")}
              onClick={frame.onClose}
            >
              ×
            </button>
          }
        >
          <button
            type="button"
            aria-label={t("fcboard.media_play")}
            onClick={() => void activate().catch(() => {})}
          >
            ▶ {resource.title}
          </button>
          {error && <p role="alert">{error}</p>}
        </ResourceWindow>
      )}
    </div>
  );
};
