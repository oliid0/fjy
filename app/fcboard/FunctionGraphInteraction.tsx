import { useCallback, useEffect, useState } from "react";
import { CaptureUpdateAction } from "@fcboard/element";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { updateFunctionGraph } from "./board";
import { InlineFunctionGraph } from "./InlineFunctionGraph";
import { restoreBoardFunctionGraphs } from "./functionGraphRestore";
import { observeFunctionComparison } from "./functionComparison";
import { classroomCommands } from "./commands";

import "./FunctionGraphInteraction.scss";

export const FunctionGraphInteraction = ({
  api,
}: {
  api: FcboardImperativeAPI;
}) => {
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => {
    // The live SVG now owns pixels; invalidate the existing scene once so its
    // saved image is retained for history/export without double compositing.
    api.updateScene({
      elements: [...api.getSceneElements()],
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [api]);
  useEffect(() => observeFunctionComparison(api), [api]);
  useEffect(() => {
    let migrating = false;
    let signature = "";
    const sync = () => {
      if (migrating) {
        return;
      }
      const files = api.getFiles();
      const restored = restoreBoardFunctionGraphs(
        api.getSceneElements(),
        files,
      );
      if (restored.files !== files) {
        migrating = true;
        try {
          api.addFiles(
            Object.values(restored.files).filter(
              (file) => files[file.id] !== file,
            ),
          );
          api.updateScene({
            elements: restored.elements,
            captureUpdate: CaptureUpdateAction.NEVER,
          });
        } finally {
          migrating = false;
        }
      }
      const state = api.getAppState();
      const next = JSON.stringify([
        state.scrollX,
        state.scrollY,
        state.zoom.value,
        state.width,
        state.height,
        state.offsetLeft,
        state.offsetTop,
        state.activeTool.type,
        !!classroomCommands.read("document"),
        api
          .getSceneElements()
          .filter((element) => element.customData?.fcPlot?.renderer === "vega")
          .map((element) => [
            element.id,
            element.version,
            element.versionNonce,
          ]),
      ]);
      if (next !== signature) {
        signature = next;
        setRevision((value) => value + 1);
      }
    };
    const stops = [
      api.onChange(sync),
      classroomCommands.watch("document", sync),
    ];
    sync();
    return () => stops.forEach((stop) => stop());
  }, [api]);
  const state = api.getAppState();
  if (classroomCommands.read("document")) {
    return null;
  }
  return (
    <div className="fc-inline-function-layer" data-revision={revision}>
      {api
        .getSceneElements()
        .filter(
          (element) =>
            element.type === "image" &&
            element.customData?.fcPlot?.renderer === "vega",
        )
        .map((element) => (
          <div
            key={element.id}
            className="fc-inline-function-object"
            style={{
              left:
                (element.x + state.scrollX) * state.zoom.value +
                state.offsetLeft,
              top:
                (element.y + state.scrollY) * state.zoom.value +
                state.offsetTop,
              width: element.width * state.zoom.value,
              height: element.height * state.zoom.value,
              transform: `rotate(${element.angle}rad)`,
              opacity: element.opacity / 100,
            }}
          >
            <InlineFunctionGraph
              id={element.id}
              plot={element.customData!.fcPlot.plot}
              color={element.strokeColor}
              onReady={refresh}
              onCommit={(plot) =>
                updateFunctionGraph(api, plot, { ids: [element.id] })
              }
            />
          </div>
        ))}
    </div>
  );
};
