import { useEffect } from "react";
import { isColorDark } from "@fcboard/common";
import { CaptureUpdateAction, newElementWith } from "@fcboard/element";
import { t } from "@fcboard/fcboard/i18n";
import { requestResourceControl } from "@fcboard/fcboard/interactiveResourceControls";
import { validateInteractiveResource } from "@fcboard/fcboard/interactiveHtml";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";
import type { InteractiveResource } from "@fcboard/fcboard/interactiveHtml";

import { classroomCommands } from "./commands";
import {
  hasNativeCalculator,
  nativeCalculatorControl,
  setNativeCalculatorTheme,
} from "./nativeResources";
import calculator from "./calculator/calculator.html?raw";

import type { InkStroke } from "./documents";

const calculatorId = "builtin-calculator";
export const calculatorResource = (dark: boolean) =>
  validateInteractiveResource({
    id: calculatorId,
    title: t("fcboard.calculator"),
    html: calculator.replace(
      '<html lang="en">',
      `<html lang="en" data-board-theme="${dark ? "dark" : "light"}">`,
    ),
  });

/** The offline reference calculator lives in the same object/frame path as lessons. */
export const Calculator = ({ api }: { api: FcboardImperativeAPI }) => {
  useEffect(() => {
    const current = () => {
      const document = classroomCommands.read("document") as
        | { ink: InkStroke[] }
        | undefined;
      if (document) {
        const object = document.ink.find(
          (stroke) => stroke.resource?.id === calculatorId,
        );
        return object?.resource
          ? {
              id: object.id,
              resource: object.resource,
              surface: "document" as const,
            }
          : undefined;
      }
      const object = api
        .getSceneElements()
        .find(
          (element) =>
            !element.isDeleted &&
            element.customData?.fcInteractiveResource?.id === calculatorId,
        );
      return object
        ? {
            id: object.id,
            resource: object.customData!
              .fcInteractiveResource as InteractiveResource,
            surface: "whiteboard" as const,
          }
        : undefined;
    };
    const close = async () => {
      const object = current();
      if (!object) {
        return;
      }
      if (object.surface === "document") {
        await classroomCommands.execute({
          name: "document.erase",
          args: { ids: [object.id] },
        });
      } else {
        api.updateScene({
          elements: api
            .getSceneElements()
            .map((element) =>
              element.id === object.id
                ? newElementWith(element, { isDeleted: true })
                : element,
            ),
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      }
    };
    const operate = (args: Record<string, unknown>, click: boolean) => {
      const object = current();
      if (!object) {
        throw new Error(t("fcboard.this_board_action_is_unavailable"));
      }
      if (
        click &&
        (typeof args.version !== "string" || typeof args.control !== "string")
      ) {
        throw new Error(t("fcboard.invalid_style_parameters"));
      }
      if (hasNativeCalculator()) {
        return nativeCalculatorControl(
          object.id,
          click
            ? {
                type: "click",
                version: args.version as string,
                control: args.control as string,
              }
            : { type: "inspect" },
          args.signal instanceof AbortSignal ? args.signal : undefined,
          () => current()?.id === object.id,
        );
      }
      return requestResourceControl(
        { id: object.id, surface: object.surface, html: object.resource.html },
        click
          ? {
              type: "click",
              version: args.version as string,
              control: args.control as string,
            }
          : { type: "inspect" },
        {
          signal: args.signal instanceof AbortSignal ? args.signal : undefined,
          current: () => current()?.id === object.id,
        },
      );
    };
    let previousTheme: boolean | undefined;
    const theme = () => {
      const dark = isColorDark(
        api.getAppState().viewBackgroundColor || "#ffffff",
      );
      if (dark === previousTheme) {
        return;
      }
      previousTheme = dark;
      const object = current();
      if (!object) {
        return;
      }
      if (hasNativeCalculator()) {
        setNativeCalculatorTheme(object.id, dark);
      }
      document
        .querySelector<HTMLIFrameElement>(
          `iframe[data-resource-object-id="${object.id}"]`,
        )
        ?.contentWindow?.postMessage(
          { channel: "fc-calculator-theme", dark },
          "*",
        );
    };
    const stops = [
      classroomCommands.register(
        "tools.calculator",
        "Open the offline calculator object on the visible surface; args.open=false closes it. calculator.inspect/press operate its real keys.",
        async (args) => {
          if (args.open !== undefined && typeof args.open !== "boolean") {
            throw new Error(t("fcboard.invalid_style_parameters"));
          }
          if (args.open === false) {
            await close();
            return { open: false };
          }
          const object = current();
          if (object) {
            await classroomCommands.execute({
              name: "canvas.select",
              args: { ids: [object.id] },
            });
            return { open: true, ids: [object.id] };
          }
          const resource = calculatorResource(
            isColorDark(api.getAppState().viewBackgroundColor || "#ffffff"),
          );
          const result = await classroomCommands.execute({
            name: "canvas.resource",
            args: { resource },
          });
          return { open: true, ...(result as { ids: string[] }) };
        },
      ),
      classroomCommands.register(
        "calculator.inspect",
        "Read the calculator object's actual keys, display and version.",
        (args) => operate(args, false),
      ),
      classroomCommands.register(
        "calculator.press",
        "Press an actual key from calculator.inspect; args.version/control required.",
        (args) => operate(args, true),
      ),
      api.onChange(theme),
      classroomCommands.watch("document", () => {
        previousTheme = undefined;
        theme();
      }),
    ];
    return () => stops.forEach((stop) => stop());
  }, [api]);
  return null;
};
