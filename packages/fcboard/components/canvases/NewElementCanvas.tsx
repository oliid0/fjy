import { useLayoutEffect, useRef } from "react";

import type {
  FcboardFreeDrawElement,
  NonDeletedSceneElementsMap,
} from "@fcboard/element/types";

import { isRenderThrottlingEnabled } from "../../reactUtils";
import {
  renderNewElementScene,
  renderNewElementSceneThrottled,
} from "../../renderer/renderNewElementScene";

import type {
  RenderableElementsMap,
  StaticCanvasRenderConfig,
} from "../../scene/types";
import type { AppState } from "../../types";
import type { RoughCanvas } from "roughjs/bin/canvas";

interface NewElementCanvasProps {
  appState: AppState;
  elementsMap: RenderableElementsMap;
  allElementsMap: NonDeletedSceneElementsMap;
  scale: number;
  rc: RoughCanvas;
  renderConfig: StaticCanvasRenderConfig;
  getActiveInkElements?: () => readonly FcboardFreeDrawElement[];
  onInkFrame?: (listener: () => void) => () => void;
}

const NewElementCanvas = (props: NewElementCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useLayoutEffect(() => {
    if (!canvasRef.current) {
      return;
    }
    const paint = () => {
      const canvas = canvasRef.current!;
      const activeInkElements = props.getActiveInkElements?.();
      const drawing =
        !!props.appState.newElement || !!activeInkElements?.length;
      const width = drawing ? props.appState.width * props.scale : 1;
      const height = drawing ? props.appState.height * props.scale : 1;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      if (!drawing) {
        renderNewElementSceneThrottled.cancel();
        return;
      }
      renderNewElementScene(
        {
          canvas: canvasRef.current,
          scale: props.scale,
          newElement: props.appState.newElement,
          activeInkElements,
          elementsMap: props.elementsMap,
          allElementsMap: props.allElementsMap,
          rc: props.rc,
          renderConfig: props.renderConfig,
          appState: props.appState,
        },
        props.getActiveInkElements ||
          props.appState.newElement?.customData?.fcInk
          ? false
          : isRenderThrottlingEnabled(),
      );
    };
    paint();
    return props.onInkFrame?.(paint);
  });

  return (
    <canvas
      className="fcboard__canvas new-element"
      style={{
        width: props.appState.width,
        height: props.appState.height,
      }}
      width={1}
      height={1}
      ref={canvasRef}
    />
  );
};

export default NewElementCanvas;
