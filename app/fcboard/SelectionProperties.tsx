import { useRef, useState } from "react";
import ButtonBase from "@mui/material/ButtonBase";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import Paper from "@mui/material/Paper";
import Popper from "@mui/material/Popper";
import { t } from "@fcboard/fcboard/i18n";

import { FactoryColorWheel } from "./FactoryColorWheel";
import color from "./factory-selection-icons/color.svg";
import colorFocus from "./factory-selection-icons/color-focus.svg";
import border from "./factory-selection-icons/border.svg";
import borderFocus from "./factory-selection-icons/border-focus.svg";
import opacity from "./factory-selection-icons/opacity.svg";
import opacityFocus from "./factory-selection-icons/opacity-focus.svg";
import layers from "./factory-selection-icons/layers.svg";
import layersFocus from "./factory-selection-icons/layers-focus.svg";
import copy from "./factory-selection-icons/copy.svg";
import copyFocus from "./factory-selection-icons/copy-focus.svg";
import remove from "./factory-selection-icons/delete.svg";
import removeFocus from "./factory-selection-icons/delete-focus.svg";
import search from "./factory-selection-icons/search.svg";
import searchFocus from "./factory-selection-icons/search-focus.svg";
import solid from "./factory-selection-icons/solid.svg";
import dashed from "./factory-selection-icons/dashed.svg";
import lock from "./factory-selection-icons/lock.svg";
import unlock from "./factory-selection-icons/unlock.svg";
import bringForward from "./factory-selection-icons/bringForward.svg";
import sendBackward from "./factory-selection-icons/sendBackward.svg";
import bringToFront from "./factory-selection-icons/bringToFront.svg";
import sendToBack from "./factory-selection-icons/sendToBack.svg";
import alpha20 from "./factory-selection-icons/alpha20.svg";
import alpha50 from "./factory-selection-icons/alpha50.svg";
import alpha70 from "./factory-selection-icons/alpha70.svg";
import alpha100 from "./factory-selection-icons/alpha100.svg";
import bold from "./factory-selection-icons/bold.svg";
import cropIcon from "./factory-selection-icons/crop.svg";
import cropFocus from "./factory-selection-icons/crop-focus.svg";
import cancelIcon from "./factory-selection-icons/cancel.svg";
import cancelFocus from "./factory-selection-icons/cancel-focus.svg";
import confirmIcon from "./factory-selection-icons/confirm.svg";
import confirmFocus from "./factory-selection-icons/confirm-focus.svg";
import editIcon from "./factory-selection-icons/edit-text.svg";
import editFocus from "./factory-selection-icons/edit-text-focus.svg";
import boldFocus from "./factory-selection-icons/bold-focus.svg";
import sizeArrow from "./factory-selection-icons/textsize-arrow.svg";
import "./SelectionProperties.scss";

import type { SelectionPropertiesState } from "./selectionCapabilities";

const icons = {
  crop: [cropIcon, cropFocus],
  cancel: [cancelIcon, cancelFocus],
  confirm: [confirmIcon, confirmFocus],
  edit: [editIcon, editFocus],
  bold: [bold, boldFocus],
  color: [color, colorFocus],
  border: [border, borderFocus],
  opacity: [opacity, opacityFocus],
  layers: [layers, layersFocus],
  copy: [copy, copyFocus],
  delete: [remove, removeFocus],
  search: [search, searchFocus],
};
export const SelectionIcon = ({ name }: { name: keyof typeof icons }) => (
  <>
    <img
      className="fc-selection-icon-normal"
      src={icons[name][0]}
      alt=""
      draggable={false}
    />
    <img
      className="fc-selection-icon-focus"
      src={icons[name][1]}
      alt=""
      draggable={false}
    />
  </>
);
// res/values/arrays.xml select_colors, distinct from the pen's gradient palette.
const colors = [
  "#f3f3f3",
  "#3b52c8",
  "#7b7b7b",
  "#eecf00",
  "#000000",
  "#15c5c3",
  "#ff964f",
  "#4dd7af",
  "#7fec50",
  "#b900ff",
  "#ff0000",
];
type Panel = "color" | "border" | "opacity" | "layers" | "size";
const textSizes = [12, 14, 18, 24, 36, 48, 64, 80, 96, 112, 128];
const label = (panel: Panel, text: boolean) =>
  panel === "size"
    ? t("labels.fontSize")
    : panel === "color"
    ? t(text ? "fcboard.selection_text_color" : "fcboard.selection_color")
    : panel === "border"
    ? t("fcboard.selection_border")
    : panel === "opacity"
    ? t("labels.opacity")
    : t("fcboard.selection_layers");

