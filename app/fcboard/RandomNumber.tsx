import { useEffect, useRef, useState } from "react";
import { t, useI18n } from "@fcboard/fcboard/i18n";

import { MaterialPanel } from "./MaterialPanel";
import { TransientMessage } from "./TransientMessage";

import "./OriginalResourceTools.scss";

/** RandomNumberDialogFragment's non-editable, non-wrapping NumberPicker. */
const IntegerWheel = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) => {
  const node = useRef<HTMLDivElement>(null);
  const drag = useRef<
    { id: number; y: number; value: number; moved: boolean } | undefined
  >(undefined);
  const [offset, setOffset] = useState(0);
  const clamp = (value: number) => Math.max(-999, Math.min(999, value));
  useEffect(() => {
    const wheel = node.current;
    const scroll = (event: WheelEvent) => {
      event.preventDefault();
      if (event.deltaY) {
        onChange(clamp(value + Math.sign(event.deltaY)));
      }
    };
    wheel?.addEventListener("wheel", scroll, { passive: false });
    return () => wheel?.removeEventListener("wheel", scroll);
  }, [value, onChange]);
  return (
    <div
      ref={node}
      className="fc-integer-wheel"
      role="spinbutton"
      aria-label={label}
      aria-valuemin={-999}
      aria-valuemax={999}
      aria-valuenow={value}
      tabIndex={0}
      onKeyDown={(event) => {
        const delta = (
          { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 } as Record<
            string,
            number
          >
        )[event.key];
        if (delta || event.key === "Home" || event.key === "End") {
          event.preventDefault();
          onChange(
            event.key === "Home"
              ? -999
              : event.key === "End"
              ? 999
              : clamp(value + delta),
          );
        }
      }}
      onPointerDown={(event) => {
        if (drag.current || event.button !== 0) {
          return;
        }
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        drag.current = {
          id: event.pointerId,
          y: event.clientY,
          value,
          moved: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || event.pointerId !== start.id) {
          return;
        }
        const distance = event.clientY - start.y;
        start.moved ||= Math.abs(distance) > 4;
        const position = clamp(start.value - distance / 40);
        onChange(Math.round(position));
        setOffset((Math.round(position) - position) * 40);
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        if (!start || event.pointerId !== start.id) {
          return;
        }
        if (!start.moved) {
          const y =
            event.clientY - event.currentTarget.getBoundingClientRect().top;
          onChange(clamp(start.value + (y < 40 ? -1 : y >= 80 ? 1 : 0)));
        }
        drag.current = undefined;
        setOffset(0);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = undefined;
        setOffset(0);
      }}
      onLostPointerCapture={() => {
        drag.current = undefined;
        setOffset(0);
      }}
    >
      <div style={{ transform: `translateY(${offset}px)` }} aria-hidden="true">
        {[value - 1, value, value + 1].map((number) => (
          <span key={number}>
            {number >= -999 && number <= 999 ? number : ""}
          </span>
        ))}
      </div>
    </div>
  );
};

/** dialog_random_number: independent draws allow duplicates and both endpoints. */
export const RandomNumber = ({ onClose }: { onClose: () => void }) => {
  useI18n();
  const [count, setCount] = useState(1);
  const [minimum, setMinimum] = useState(1);
  const [maximum, setMaximum] = useState(100);
  const [results, setResults] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [errorAttempt, setErrorAttempt] = useState(0);
  const result = useRef<HTMLDivElement>(null);
  return (
    <MaterialPanel
      centered
      className="fc-original-resource-tool fc-random-number"
      role="dialog"
      aria-label={t("fcboard.randomNumber.title")}
      onDismiss={onClose}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          onClose();
        }
      }}
    >
      <header>
        <strong>{t("fcboard.randomNumber.title")}</strong>
        <button aria-label={t("buttons.close")} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="fc-random-options">
        <section>
          <strong>{t("fcboard.randomNumber.quantity")}</strong>
          <p>{t("fcboard.randomNumber.quantityHint")}</p>
          <div
            className="fc-random-counts"
            role="group"
            aria-label={t("fcboard.randomNumber.quantity")}
          >
            {Array.from({ length: 8 }, (_, index) => index + 1).map(
              (number) => (
                <button
                  key={number}
                  aria-pressed={count === number}
                  onClick={() => setCount(number)}
                >
                  {number}
                </button>
              ),
            )}
          </div>
        </section>
        <section>
          <strong>{t("fcboard.randomNumber.range")}</strong>
          <p>{t("fcboard.randomNumber.rangeHint")}</p>
          <div className="fc-random-range">
            <div>
              <strong>{t("fcboard.randomNumber.minimum")}</strong>
              <IntegerWheel
                label={t("fcboard.randomNumber.minimum")}
                value={minimum}
                onChange={setMinimum}
              />
            </div>
            <div>
              <strong>{t("fcboard.randomNumber.maximum")}</strong>
              <IntegerWheel
                label={t("fcboard.randomNumber.maximum")}
                value={maximum}
                onChange={setMaximum}
              />
            </div>
          </div>
        </section>
      </div>
      <strong>{t("fcboard.randomNumber.result")}</strong>
      <div
        ref={result}
        className="fc-random-results"
        role="status"
        aria-label={t("fcboard.randomNumber.result")}
      >
        {results.map((number, index) => (
          <span key={index}>{number}</span>
        ))}
      </div>
      <TransientMessage key={errorAttempt} message={error} role="alert" />
      <button
        className="fc-resource-primary fc-random-start"
        onClick={() => {
          if (minimum > maximum) {
            setError(t("fcboard.randomNumber.invalidRange"));
            setErrorAttempt((current) => current + 1);
            return;
          }
          setError("");
          setResults(
            Array.from(
              { length: count },
              () =>
                minimum + Math.floor(Math.random() * (maximum - minimum + 1)),
            ),
          );
          if (result.current) {
            result.current.scrollLeft = 0;
          }
        }}
      >
        {t("fcboard.randomNumber.start")}
      </button>
    </MaterialPanel>
  );
};
