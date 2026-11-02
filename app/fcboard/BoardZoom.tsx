import { useEffect, useRef, useState } from "react";
import { getStateForZoom } from "@fcboard/fcboard/scene/zoom";
import { getNormalizedZoom } from "@fcboard/fcboard/scene/normalize";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { classroomCommands } from "./commands";

export const BoardZoom = ({ api }: { api: FcboardImperativeAPI }) => {
  const [percent, setPercent] = useState(() =>
    Math.round(api.getAppState().zoom.value * 100),
  );
  const [hidden, setHidden] = useState(false);
  const frame = useRef<number | undefined>(undefined);
  useEffect(() => {
    const refresh = () => {
      if (frame.current !== undefined) {
        return;
      }
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        const state = api.getAppState();
        setPercent(Math.round(state.zoom.value * 100));
        setHidden(
          !!state.toolbarHidden || !!classroomCommands.read("document"),
        );
      });
    };
    const stop = api.onChange(refresh);
    const document = classroomCommands.watch("document", refresh);
    refresh();
    return () => {
      stop();
      document();
      if (frame.current !== undefined) {
        cancelAnimationFrame(frame.current);
      }
    };
  }, [api]);
  const zoom = (value: number) => {
    const state = api.getAppState();
    api.updateScene({
      appState: getStateForZoom(
        {
          viewportX: state.offsetLeft + state.width / 2,
          viewportY: state.offsetTop + state.height / 2,
          nextZoom: getNormalizedZoom(Math.max(0.5, Math.min(2, value))),
        },
        state,
      ),
    });
  };
  return hidden ? null : (
    <div
      className="fc-board-zoom"
      role="group"
      aria-label="白板缩放"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        aria-label="缩小白板"
        disabled={percent <= 50}
        onClick={() => zoom(api.getAppState().zoom.value - 0.1)}
      >
        −
      </button>
      <button
        aria-label="恢复白板100%"
        title="恢复100%"
        onClick={() => zoom(1)}
      >
        <span>{percent}%</span>
      </button>
      <button
        aria-label="放大白板"
        disabled={percent >= 200}
        onClick={() => zoom(api.getAppState().zoom.value + 0.1)}
      >
        +
      </button>
    </div>
  );
};
