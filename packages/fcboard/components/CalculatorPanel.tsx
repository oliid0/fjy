import { useId, useLayoutEffect, useRef, useState } from "react";

import {
  applyCalculatorAction,
  calculatorDisplay,
  restoreCalculatorState,
} from "../calculatorInput";
import { useI18n } from "../i18n";
import { calculatorResourceId } from "../interactiveHtml";
import { attachLocalResourceControls } from "../interactiveResourceControls";

import { ResourceWindow } from "./ResourceWindow";

import "./CalculatorPanel.scss";

import type { CalculatorAction, CalculatorState } from "../calculatorInput";
import type { TranslationKeys } from "../i18n";
import type {
  ResourceControlRequest,
  ResourceControlState,
  ResourceControlTarget,
} from "../interactiveResourceControls";
import type { ComponentProps } from "react";

type Key = {
  symbol: string;
  action: CalculatorAction | { type: "close" };
  label?: string;
  keyboard?: string;
  pressed?: boolean;
};

const number = (value: string): Key => ({
  symbol: value,
  action: { type: "number", value },
  keyboard: value,
});

const operator = (symbol: string, value = symbol): Key => ({
  symbol,
  action: { type: "operator", value },
  keyboard: value,
});

const formula = (
  symbol: string,
  value: string,
  label?: string,
  keyboard?: string,
): Key => ({
  symbol,
  action: { type: "function", value },
  label,
  keyboard,
});

const unary = (symbol: string, value: string, label: string): Key => ({
  symbol,
  action: { type: "unary", value },
  label,
});

const scientificFunctions: Key[] = [
  formula("log", "log", undefined, "l"),
  formula("ln", "ln"),
  formula("√", "sqrt", "square_root_input_must_be_non_negative"),
  operator("("),
  operator(")"),
  operator("^"),
  { symbol: "π", action: { type: "value", value: "PI" }, keyboard: "p" },
  { symbol: "e", action: { type: "value", value: "E" }, keyboard: "e" },
  formula("x!", "fact", "factorial"),
  unary("x²", "square", "square"),
  unary("x³", "cube", "cube"),
  unary("∛", "cbrt", "cube_root"),
  unary("1/x", "reciprocal", "reciprocal"),
  unary("eˣ", "exp", "exponential_e_to_the_x"),
  unary("10ˣ", "pow10", "ten_to_the_x"),
  unary("%", "pct", "percent_of_value"),
  unary("|x|", "abs", "absolute_value"),
  unary("round", "round", "round"),
  unary("floor", "floor", "round_down"),
  unary("ceil", "ceil", "round_up"),
];

const headerCount = 3;
const keypadCount = 20;

type Props = {
  snapshot?: CalculatorState;
  onStateChange?: (state: CalculatorState) => void;
  target: ResourceControlTarget;
  dark: boolean;
  window?: Omit<
    ComponentProps<typeof ResourceWindow>,
    "title" | "children" | "onReload" | "headerActions"
  >;
};

