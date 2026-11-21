import { useCallback, useEffect, useRef } from "react";

/** QNumberPicker: three visible values, wrapping drag/wheel and keyboard input. */
export const TimerWheel = ({
  value,
  max,
  label,
  onChange,
}: {
  value: number;
  max: number;
  label: string;
  onChange: (value: number) => void;
}) => {
  const root = useRef<HTMLDivElement>(null);
  const current = useRef({ value, onChange });
  current.current = { value, onChange };
  const drag = useRef<{ id: number; y: number; value: number } | undefined>(
    undefined,
  );
  const wrapped = useCallback(
    (next: number) => ((next % (max + 1)) + max + 1) % (max + 1),
    [max],
  );
  useEffect(() => {
    const node = root.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.deltaY) {
        current.current.onChange(
          wrapped(current.current.value + Math.sign(event.deltaY)),
        );
      }
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [wrapped]);
  const cancel = () => {
    drag.current = undefined;
  };
  return (
    <div
      ref={root}
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="fc-timer-wheel"
      onPointerDown={(event) => {
        if (event.isPrimary === false || event.button > 0) {
          return;
        }
        event.preventDefault();
        drag.current = { id: event.pointerId, y: event.clientY, value };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start?.id === event.pointerId) {
          onChange(
            wrapped(start.value + Math.round((start.y - event.clientY) / 32)),
          );
        }
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(event) => {
        const keys: Record<string, number> = {
          ArrowUp: value + 1,
          ArrowDown: value - 1,
          PageUp: value + 10,
          PageDown: value - 10,
          Home: 0,
          End: max,
        };
        const next = keys[event.key];
        if (next !== undefined) {
          event.preventDefault();
          event.stopPropagation();
          onChange(wrapped(next));
        }
      }}
    >
      {[-1, 0, 1].map((offset) => (
        <span key={offset} aria-hidden="true" data-selected={offset === 0}>
          {String(wrapped(value + offset)).padStart(2, "0")}
        </span>
      ))}
    </div>
  );
};
