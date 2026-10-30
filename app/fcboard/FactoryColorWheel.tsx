import { useEffect, useRef, useState } from "react";
import { rgbToHex } from "@fcboard/common";
import { t } from "@fcboard/fcboard/i18n";

type HSV = { hue: number; saturation: number; value: number };
const fromHex = (hex: string): HSV => {
  const rgb = [1, 3, 5].map(
    (offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    const index = rgb.indexOf(max);
    hue =
      ((rgb[(index + 1) % 3] - rgb[(index + 2) % 3]) / delta + index * 2) * 60;
  }
  return {
    hue: (hue + 360) % 360,
    saturation: max ? delta / max : 0,
    value: max,
  };
};
// HSVCircleView: clockwise sweep from red, white radial overlay and an
// independent 0–255 darkening bar from NewSlideBackgroundView.
export const wheelColor = ({ hue, saturation, value }: HSV) => {
  const sector = (((hue % 360) + 360) % 360) / 60;
  const x = 1 - Math.abs((sector % 2) - 1);
  const rgb =
    sector < 1
      ? [1, x, 0]
      : sector < 2
      ? [x, 1, 0]
      : sector < 3
      ? [0, 1, x]
      : sector < 4
      ? [0, x, 1]
      : sector < 5
      ? [x, 0, 1]
      : [1, 0, x];
  const [r, g, b] = rgb.map((channel) => {
    const base = Math.round(255 * (1 - saturation + channel * saturation));
    return Math.floor((base < 10 ? 0 : base) * value);
  });
  return rgbToHex(r, g, b);
};

export const FactoryColorWheel = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) => {
  const [hsv, setHSV] = useState(() => fromHex(value));
  const emitted = useRef(value);
  const pointer = useRef<number | undefined>(undefined);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const last = useRef(-100);
  const change = useRef(onChange);
  change.current = onChange;
  const flush = () => {
    clearTimeout(pending.current);
    pending.current = undefined;
    last.current = performance.now();
    change.current(emitted.current);
  };
  useEffect(() => () => clearTimeout(pending.current), []);
  useEffect(() => {
    if (value !== emitted.current) {
      setHSV(fromHex(value));
      emitted.current = value;
    }
  }, [value]);
  const update = (next: HSV) => {
    setHSV(next);
    emitted.current = wheelColor(next);
    if (performance.now() - last.current >= 100) {
      flush();
    } else if (!pending.current) {
      pending.current = setTimeout(
        flush,
        100 - (performance.now() - last.current),
      );
    }
  };
  const point = (element: HTMLElement, clientX: number, clientY: number) => {
    const rect = element.getBoundingClientRect();
    const x = (clientX - rect.left - rect.width / 2) / (rect.width / 2 - 5);
    const y = (clientY - rect.top - rect.height / 2) / (rect.height / 2 - 5);
    update({
      ...hsv,
      hue: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360,
      saturation: Math.min(1, Math.hypot(x, y)),
    });
  };
  const radians = (hsv.hue * Math.PI) / 180;
  return (
    <div className="fc-factory-color-wheel">
      <div
        className="fc-color-disc"
        role="slider"
        tabIndex={0}
        aria-label={t("fcboard.custom_colour")}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.hue)}
        aria-valuetext={value}
        onPointerDown={(event) => {
          if (event.button !== 0 || pointer.current !== undefined) {
            return;
          }
          event.preventDefault();
          pointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          point(event.currentTarget, event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (pointer.current === event.pointerId) {
            point(event.currentTarget, event.clientX, event.clientY);
          }
        }}
        onPointerUp={() => {
          if (pointer.current !== undefined && pending.current) {
            flush();
          }
          pointer.current = undefined;
        }}
        onPointerCancel={() => {
          pointer.current = undefined;
        }}
        onLostPointerCapture={() => {
          pointer.current = undefined;
        }}
        onKeyDown={(event) => {
          if (
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
              event.key,
            )
          ) {
            event.preventDefault();
            update({
              ...hsv,
              hue:
                (hsv.hue +
                  (event.key === "ArrowLeft"
                    ? -2
                    : event.key === "ArrowRight"
                    ? 2
                    : 0) +
                  360) %
                360,
              saturation: Math.min(
                1,
                Math.max(
                  0,
                  hsv.saturation +
                    (event.key === "ArrowUp"
                      ? 0.02
                      : event.key === "ArrowDown"
                      ? -0.02
                      : 0),
                ),
              ),
            });
          }
        }}
      >
        <span
          style={{
            left: `${63 + 58 * hsv.saturation * Math.cos(radians)}px`,
            top: `${63 + 58 * hsv.saturation * Math.sin(radians)}px`,
          }}
        />
      </div>
      <div className="fc-color-shade">
        <span style={{ background: value }} />
        <input
          type="range"
          min="0"
          max="255"
          value={Math.round((1 - hsv.value) * 255)}
          aria-label={t("fcboard.factorySettings.shade")}
          style={{
            background: `linear-gradient(to right, ${wheelColor({
              ...hsv,
              value: 1,
            })}, #000)`,
          }}
          onChange={(event) =>
            update({ ...hsv, value: (255 - Number(event.target.value)) / 255 })
          }
        />
      </div>
    </div>
  );
};
