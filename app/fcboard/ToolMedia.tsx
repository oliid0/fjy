import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";

import { classroomCommands } from "./commands";
import { FloatingToolPanel } from "./FloatingToolPanel";
import { Media } from "./builtinNative";

import type { MediaAction } from "./builtinNative";

export const ToolMedia = () => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ name: string; url: string }[]>([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const current = useRef({ items, index });
  current.current = { items, index };
  useEffect(
    () => () => {
      current.current.items.forEach((item) => URL.revokeObjectURL(item.url));
    },
    [],
  );
  useEffect(() => {
    const stops = [
      classroomCommands.register(
        "tools.media",
        "Choose local audio/video files. Android uses the built-in ExoPlayer playlist, no external file browser APK. User completes system file selection.",
        async () => {
          if (Capacitor.isNativePlatform()) {
            return Media.open({
              labels: { title: t("fcboard.media"), close: t("buttons.close") },
            });
          }
          setOpen(true);
          return { open: true, selecting: true };
        },
      ),
      classroomCommands.register(
        "media.control",
        "Read or control the actual player. args.action=read|play|pause|seek|speed|next|previous|close; seek requires seconds, speed requires 0.25..3.",
        async (args) => {
          if (
            ![
              "read",
              "play",
              "pause",
              "seek",
              "speed",
              "next",
              "previous",
              "close",
            ].includes(String(args.action))
          ) {
            throw new Error(t("fcboard.invalid_style_parameters"));
          }
          const action = args as MediaAction;
          if (Capacitor.isNativePlatform()) {
            return Media.action(action);
          }
          const node = video.current;
          if (action.action === "close") {
            node?.pause();
            setOpen(false);
            return { open: false };
          }
          if (!node) {
            if (action.action === "read") {
              return { open: false };
            }
            throw new Error(t("fcboard.media_choose"));
          }
          if (action.action === "play") {
            await node.play();
          }
          if (action.action === "pause") {
            node.pause();
          }
          if (action.action === "seek") {
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
          }
          if (action.action === "speed") {
            if (
              typeof action.speed !== "number" ||
              !Number.isFinite(action.speed) ||
              action.speed < 0.25 ||
              action.speed > 3
            ) {
              throw new Error(t("fcboard.invalid_style_parameters"));
            }
            node.playbackRate = action.speed;
          }
          if (action.action === "next" || action.action === "previous") {
            setIndex(
              Math.max(
                0,
                Math.min(
                  current.current.items.length - 1,
                  current.current.index + (action.action === "next" ? 1 : -1),
                ),
              ),
            );
          }
          return {
            open: true,
            playing: !node.paused,
            position: node.currentTime,
            duration: Number.isFinite(node.duration) ? node.duration : -1,
            index: current.current.index,
            items: current.current.items.map((item) => item.name),
            error: node.error?.message || "",
          };
        },
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, []);
  return open ? (
    <FloatingToolPanel
      title={t("fcboard.media")}
      width={720}
      onClose={() => {
        video.current?.pause();
        setOpen(false);
      }}
    >
      <div className="fc-builtin-body">
        <label>
          {t("fcboard.media_choose")}
          <input
            type="file"
            accept="audio/*,video/*"
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              if (!files.length) {
                return;
              }
              current.current.items.forEach((item) =>
                URL.revokeObjectURL(item.url),
              );
              setItems(
                files.map((file) => ({
                  name: file.name,
                  url: URL.createObjectURL(file),
                })),
              );
              setIndex(0);
              setError("");
            }}
          />
        </label>
        {items.length > 0 && (
          <>
            <select
              aria-label={t("fcboard.media_playlist")}
              value={index}
              onChange={(event) => {
                setIndex(Number(event.target.value));
                setError("");
              }}
            >
              {items.map((item, i) => (
                <option key={item.url} value={i}>
                  {item.name}
                </option>
              ))}
            </select>
            <video
              ref={video}
              src={items[index]?.url}
              controls
              playsInline
              style={{ width: "100%", maxHeight: "60dvh", background: "#000" }}
              onError={() =>
                setError(
                  video.current?.error?.message ||
                    t("fcboard.builtin_tool_failed"),
                )
              }
              onEnded={() => {
                if (index + 1 < items.length) {
                  setIndex(index + 1);
                }
              }}
            />
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </FloatingToolPanel>
  ) : null;
};