/** Native selection children share one toggled popup; no inert property controls. */
export const SelectionProperties = ({
  state,
  disabled,
  onStyle,
  onAction,
  onEdit,
  section,
}: {
  section: "style" | "alpha" | "layers";
  state: SelectionPropertiesState;
  disabled: boolean;
  onStyle: (args: Record<string, unknown>) => void;
  onAction: (action: string) => void;
  onEdit: () => void;
}) => {
  const [panel, setPanel] = useState<Panel>();
  const [custom, setCustom] = useState(false);
  const [fill, setFill] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const enabled = (["border", "color", "opacity", "layers"] as const).filter(
    (item) =>
      state[item] &&
      (section === "layers"
        ? item === "layers"
        : section === "alpha"
        ? item === "opacity"
        : item === "border" || item === "color"),
  );
  const colorValue =
    fill && state.value.background !== "transparent"
      ? state.value.background
      : state.value.color;
  const chooseColor = (value: string) =>
    onStyle(
      fill ? { background: value, fillStyle: "solid" } : { color: value },
    );
  return (
    <ClickAwayListener onClickAway={() => setPanel(undefined)}>
      <div className="fc-selection-properties">
        {state.text && section === "style" && (
          <>
            <ButtonBase
              aria-label={t("buttons.edit")}
              disabled={disabled || state.locked}
              onClick={onEdit}
            >
              <SelectionIcon name="edit" />
              <span>{t("toolBar.text")}</span>
            </ButtonBase>
            <ButtonBase
              aria-label={t("labels.fontSize")}
              aria-haspopup="dialog"
              aria-expanded={panel === "size"}
              disabled={disabled || state.locked}
              onClick={(event) => {
                anchor.current = event.currentTarget;
                setPanel((old) => (old === "size" ? undefined : "size"));
              }}
            >
              <span className="fc-selection-size-value">
                {Math.round(state.value.fontSize)}
                <img src={sizeArrow} alt="" />
              </span>
              <span>{t("fcboard.selection_size")}</span>
            </ButtonBase>
            <ButtonBase
              aria-label={t("labels.bold")}
              aria-pressed={state.value.fontWeight === 700}
              disabled={disabled || state.locked}
              onClick={() => {
                setPanel(undefined);
                onStyle({
                  fontWeight: state.value.fontWeight === 700 ? 400 : 700,
                });
              }}
            >
              <SelectionIcon name="bold" />
              <span>{t("fcboard.selection_bold")}</span>
            </ButtonBase>
          </>
        )}
        {enabled.map((item) => (
          <ButtonBase
            key={item}
            aria-label={label(item, state.text)}
            aria-haspopup="dialog"
            aria-expanded={panel === item}
            disabled={disabled || (state.locked && item !== "layers")}
            onClick={(event) => {
              anchor.current = event.currentTarget;
              setCustom(false);
              setFill(state.value.background !== "transparent");
              setPanel((old) => (old === item ? undefined : item));
            }}
          >
            <SelectionIcon name={item} />
            <span>{label(item, state.text)}</span>
          </ButtonBase>
        ))}
        <Popper
          open={
            panel !== undefined &&
            (panel === "size"
              ? state.text && section === "style"
              : enabled.includes(panel)) &&
            !disabled
          }
          anchorEl={anchor.current}
          placement="bottom"
          modifiers={[
            { name: "offset", options: { offset: [0, 8 * 0.67] } },
            { name: "flip" },
            { name: "preventOverflow", options: { padding: 8 } },
          ]}
          style={{ zIndex: 1301 }}
        >
          <Paper
            role="dialog"
            aria-label={panel ? label(panel, state.text) : undefined}
            elevation={0}
            className={`fc-selection-property-menu fc-selection-property-${panel}`}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                setPanel(undefined);
                anchor.current?.focus();
              }
            }}
          >
            {panel === "size" && (
              <div
                role="listbox"
                aria-label={t("labels.fontSize")}
                className="fc-selection-text-sizes"
              >
                {textSizes.map((size) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={state.value.fontSize === size}
                    key={size}
                    onClick={() => onStyle({ fontSize: size })}
                  >
                    {size}
                  </button>
                ))}
              </div>
            )}
            {panel === "color" && (
              <>
                <div className="fc-selection-color-heading">
                  <span>{t("fcboard.selection_color")}</span>
                  {state.fill && (
                    <label>
                      <input
                        type="checkbox"
                        checked={fill}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setFill(checked);
                          onStyle({
                            background: checked
                              ? state.value.color
                              : "transparent",
                            fillStyle: "solid",
                          });
                        }}
                      />
                      {t("labels.fill")}
                    </label>
                  )}
                </div>
                <div className="fc-selection-color-grid">
                  {colors.map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-label={value}
                      aria-pressed={colorValue.toLowerCase() === value}
                      style={{ backgroundColor: value }}
                      onClick={() => chooseColor(value)}
                    />
                  ))}
                  <button
                    type="button"
                    className="fc-selection-custom-color"
                    aria-label={t("fcboard.custom_colour")}
                    aria-expanded={custom}
                    onClick={() => setCustom((value) => !value)}
                  />
                </div>
                {custom && (
                  <FactoryColorWheel
                    value={colorValue}
                    onChange={chooseColor}
                  />
                )}
              </>
            )}
            {panel === "border" && (
              <>
                <span>{t("labels.strokeStyle")}</span>
                <div className="fc-selection-border-choices">
                  {(["solid", "dashed"] as const).map((style) => (
                    <button
                      type="button"
                      key={style}
                      aria-label={t(
                        style === "solid"
                          ? "labels.strokeStyle_solid"
                          : "labels.strokeStyle_dashed",
                      )}
                      aria-pressed={state.value.strokeStyle === style}
                      onClick={() => onStyle({ strokeStyle: style })}
                    >
                      <img src={style === "solid" ? solid : dashed} alt="" />
                    </button>
                  ))}
                </div>
                <span>{t("labels.strokeWidth")}</span>
                <label className="fc-selection-property-range">
                  <input
                    type="range"
                    min="1"
                    max="30"
                    step="0.25"
                    value={state.value.width}
                    aria-label={t("labels.strokeWidth")}
                    onChange={(event) =>
                      onStyle({ width: Number(event.target.value) })
                    }
                  />
                  <output>{state.value.width.toFixed(2)}</output>
                </label>
              </>
            )}
            {panel === "opacity" && (
              <>
                <label className="fc-selection-property-range">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={state.value.opacity}
                    aria-label={t("labels.opacity")}
                    onChange={(event) =>
                      onStyle({ opacity: Number(event.target.value) })
                    }
                  />
                  <output>{state.value.opacity}%</output>
                </label>
                <div className="fc-selection-alpha-choices">
                  {(
                    [
                      [0, undefined],
                      [20, alpha20],
                      [50, alpha50],
                      [70, alpha70],
                      [100, alpha100],
                    ] as const
                  ).map(([value, icon]) => (
                    <button
                      type="button"
                      key={value}
                      aria-label={`${value}%`}
                      aria-pressed={state.value.opacity === value}
                      onClick={() => onStyle({ opacity: value })}
                    >
                      {icon && <img src={icon} alt="" />}
                    </button>
                  ))}
                </div>
              </>
            )}
            {panel === "layers" && (
              <div className="fc-selection-layer-choices">
                {state.lock && (
                  <button
                    type="button"
                    onClick={() => {
                      onAction("toggleElementLock");
                      setPanel(undefined);
                    }}
                  >
                    <img src={state.locked ? unlock : lock} alt="" />
                    <span>
                      {t(
                        state.locked
                          ? "labels.elementLock.unlock"
                          : "labels.elementLock.lock",
                      )}
                    </span>
                  </button>
                )}
                {(
                  [
                    ["bringForward", bringForward],
                    ["sendBackward", sendBackward],
                    ["bringToFront", bringToFront],
                    ["sendToBack", sendToBack],
                  ] as const
                ).map(([action, icon]) => (
                  <button
                    type="button"
                    key={action}
                    disabled={state.locked}
                    onClick={() => onAction(action)}
                  >
                    <img src={icon} alt="" />
                    <span>
                      {t(`labels.${action}` as "labels.bringForward")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Paper>
        </Popper>
      </div>
    </ClickAwayListener>
  );
};