export const CalculatorPanel = ({
  target: { id, surface, html },
  dark,
  window,
  snapshot,
  onStateChange,
}: Props) => {
  const { t } = useI18n();
  const label = (key: string, values?: Record<string, string>) =>
    t(`fcboard.calculatorUi.${key}` as TranslationKeys, values);
  const title = label("title");
  const root = useRef<HTMLDivElement>(null);
  const version = useId();
  const [state, setState] = useState(() => restoreCalculatorState(snapshot));
  const latest = useRef(state);
  useLayoutEffect(() => {
    if (snapshot !== latest.current) {
      const restored = restoreCalculatorState(snapshot);
      latest.current = restored;
      setState(restored);
    }
  }, [snapshot]);

  const keys = (current: CalculatorState): Key[] => {
    const theme = current.theme ?? (dark ? "dark" : "light");
    const basic: Key[] = [
      {
        symbol: theme === "dark" ? "☀" : "◐",
        action: { type: "theme", value: theme === "dark" ? "light" : "dark" },
        label: "toggle_color_theme",
      },
      {
        symbol: label("scientificShort"),
        action: { type: "mode" },
        label: "scientific",
        pressed: current.scientific,
      },
      { symbol: "×", action: { type: "close" }, label: "close_calculator" },
      {
        symbol: current.entry && current.phase === "input" ? "C" : "AC",
        action: { type: "clear" },
      },
      { symbol: "⌫", action: { type: "backspace" }, keyboard: "Backspace" },
      { ...operator("%"), label: "remainder_modulo" },
      operator("÷", "/"),
      number("7"),
      number("8"),
      number("9"),
      operator("×", "*"),
      number("4"),
      number("5"),
      number("6"),
      operator("−", "-"),
      number("1"),
      number("2"),
      number("3"),
      operator("+"),
      number("0"),
      number("."),
      { symbol: "Ans", action: { type: "answer" } },
      { symbol: "=", action: { type: "equals" }, keyboard: "Enter" },
    ];
    if (!current.scientific) {
      return basic;
    }
    const angle = current.degrees ? "DEG" : "RAD";
    return [
      ...basic,
      { symbol: angle, action: { type: "angle" }, label: "angleMode" },
      {
        symbol: label("inverse"),
        action: { type: "inverse" },
        label: "toggle_inverse_trigonometric_functions",
        pressed: current.inverse,
      },
      ...(
        [
          ["sin", "sine", "s"],
          ["cos", "cosine", "c"],
          ["tan", "tangent", "t"],
        ] as const
      ).map(([name, description, keyboard]) =>
        current.inverse
          ? formula(`${name}⁻¹`, `a${name}`, `inverse_${description}`, keyboard)
          : formula(name, name, description, keyboard),
      ),
      ...scientificFunctions,
    ];
  };
  const name = (key: Key, current: CalculatorState) =>
    key.label === "angleMode"
      ? label(key.label, { unit: current.degrees ? "DEG" : "RAD" })
      : key.label
      ? label(key.label)
      : key.symbol;
  const result = (current: CalculatorState) =>
    current.phase === "error" ? label("error") : calculatorDisplay(current);
  const press = (action: Key["action"]) => {
    if (action.type === "close") {
      window?.onClose();
      return;
    }
    const updated = applyCalculatorAction(latest.current, action);
    latest.current = updated;
    setState(updated);
    onStateChange?.(updated);
  };
  const operate =
    useRef<(request: ResourceControlRequest) => ResourceControlState>(
      undefined,
    );
  operate.current = (request) => {
    if (request.type !== "inspect") {
      if (request.version !== version) {
        throw new Error("RESOURCE_STALE_VERSION");
      }
      const index = /^c\d+$/.test(request.control)
        ? Number(request.control.slice(1))
        : -1;
      const key = keys(latest.current)[index];
      if (
        request.type !== "click" ||
        !key ||
        (key.action.type === "close" && !window)
      ) {
        throw new Error("RESOURCE_INVALID_CONTROL");
      }
      press(key.action);
    }
    const current = latest.current;
    const config = keys(current);
    const offset = request.type === "inspect" ? request.offset ?? 0 : 0;
    const box = root.current!.getBoundingClientRect();
    return {
      version,
      title,
      viewport: { width: box.width, height: box.height },
      offset,
      total: config.length,
      controls: config.slice(offset).map((key, index) => ({
        id: `c${offset + index}`,
        label: name(key, current),
        type: "button",
        disabled: key.action.type === "close" && !window,
        value: key.pressed ?? "",
      })),
      outputs: [result(current)],
      truncated: offset > 0,
    };
  };
  useLayoutEffect(
    () =>
      attachLocalResourceControls({ id, surface, html }, (request) =>
        operate.current!(request),
      ),
    [id, surface, html],
  );

  const button = (key: Key, index: number) => (
    <button
      key={index}
      type="button"
      aria-label={name(key, state)}
      aria-pressed={key.pressed}
      disabled={key.action.type === "close" && !window}
      data-calculator-key={key.action.type}
      onClick={(event) => {
        press(key.action);
        if (event.detail > 0 && key.action.type !== "close") {
          root.current?.focus({ preventScroll: true });
        }
      }}
    >
      {key.symbol}
    </button>
  );
  const config = keys(state);
  const header = config.slice(0, headerCount).map(button);
  const content = (
    <div className="fc-calculator">
      <div
        className="fc-calculator-display"
        data-error={state.phase === "error" || undefined}
      >
        <output
          aria-live={state.phase === "input" ? "off" : "polite"}
          dir="ltr"
        >
          {result(state)}
        </output>
        {state.phase === "error" && <small>{label("checkExpression")}</small>}
      </div>
      <div className="fc-calculator-keys" dir="ltr">
        {config.slice(headerCount, headerCount + keypadCount).map(button)}
      </div>
      {state.scientific && (
        <div className="fc-calculator-scientific" dir="ltr">
          {config.slice(headerCount + keypadCount).map(button)}
        </div>
      )}
    </div>
  );

  return (
    <div
      className="fc-calculator-object"
      data-calculator-theme={state.theme ?? (dark ? "dark" : "light")}
      data-resource-id={calculatorResourceId}
      data-resource-object-id={id}
      role="group"
      aria-label={title}
      tabIndex={0}
      ref={root}
      onKeyDownCapture={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) {
          return;
        }
        if (
          event.key === "Enter" &&
          event.target instanceof HTMLButtonElement
        ) {
          return;
        }
        const keyboard = {
          "×": "*",
          "÷": "/",
          "=": "Enter",
          "−": "-",
        } as Record<string, string>;
        const key = keyboard[event.key] ?? event.key.toLowerCase();
        const action =
          event.key === "Escape"
            ? ({ type: "reset" } as const)
            : keys(latest.current).find(
                (item) => item.keyboard?.toLowerCase() === key.toLowerCase(),
              )?.action;
        if (action) {
          event.preventDefault();
          event.stopPropagation();
          press(action);
        }
      }}
    >
      {window ? (
        <ResourceWindow {...window} title={title} headerActions={header}>
          {content}
        </ResourceWindow>
      ) : (
        <>
          <div className="fc-resource-window-header">{header}</div>
          {content}
        </>
      )}
    </div>
  );
};
