import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { selectedBoardElements } from "./ai";

export const selectionSignature = (elements: readonly ExcalidrawElement[]) =>
  elements
    .map((element) => `${element.id}:${element.version}`)
    .sort()
    .join(",");

/** Wait for the existing selection gesture to finish. Invalidate late cloud responses. */
export const observeMathSelection = (
  api: ExcalidrawImperativeAPI,
  process: (
    elements: readonly ExcalidrawElement[],
    signature: string,
    signal: AbortSignal,
  ) => Promise<void>,
  onBusy: (busy: boolean) => void,
  onError: (error: unknown) => void,
) => {
  let previous = "";
  let timer: ReturnType<typeof setTimeout>;
  let controller: AbortController | undefined;
  const handled = new Set<string>();
  const refresh = () => {
    const state = api.getAppState();
    const selected = selectedBoardElements(api);
    const eligible =
      !state.editingTextElement &&
      state.cursorButton !== "down" &&
      !state.isResizing &&
      !state.isRotating &&
      !selected.some((element) => element.customData?.fcPlot);
    const source = eligible
      ? selected.filter((element) => !element.customData?.fcGenerated)
      : [];
    const signature = selectionSignature(source);
    if (signature === previous) {
      return;
    }
    previous = signature;
    clearTimeout(timer);
    controller?.abort();
    onBusy(false);
    if (
      !signature ||
      handled.has(signature) ||
      api
        .getSceneElements()
        .some((el) => el.customData?.fcSelectionSource === signature)
    ) {
      return;
    }
    const request = new AbortController();
    controller = request;
    timer = setTimeout(() => {
      onBusy(true);
      void process(source, signature, request.signal)
        .then(() => {
          if (!request.signal.aborted) {
            handled.add(signature);
            if (handled.size > 200) {
              handled.delete(handled.values().next().value!);
            }
          }
        })
        .catch((error) => {
          if (!request.signal.aborted) {
            onError(error);
          }
        })
        .finally(() => {
          if (controller === request) {
            onBusy(false);
          }
        });
    }, 400);
  };
  const unsubscribe = api.onChange(refresh);
  refresh();
  return () => {
    clearTimeout(timer);
    controller?.abort();
    unsubscribe();
  };
};
