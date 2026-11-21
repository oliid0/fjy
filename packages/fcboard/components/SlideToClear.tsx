import { useEffect, useRef } from "react";

import { t } from "../i18n";

import { FactoryIcon } from "./FactoryIcon";
import cleaningIcon from "./xbh-toolbar-assets/eraser-thumb.svg";

import type { CSSProperties } from "react";

/** EraserAllView: release at90 clears; incomplete/cancelled drags return in300ms.
 * The native range control owns tracking, without rerendering the editor per move. */
export const SlideToClear = ({ onClear }: { onClear: () => void }) => {
  const input = useRef<HTMLInputElement>(null);
  const frame = useRef(0);
  const setProgress = (value: number) => {
    if (input.current) {
      input.current.value = String(value);
      input.current.parentElement?.style.setProperty(
        "--fc-clear-progress",
        String(value),
      );
    }
  };
  const stop = () => cancelAnimationFrame(frame.current);
  useEffect(() => stop, []);
  const reset = () => {
    stop();
    const from = Number(input.current?.value || 0);
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / 300);
      setProgress(from * (1 - elapsed * elapsed));
      frame.current = elapsed < 1 ? requestAnimationFrame(step) : 0;
    };
    frame.current = requestAnimationFrame(step);
  };
  const release = () => {
    const accepted = Number(input.current?.value || 0) >= 90;
    reset();
    if (accepted) {
      onClear();
    }
  };
  return (
    <label
      className="fc-clear-slider"
      style={
        { "--fc-cleaning-icon": `url("${cleaningIcon}")` } as CSSProperties
      }
    >
      <FactoryIcon name="eraseDirection" />
      <span>{t("fcboard.slide_to_erase")}</span>
      <input
        ref={input}
        type="range"
        aria-label={t("fcboard.slide_to_clear_this_board")}
        min="0"
        max="100"
        defaultValue="0"
        onPointerDown={stop}
        onChange={(event) => setProgress(Number(event.currentTarget.value))}
        onPointerUp={release}
        onPointerCancel={reset}
        onBlur={reset}
        onKeyUp={(event) => {
          if (["ArrowRight", "End", "Enter"].includes(event.key)) {
            release();
          }
        }}
      />
    </label>
  );
};
