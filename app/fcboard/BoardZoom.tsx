import { useEffect, useRef, useState } from "react";
import { getStateForZoom } from "@fcboard/fcboard/scene/zoom";
import { getNormalizedZoom } from "@fcboard/fcboard/scene/normalize";
import { scaleWhiteboardPen } from "@fcboard/fcboard/whiteboardPen";

import type {
  FcboardImperativeAPI,
  ViewportGesture,
  UIOptions,
} from "@fcboard/fcboard/types";

import { classroomCommands } from "./commands";

/** main.xml scale_layout + showScalePercent: percentage/reset, one idle second. */
export const BoardZoom = ({
  api,
  inkProfile,
}: {
  api: FcboardImperativeAPI;
  inkProfile?: UIOptions["inkProfile"];
}) => {
  const [gesture, setGesture] = useState<ViewportGesture>();
  const [visible, setVisible] = useState(false);
  const [bottom, setBottom] = useState(70);
  const frame = useRef<number | undefined>(undefined);
  const hide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<ViewportGesture | undefined>(undefined);
  useEffect(() => {
    const receive = (value: ViewportGesture) => {
      latest.current = value;
      if (value.active) {
        setVisible(true);
        clearTimeout(hide.current);
        hide.current = setTimeout(() => setVisible(false), 1000);
      }
      if (frame.current === undefined) {
        frame.current = requestAnimationFrame(() => {
          frame.current = undefined;
          setGesture(latest.current);
        });
      }
    };
    const conceal = () => {
      if (
        api.getAppState().toolbarHidden ||
        classroomCommands.read("document")
      ) {
        setVisible(false);
        latest.current = undefined;
        setGesture(undefined);
      }
    };
    const stop = api.onViewportGesture?.(receive);
    const change = api.onChange(conceal);
    const document = classroomCommands.watch("document", conceal);
    const toolbar = window.document.querySelector<HTMLElement>(
      ".fc-unified-toolbar",
    );
    const place = () => {
      const rect = toolbar?.getBoundingClientRect();
      if (rect?.height) {
        setBottom(Math.max(70, innerHeight - rect.top + 6));
      }
    };
    place();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(place);
    if (toolbar) {
      observer?.observe(toolbar);
    }
    window.addEventListener("resize", place);
    return () => {
      stop?.();
      change();
      document();
      observer?.disconnect();
      window.removeEventListener("resize", place);
      clearTimeout(hide.current);
      if (frame.current !== undefined) {
        cancelAnimationFrame(frame.current);
      }
    };
  }, [api]);
  const reset = () => {
    const state = api.getAppState();
    const center = latest.current?.center;
    if (center) {
      api.updateScene({
        appState: {
          ...getStateForZoom(
            {
              viewportX: center.x,
              viewportY: center.y,
              nextZoom: getNormalizedZoom(1),
            },
            state,
          ),
          ...scaleWhiteboardPen(
            state,
            1 / state.zoom.value,
            inkProfile?.penWidthMax,
          ),
        },
      });
    }
    clearTimeout(hide.current);
    setVisible(false);
  };
  const gradient = `fc-gesture-${api.id}`;
  return (
    <>
      {!!gesture?.pointers.length && (
        <svg className="fc-board-gesture-points" aria-hidden="true">
          <defs>
            <radialGradient id={gradient}>
              <stop offset="0" stopColor="#fff" stopOpacity="0.7" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.047" />
            </radialGradient>
          </defs>
          {gesture.pointers.map((point, index) => (
            <circle
              key={index}
              cx={point.x}
              cy={point.y}
              r={50}
              fill={`url(#${gradient})`}
            />
          ))}
        </svg>
      )}
      {visible && gesture && (
        <div
          className="fc-board-zoom"
          role="group"
          aria-label="白板缩放"
          style={{ bottom }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span>缩放{Math.round(gesture.zoom * 100)}%</span>
          <button aria-label="恢复白板100%" onClick={reset}>
            重置
          </button>
        </div>
      )}
    </>
  );
};
