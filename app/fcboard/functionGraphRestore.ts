import { newImageElement } from "@fcboard/element";

import type { FcboardElement, FileId } from "@fcboard/element/types";
import type { BinaryFiles } from "@fcboard/fcboard/types";

import { functionGraphImage } from "./functionVisualization";
import { validatedPlot } from "./mathRecognition";

import type { DocumentInk } from "./documents";

/** Old saved iframe plots become the same transparent SVG object as new plots. */
export const restoreDocumentFunctionGraphs = (
  ink: DocumentInk,
): DocumentInk => {
  let changed = false;
  const restored = Object.fromEntries(
    Object.entries(ink).map(([page, strokes]) => [
      page,
      strokes.map((stroke) => {
        if (stroke.plot?.renderer !== "iframe" || !stroke.resource) {
          return stroke;
        }
        try {
          const plot = validatedPlot({ ...stroke.plot.plot });
          changed = true;
          return {
            ...stroke,
            shapeType: "image" as const,
            image: functionGraphImage(plot, stroke.color),
            imageWidth: stroke.resource.width,
            imageHeight: stroke.resource.height,
            resource: undefined,
            plot: { ...stroke.plot, plot, renderer: "vega" as const },
          };
        } catch {
          return stroke;
        }
      }),
    ]),
  );
  return changed ? restored : ink;
};

/** Decode saved graph data into the sole SVG representation. No iframe runtime remains. */
export const restoreBoardFunctionGraphs = (
  elements: readonly FcboardElement[],
  files: BinaryFiles,
) => {
  let restoredFiles = files;
  const restored = elements.map((element) => {
    const graph = element.customData?.fcPlot;
    if (
      element.isDeleted ||
      element.type !== "iframe" ||
      graph?.renderer !== "iframe"
    ) {
      return element;
    }
    try {
      const plot = validatedPlot(graph.plot);
      const fileId =
        `function-graph-${element.id}-${element.version}` as FileId;
      const dataURL = functionGraphImage(plot, element.strokeColor);
      if (restoredFiles === files) {
        restoredFiles = { ...files };
      }
      restoredFiles[fileId] = {
        id: fileId,
        dataURL,
        mimeType: "image/svg+xml",
        created: element.updated,
      };
      const { fcInteractiveResource, generationData, ...customData } =
        element.customData!;
      return newImageElement({
        ...element,
        type: "image",
        fileId,
        status: "saved",
        scale: [1, 1],
        customData: {
          ...customData,
          fcPlot: { ...graph, plot, renderer: "vega" },
        },
      });
    } catch {
      return element;
    }
  });
  return {
    elements: restoredFiles === files ? elements : restored,
    files: restoredFiles,
  };
};
