import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { t } from "@fcboard/fcboard/i18n";
import {
  attachResourceControls,
  requestResourceControl,
} from "@fcboard/fcboard/interactiveResourceControls";
import resourceRuntime from "@fcboard/fcboard/interactiveResourceRuntime.js?raw";

import { classroomCommands } from "./commands";
import { FloatingToolPanel } from "./FloatingToolPanel";
import calculator from "./calculator/calculator.html?raw";

const html = calculator.replace(
  "</body>",
  `<script>${resourceRuntime}</script></body>`,
);
const target = {
  id: "builtin-calculator",
  surface: "whiteboard" as const,
  html,
};

/** Calculator-app-main's real parser, scientific keys and keyboard, fully offline. */
export const Calculator = () => {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const visible = useRef(open);
  visible.current = open;
  const attached = useRef<
    ReturnType<typeof attachResourceControls> | undefined
  >(undefined);
  const bindFrame = useCallback((node: HTMLIFrameElement | null) => {
    attached.current?.dispose();
    attached.current = node ? attachResourceControls(target, node) : undefined;
  }, []);
  useEffect(() => {
    const stops = [
      classroomCommands.register(
        "tools.calculator",
        "Open the built-in offline scientific calculator. args.open=false closes it. Use calculator.inspect and calculator.press to operate real keys.",
        (args) => {
          if (args.open !== undefined && typeof args.open !== "boolean") {
            throw new Error(t("fcboard.invalid_style_parameters"));
          }
          flushSync(() => {
            setFailed(false);
            setOpen(args.open !== false);
          });
          return { open: args.open !== false };
        },
      ),
      classroomCommands.register(
        "calculator.inspect",
        "Read the visible calculator's actual keys, current display and control version. No model request or external app.",
        (args) =>
          requestResourceControl(
            target,
            { type: "inspect" },
            {
              signal:
                args.signal instanceof AbortSignal ? args.signal : undefined,
              current: () => visible.current,
            },
          ),
      ),
      classroomCommands.register(
        "calculator.press",
        "Press an actual calculator key from calculator.inspect. args.version and args.control are required; inspect again after changing modes.",
        (args) => {
          if (
            typeof args.version !== "string" ||
            typeof args.control !== "string"
          ) {
            throw new Error(t("fcboard.invalid_style_parameters"));
          }
          return requestResourceControl(
            target,
            { type: "click", version: args.version, control: args.control },
            {
              signal:
                args.signal instanceof AbortSignal ? args.signal : undefined,
              current: () => visible.current,
            },
          );
        },
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, []);
  return open ? (
    <FloatingToolPanel
      title={t("fcboard.calculator")}
      width={400}
      onClose={() => setOpen(false)}
    >
      {failed ? (
        <p role="alert">{t("fcboard.builtin_tool_failed")}</p>
      ) : (
        <iframe
          ref={bindFrame}
          title={t("fcboard.calculator")}
          srcDoc={html}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          onLoad={() => attached.current?.loaded()}
          onError={() => setFailed(true)}
          style={{
            width: "100%",
            height: "min(580px, calc(100dvh - 68px))",
            minHeight: 0,
            border: 0,
          }}
        />
      )}
    </FloatingToolPanel>
  ) : null;
};
