import { useEffect } from "react";
import { CaptureUpdateAction } from "@fcboard/fcboard";
import { newIframeElement } from "@fcboard/element";

import type { FcboardImperativeAPI, DataURL } from "@fcboard/fcboard/types";

import { selectedPlot, updateFunctionGraph } from "./board";
import { classroomCommands } from "./commands";
import {
  functionGraphData,
  pickFunctionPoint,
  plotSize,
} from "./functionVisualization";
import { functionGraphResource } from "./functionGraphResource";
import { observeFunctionComparison } from "./functionComparison";

import type { InkStroke } from "./documents";
import type { Plot } from "./math";

const validView = (value: unknown): value is NonNullable<Plot["view"]> => {
  const box = value as Plot["view"];
  return (
    !!box &&
    [box.left, box.right, box.top, box.bottom].every(
      (number) =>
        typeof number === "number" &&
        Number.isFinite(number) &&
        Math.abs(number) <= 1e6,
    ) &&
    box.right - box.left >= 0.0001 &&
    box.right - box.left <= 2000 &&
    box.top - box.bottom >= 0.0001 &&
    box.top - box.bottom <= 2000
  );
};

/** The iframe owns every plot gesture. The host supplies bounded mathematical
 * samples and persists completed domain edits on the same movable object. */
export const FunctionGraphInteraction = ({
  api,
}: {
  api: FcboardImperativeAPI;
}) => {
  useEffect(() => observeFunctionComparison(api), [api]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const message = event.data;
      if (
        !message ||
        message.channel !== "fc-function-graph" ||
        typeof message.id !== "string" ||
        !Number.isSafeInteger(message.request) ||
        !["sample", "point", "commit"].includes(message.type) ||
        !validView(message.view)
      ) {
        return;
      }
      const frame = [
        ...document.querySelectorAll<HTMLIFrameElement>(
          "iframe[data-resource-object-id]",
        ),
      ].find((node) => node.contentWindow === event.source);
      const id = frame?.dataset.resourceObjectId;
      if (!id || !frame?.contentWindow) {
        return;
      }
      const doc = classroomCommands.read("document") as
        | { ink: InkStroke[] }
        | undefined;
      const object = doc
        ? doc.ink.find((stroke) => stroke.id === id)
        : api
            .getSceneElements()
            .find((element) => element.id === id && !element.isDeleted);
      const resource =
        object &&
        ("resource" in object
          ? object.resource
          : "customData" in object
          ? object.customData?.fcInteractiveResource
          : undefined);
      if (!resource || resource.id !== message.id) {
        return;
      }
      const graph = selectedPlot(api, [id]);
      if (!graph?.image) {
        return;
      }
      const plot: Plot = {
        ...graph.plot,
        view: message.view,
        range:
          Math.max(
            message.view.right - message.view.left,
            message.view.top - message.view.bottom,
          ) / 2,
      };
      const reply = (data: Record<string, unknown>) =>
        frame.contentWindow?.postMessage(
          {
            channel: "fc-function-graph",
            id: message.id,
            request: message.request,
            type: message.type,
            ...data,
          },
          "*",
        );
      try {
        if (message.type === "sample") {
          reply({ points: functionGraphData(plot, graph.image.color) });
        } else if (message.type === "point") {
          if (
            !Array.isArray(message.point) ||
            message.point.length !== 2 ||
            !message.point.every(
              (value: unknown) =>
                typeof value === "number" &&
                Number.isFinite(value) &&
                value >= 0 &&
                value <= 1,
            ) ||
            ![message.width, message.height].every(
              (value) =>
                typeof value === "number" &&
                Number.isFinite(value) &&
                value > 0 &&
                value <= 10000,
            )
          ) {
            return;
          }
          const location = { x: message.point[0], y: message.point[1] };
          const size = {
            width: (message.width * plotSize.width) / (plotSize.width - 60),
            height: (message.height * plotSize.height) / (plotSize.height - 40),
          };
          const points = [plot.expression, ...(plot.compare || [])].flatMap(
            (expression) => {
              const point = pickFunctionPoint(
                { ...plot, expression },
                location,
                size,
              );
              return point ? [{ ...point, expression }] : [];
            },
          );
          const target =
            plot.view!.bottom +
            location.y * (plot.view!.top - plot.view!.bottom);
          reply({
            point:
              points.sort(
                (a, b) => Math.abs(a.y - target) - Math.abs(b.y - target),
              )[0] || null,
          });
        } else {
          if (message.parameters !== undefined) {
            const parameters = message.parameters;
            if (
              !parameters ||
              typeof parameters !== "object" ||
              Array.isArray(parameters) ||
              Object.keys(parameters).some(
                (key) => !["a", "b", "c"].includes(key),
              ) ||
              Object.values(parameters).some(
                (value) =>
                  typeof value !== "number" ||
                  !Number.isFinite(value) ||
                  Math.abs(value) > 1000,
              )
            ) {
              return;
            }
            for (const key of ["a", "b", "c"] as const) {
              if (parameters[key] !== undefined) {
                plot[key] = parameters[key];
              }
            }
          }
          updateFunctionGraph(api, plot, {
            ids: graph.ids,
            onError: (error) =>
              reply({
                error: error instanceof Error ? error.message : String(error),
              }),
          });
        }
      } catch (error) {
        reply({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
    // Upgrade saved SVG graphs through the ordinary object representation. The
    // previous vector remains in files/history; the replacement keeps its ID.
    let migrating = false;
    const migrate = () => {
      if (migrating || classroomCommands.read("document")) {
        return;
      }
      const scene = api.getSceneElements();
      const legacy = scene.filter(
        (element) =>
          element.type === "image" &&
          element.customData?.fcPlot?.renderer === "vega",
      );
      if (!legacy.length) {
        return;
      }
      migrating = true;
      try {
        const replacements = new Map(
          legacy.map((element) => {
            const metadata = element.customData!.fcPlot;
            const image =
              element.type === "image" && element.fileId
                ? api.getFiles()[element.fileId]?.dataURL
                : undefined;
            const resource = functionGraphResource(
              metadata.plot,
              element.strokeColor,
              metadata.id,
              image as DataURL | undefined,
            );
            return [
              element.id,
              newIframeElement({
                ...element,
                type: "iframe",
                strokeWidth: 0,
                customData: {
                  ...element.customData,
                  fcInteractiveResource: resource,
                  generationData: { status: "done", html: resource.html },
                  fcPlot: { ...metadata, renderer: "iframe" },
                },
              }),
            ] as const;
          }),
        );
        api.updateScene({
          elements: scene.map(
            (element) => replacements.get(element.id) || element,
          ),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      } catch {
        /* Invalid imported plot metadata stays visible as its saved image. */
      } finally {
        migrating = false;
      }
    };
    migrate();
    const stop = api.onChange(migrate);
    window.addEventListener("message", receive);
    return () => {
      stop();
      window.removeEventListener("message", receive);
    };
  }, [api]);
  return null;
};
