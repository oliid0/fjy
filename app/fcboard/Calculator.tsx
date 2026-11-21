import { useEffect } from "react";
import { t } from "@fcboard/fcboard/i18n";
import { requestResourceControl } from "@fcboard/fcboard/interactiveResourceControls";
import { calculatorResourceId } from "@fcboard/fcboard/interactiveHtml";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";
import type { InteractiveResource } from "@fcboard/fcboard/interactiveHtml";

import { classroomCommands } from "./commands";

import type { InkStroke } from "./documents";

/** Commands address the mounted calculator on the visible board or courseware. */
export const Calculator = ({ api }: { api: FcboardImperativeAPI }) => {
  useEffect(() => {
    const visible = () => {
      const doc = classroomCommands.read("document") as
        | {
            id?: string;
            name?: string;
            page?: number;
            selection?: string[];
            ink: InkStroke[];
          }
        | undefined;
      const objects = doc
        ? doc.ink.flatMap((stroke) =>
            stroke.resource?.id === calculatorResourceId
              ? [
                  {
                    id: stroke.id,
                    resource: stroke.resource as InteractiveResource,
                  },
                ]
              : [],
          )
        : api.getSceneElements().flatMap((element) =>
            !element.isDeleted &&
            element.customData?.fcInteractiveResource?.id ===
              calculatorResourceId
              ? [
                  {
                    id: element.id,
                    resource: element.customData
                      .fcInteractiveResource as InteractiveResource,
                  },
                ]
              : [],
          );
      const selection = doc
        ? doc.selection || []
        : Object.keys(api.getAppState().selectedElementIds);
      const board = classroomCommands.read("boards") as
        | { active?: string }
        | undefined;
      return {
        objects,
        selection,
        surface: doc ? ("document" as const) : ("whiteboard" as const),
        token: JSON.stringify(
          doc ? [doc.id, doc.name, doc.page] : [api.id, board?.active],
        ),
      };
    };
    const target = (args: Record<string, unknown>) => {
      const source = visible();
      if (args.id !== undefined && typeof args.id !== "string") {
        throw new Error(t("fcboard.invalid_style_parameters"));
      }
      const object = args.id
        ? source.objects.find((item) => item.id === args.id)
        : source.objects.find((item) => source.selection.includes(item.id)) ||
          source.objects.at(-1);
      return { ...source, object };
    };
    const operate = (args: Record<string, unknown>, click: boolean) => {
      const source = target(args);
      if (!source.object) {
        throw new Error(t("fcboard.this_board_action_is_unavailable"));
      }
      if (
        click &&
        (typeof args.version !== "string" || typeof args.control !== "string")
      ) {
        throw new Error(t("fcboard.invalid_style_parameters"));
      }
      const { id, resource } = source.object;
      const current = () => {
        const next = visible();
        return (
          next.token === source.token &&
          next.objects.some(
            (item) => item.id === id && item.resource.html === resource.html,
          )
        );
      };
      const action = click
        ? {
            type: "click" as const,
            version: args.version as string,
            control: args.control as string,
          }
        : { type: "inspect" as const };
      const signal =
        args.signal instanceof AbortSignal ? args.signal : undefined;
      return requestResourceControl(
        { id, surface: source.surface, html: resource.html },
        action,
        { signal, current },
      );
    };
    const stops = [
      classroomCommands.register(
        "tools.calculator",
        "Open or reuse an ordinary selectable calculator object on the visible board/document. args.open=false closes the selected/last calculator, optional args.id identifies a copied instance. calculator.inspect/press operate its actual keys.",
        async (args) => {
          if (args.open !== undefined && typeof args.open !== "boolean") {
            throw new Error(t("fcboard.invalid_style_parameters"));
          }
          const source = target(args);
          if (args.id && !source.object) {
            throw new Error(t("fcboard.this_board_action_is_unavailable"));
          }
          if (args.open === false) {
            if (source.object) {
              await classroomCommands.execute({
                name: "canvas.erase",
                args: { ids: [source.object.id] },
              });
            }
            return { open: false };
          }
          const result = source.object
            ? { ids: [source.object.id] }
            : await classroomCommands.execute({
                name: "canvas.resource",
                args: {
                  resource: {
                    id: calculatorResourceId,
                    title: t("fcboard.calculator"),
                    html: "",
                  },
                  signal: args.signal,
                },
              });
          return { open: true, ...(result as { ids: string[] }) };
        },
      ),
      classroomCommands.register(
        "calculator.inspect",
        "Read the selected/last visible calculator's actual keys, display and version. Optional args.id identifies its scene object.",
        (args) => operate(args, false),
      ),
      classroomCommands.register(
        "calculator.press",
        "Press an actual calculator key from calculator.inspect; args.version/control required, optional args.id identifies its scene object.",
        (args) => operate(args, true),
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [api]);
  return null;
};
