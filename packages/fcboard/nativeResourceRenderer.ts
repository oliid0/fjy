import type { ReactNode } from "react";
import type { InteractiveResourceFrameProps } from "./components/InteractiveResourceFrame";

type Renderer = (props: InteractiveResourceFrameProps) => ReactNode | undefined;
let renderer: Renderer | undefined;

/** The application owns platform integration; the editor keeps its portable scene. */
export const registerNativeResourceRenderer = (next: Renderer) => {
  renderer = next;
  return () => {
    if (renderer === next) {
      renderer = undefined;
    }
  };
};
export const nativeResourceFrame = (props: InteractiveResourceFrameProps) =>
  renderer?.(props);
