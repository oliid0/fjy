import { useCallback, useEffect, useRef, useState } from "react";

import {
  CaptureUpdateAction,
  getCommonBounds,
  newElementWith,
} from "@fcboard/element";

import type { FcboardElement } from "@fcboard/element/types";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { objectSelection, updateFunctionGraph } from "./board";
import { FunctionGraphObject } from "./FunctionGraphObject";
import { classroomCommands } from "./commands";
import { TransientMessage } from "./TransientMessage";

import "./FunctionGraphInteraction.scss";

export const FunctionGraphInteraction = ({
  api,
}: {
  api: FcboardImperativeAPI;
}) => {
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const moving = useRef<
    { source: FcboardElement; last: FcboardElement } | undefined
  >(undefined);
  const refresh = useCallback(() => {
    // The live canvas now owns pixels; invalidate the existing scene once so its
    // saved image is retained for history/export without double compositing.
    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted()],
    });
  }, [api]);
  useEffect(() => {
    let signature = "";
    const sync = () => {
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
        state.selectedElementIds,
        state.isResizing,
        state.isRotating,
        !!classroomCommands.read("document"),
        api
          .getSceneElements()
          .filter(
            (element) => element.customData?.fcPlot?.renderer === "canvas",
          )
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
  const selecting = ["selection", "lasso"].includes(state.activeTool.type);
  const selected = Object.entries(state.selectedElementIds).filter(
    ([, value]) => value,
  );
  const plots = classroomCommands.read("document")
    ? []
    : api.getSceneElements().filter((element) => {
        if (
          element.type !== "image" ||
          element.customData?.fcPlot?.renderer !== "canvas"
        ) {
          return false;
        }
        if (element.customData.fcPlot.layer === "board") {
          return false;
        }
        const [left, top, right, bottom] = getCommonBounds([element]);
        return (
          (right + state.scrollX) * state.zoom.value >= 0 &&
          (left + state.scrollX) * state.zoom.value <= state.width &&
          (bottom + state.scrollY) * state.zoom.value >= 0 &&
          (top + state.scrollY) * state.zoom.value <= state.height
        );
      });
  return (
    <>
      <div className="fc-inline-function-layer" data-revision={revision}>
        {plots.map((element) => {
          const chosen =
            selecting &&
            !!state.selectedElementIds[element.id] &&
            selected.length === 1;
          const accepts =
            !element.locked &&
            !state.isResizing &&
            !state.isRotating &&
            state.activeTool.type !== "eraser" &&
            !(state.selectedElementIds[element.id] && selected.length > 1);
          return (
            <div
              key={element.id}
              className="fc-inline-function-object"
              data-selected={!!state.selectedElementIds[element.id]}
              style={{
                pointerEvents: accepts ? "auto" : "none",
                touchAction: "none",
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
              <FunctionGraphObject
                id={element.id}
                selected={chosen}
                preview={
                  element.type === "image" && element.fileId
                    ? api.getFiles()[element.fileId]?.dataURL
                    : undefined
                }
                onSelect={
                  selecting
                    ? () =>
                        api.updateScene({
                          appState: objectSelection([element]),
                          captureUpdate: CaptureUpdateAction.NEVER,
                        })
                    : undefined
                }
                plot={element.customData!.fcPlot.plot}
                color={element.strokeColor}
                strokeWidth={element.strokeWidth}
                strokeStyle={element.strokeStyle}
                angle={element.angle}
                displaySize={{
                  width: element.width * state.zoom.value,
                  height: element.height * state.zoom.value,
                }}
                interactive={accepts}
                onError={setError}
                onErasePointer={api.eraseOverlayPointer}
                onTranslate={
                  selecting
                    ? ({ dx, dy, phase }) => {
                        if (phase === "start") {
                          moving.current = { source: element, last: element };
                          return;
                        }
                        const gesture = moving.current;
                        const latest = api
                          .getSceneElements()
                          .find((item) => item.id === element.id);
                        if (
                          !gesture ||
                          !latest ||
                          latest !== gesture.last ||
                          latest.locked
                        ) {
                          moving.current = undefined;
                          return;
                        }
                        const position = {
                          x:
                            gesture.source.x +
                            (phase === "cancel" ? 0 : dx / state.zoom.value),
                          y:
                            gesture.source.y +
                            (phase === "cancel" ? 0 : dy / state.zoom.value),
                        };
                        let from = latest;
                        if (phase === "end") {
                          // Store micro-actions diff against the current scene, not
                          // the pre-drag snapshot. Rebase the preview before the one
                          // durable update, as document gesture commits do.
                          from = newElementWith(latest, {
                            x: gesture.source.x,
                            y: gesture.source.y,
                          });
                          api.updateScene({
                            elements: api
                              .getSceneElements()
                              .map((item) =>
                                item.id === from.id ? from : item,
                              ),
                            captureUpdate: CaptureUpdateAction.EVENTUALLY,
                          });
                        }
                        const next = newElementWith(from, position);
                        gesture.last = next;
                        if (phase !== "move") {
                          moving.current = undefined;
                        }
                        api.updateScene({
                          elements: api
                            .getSceneElements()
                            .map((item) => (item.id === next.id ? next : item)),
                          captureUpdate:
                            phase === "end"
                              ? CaptureUpdateAction.IMMEDIATELY
                              : CaptureUpdateAction.EVENTUALLY,
                        });
                      }
                    : undefined
                }
                onReady={refresh}
                onCommit={(plot) =>
                  updateFunctionGraph(api, plot, { ids: [element.id] })
                }
              />
            </div>
          );
        })}
      </div>
      <TransientMessage message={error} role="alert" />
    </>
  );
};
