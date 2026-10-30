import { useEffect, useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";

import type { AppState, UIOptions } from "@fcboard/fcboard/types";

import infoIcon from "./factory-setting-icons/threshold-info.svg?url";

const contacts = [
  {
    id: "palm",
    key: "palmThreshold",
    factor: 2 / 3,
    label: "eraser_label",
    hint: "palm_hint",
  },
  {
    id: "fine",
    key: "fineThreshold",
    factor: 4 / 5,
    label: "fine_label",
    hint: "fine_hint",
  },
  {
    id: "thick",
    key: "thickThreshold",
    factor: 4 / 5,
    label: "thick_label",
    hint: "thick_hint",
  },
] as const;
const format = (value: number | undefined) =>
  value === undefined ? "" : value.toFixed(2).replace(/0$/, "");

const ThresholdValue = ({
  value,
  label,
  onChange,
}: {
  value: number | undefined;
  label: string;
  onChange: (value: number) => void;
}) => {
  const [draft, setDraft] = useState(() => format(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {
      setDraft(format(value));
    }
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={draft}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        setDraft(format(value));
      }}
      onChange={(event) => {
        if (!/^\d*(?:\.\d*)?$/.test(event.target.value)) {
          return;
        }
        setDraft(event.target.value);
        const number = Number(event.target.value);
        if (Number.isFinite(number) && number > 0) {
          onChange(number);
        }
      }}
    />
  );
};

/** ThresholdPopu / ThresholdView record the down contact and apply it on release. */
export const ThresholdSettings = ({
  state,
  device,
  onChange,
  onReset,
}: {
  state: AppState;
  device?: UIOptions["inkProfile"];
  onChange: (input: Record<string, number>) => void;
  onReset: () => void;
}) => {
  const [selected, setSelected] =
    useState<typeof contacts[number]["id"]>("palm");
  const sample = useRef<
    { id: number; value: number; kind: typeof selected } | undefined
  >(undefined);
  const dpr =
    Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1;
  const values = {
    palm: state.palmEraserThreshold ?? device?.palmThreshold ?? 36,
    fine: state.whiteboardFineThreshold ?? device?.fineThreshold,
    thick: state.whiteboardThickThreshold ?? device?.thickThreshold,
  };
  const contact = contacts.find((item) => item.id === selected)!;
  return (
    <div className="fc-threshold-settings">
      <div className="fc-threshold-values">
        {contacts.map((item) => {
          const label = t(`fcboard.factorySettings.${item.label}`);
          const value = values[item.id];
          return (
            <div key={item.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected === item.id}
                  onChange={() => setSelected(item.id)}
                />
                {label}
              </label>
              <ThresholdValue
                label={label}
                value={
                  value === undefined ? undefined : (value * dpr) / item.factor
                }
                onChange={(raw) =>
                  onChange({ [item.key]: (raw / dpr) * item.factor })
                }
              />
            </div>
          );
        })}
      </div>
      <div
        className="fc-threshold-area"
        role="group"
        aria-label={t("fcboard.factorySettings.area")}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (sample.current || !["touch", "pen"].includes(event.pointerType)) {
            return;
          }
          const size = Math.min(event.width, event.height);
          if (!Number.isFinite(size) || size <= 0) {
            return;
          }
          sample.current = { id: event.pointerId, value: size, kind: selected };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          const current = sample.current;
          if (current?.id !== event.pointerId) {
            return;
          }
          sample.current = undefined;
          if (current.kind !== selected) {
            return;
          }
          onChange({ [contact.key]: current.value * contact.factor });
        }}
        onPointerCancel={() => {
          sample.current = undefined;
        }}
        onLostPointerCapture={() => {
          sample.current = undefined;
        }}
      >
        <p>{t(`fcboard.factorySettings.${contact.hint}`)}</p>
      </div>
      <details className="fc-threshold-info">
        <summary aria-label={t("fcboard.factorySettings.help_title")}>
          <img src={infoIcon} alt="" />
        </summary>
        <p>{t("fcboard.factorySettings.help")}</p>
      </details>
      <footer>
        <button type="button" onClick={onReset}>
          {t("fcboard.reset")}
        </button>
      </footer>
    </div>
  );
};
