import { useEffect, useMemo, useRef, useState } from "react";
import { isColorDark } from "@fcboard/common";
import { t, useI18n } from "@fcboard/fcboard/i18n";
import { requestResourceControl } from "@fcboard/fcboard/interactiveResourceControls";
import { validateInteractiveResource } from "@fcboard/fcboard/interactiveHtml";

import { InteractiveResourceFrame } from "@fcboard/fcboard/components/InteractiveResourceFrame";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { calculatorLocalization } from "./calculatorLocalization";

import { classroomCommands } from "./commands";
import {
  hasNativeCalculator,
  nativeCalculatorControl,
  setNativeCalculatorTheme,
} from "./nativeResources";
import calculator from "./calculator/calculator.html?raw";

import "./Calculator.scss";

const calculatorId = "builtin-calculator";
export const calculatorResource = (dark: boolean) =>
  validateInteractiveResource({
    id: calculatorId,
    title: t("fcboard.calculator"),
    html: calculator
      .replace(
        "__FCBOARD_CALCULATOR_I18N__",
        JSON.stringify(calculatorLocalization()).replace(/</g, "\\u003c"),
      )
      .replace(
        '<html lang="en">',
        `<html lang="en" data-board-theme="${dark ? "dark" : "light"}">`,
      ),
  });

/** CalculatorService's centered floating window, independent of board/page history. */
export const Calculator = ({ api }: { api: FcboardImperativeAPI }) => {
  const { langCode } = useI18n();
  const iframe = useRef<HTMLIFrameElement>(null);
  const [open, setOpen] = useState(false);
  const [bounds, setBounds] = useState(() => calculatorBounds());
  const [dark, setDark] = useState(() =>
    isColorDark(api.getAppState().viewBackgroundColor || "#ffffff"),
  );
  const resource = useMemo(() => calculatorResource(dark), [dark]);
  const current = useRef({ open, html: resource.html });
  current.current = { open, html: resource.html };
  const objectId = "floating-calculator";
  useEffect(() => {
    const theme = () =>
      setDark(isColorDark(api.getAppState().viewBackgroundColor || "#ffffff"));
    const operate = (args: Record<string, unknown>, click: boolean) => {
      if (!current.current.open) {
        throw new Error(t("fcboard.this_board_action_is_unavailable"));
      }
      if (
        click &&
        (typeof args.version !== "string" || typeof args.control !== "string")
      ) {
        throw new Error(t("fcboard.invalid_style_parameters"));
      }
      const action = click
        ? {
            type: "click" as const,
            version: args.version as string,
            control: args.control as string,
          }
        : { type: "inspect" as const };
      const signal =
        args.signal instanceof AbortSignal ? args.signal : undefined;
      if (hasNativeCalculator()) {
        return nativeCalculatorControl(
          objectId,
          action,
          signal,
          () => current.current.open,
        );
      }
      return requestResourceControl(
        {
          id: objectId,
          surface: "whiteboard",
          html: current.current.html,
        },
        action,
        { signal, current: () => current.current.open },
      );
    };
    const resize = () => setBounds((box) => fitCalculator(box));
    window.addEventListener("resize", resize);
    const stops = [
      classroomCommands.register(
        "tools.calculator",
        "Open the centered floating calculator over the current board or document. args.open=false closes it. calculator.inspect/press operate its actual keys.",
        (args) => {
          if (args.open !== undefined && typeof args.open !== "boolean") {
            throw new Error(t("fcboard.invalid_style_parameters"));
          }
          if (args.open !== false && !current.current.open) {
            setBounds(calculatorBounds());
          }
          current.current.open = args.open !== false;
          setOpen(args.open !== false);
          return {
            open: args.open !== false,
            ...(args.open === false ? {} : { ids: [objectId] }),
          };
        },
      ),
      classroomCommands.register(
        "calculator.inspect",
        "Read the floating calculator's actual keys, display and version.",
        (args) => operate(args, false),
      ),
      classroomCommands.register(
        "calculator.press",
        "Press an actual key from calculator.inspect; args.version/control required.",
        (args) => operate(args, true),
      ),
      api.onChange(theme),
    ];
    return () => {
      stops.forEach((stop) => stop());
      window.removeEventListener("resize", resize);
    };
  }, [api]);
  useEffect(() => {
    if (open && hasNativeCalculator()) {
      setNativeCalculatorTheme(objectId, dark);
    }
  }, [open, dark]);
  useEffect(() => {
    const frame = iframe.current;
    if (!open || !frame) {
      return;
    }
    const update = () =>
      frame.contentWindow?.postMessage(
        {
          channel: "fc-calculator-language",
          localization: calculatorLocalization(),
        },
        "*",
      );
    frame.addEventListener("load", update);
    update();
    return () => frame.removeEventListener("load", update);
  }, [open, langCode]);
  return open ? (
    <div
      className="fc-floating-calculator"
      role="group"
      aria-label={t("fcboard.calculator")}
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
      }}
    >
      <InteractiveResourceFrame
        resource={{ ...resource, title: t("fcboard.calculator") }}
        iframeRef={iframe}
        objectId={objectId}
        surface="whiteboard"
        window={{
          bounds,
          scale: 1,
          viewport: { left: 0, top: 0, right: innerWidth, bottom: innerHeight },
          onCommit: (box) => setBounds(fitCalculator(box)),
          onClose: () => {
            current.current.open = false;
            setOpen(false);
          },
        }}
      />
    </div>
  ) : null;
};

const fitCalculator = (box: {
  x: number;
  y: number;
  width: number;
  height: number;
}) => {
  const width = Math.min(innerWidth - 16, Math.max(180, box.width));
  const height = Math.min(innerHeight - 16, Math.max(260, box.height));
  return {
    width,
    height,
    x: Math.max(8, Math.min(innerWidth - width - 8, box.x)),
    y: Math.max(8, Math.min(innerHeight - height - 8, box.y)),
  };
};
const calculatorBounds = () => {
  const height = Math.min(innerHeight * 0.78, 720);
  const width = Math.min(height * 0.62, 440, innerWidth - 24);
  return fitCalculator({
    width,
    height,
    x: (innerWidth - width) / 2,
    y: (innerHeight - height) / 2,
  });
};
