import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { classroomCommands } from "./commands";
import { readWidgets, renderWidget } from "./widgets";

import type { Widget } from "./widgets";
import type { InkStroke } from "./documents";

/** One visual transition, one history entry. Late frames never recreate a removed object. */
export const animateSolid = (
  api: FcboardImperativeAPI,
  original: Widget,
  target: Widget,
  signal: AbortSignal,
  duration = 600,
  transaction: {
    remember?: boolean;
    before?: readonly InkStroke[];
    rollback?: Widget;
  } = {},
) =>
  new Promise<{ ids: string[] }>((resolve, reject) => {
    const revision = classroomCommands.revision;
    const document = classroomCommands.read("document") as
      | { id?: string; page: number; ink: InkStroke[] }
      | undefined;
    const before =
      transaction.before ||
      document?.ink.filter((stroke) => stroke.widget?.id === original.id);
    const identity = document ? `${document.id}:${document.page}` : undefined;
    let last = JSON.stringify(original);
    let frame = 0;
    let start: number | undefined;
    let finished = false;
    let stopPointer = () => {};
    let stopPage = () => {};
    let stopRevision = () => {};
    const current = (restoring = false) => {
      const active = classroomCommands.read("document") as
        | { id?: string; page: number; selectionInProgress?: boolean }
        | undefined;
      return (
        revision === classroomCommands.revision &&
        identity === (active ? `${active.id}:${active.page}` : undefined) &&
        (restoring || !active?.selectionInProgress) &&
        JSON.stringify(
          readWidgets(api).find((widget) => widget.id === original.id),
        ) === last
      );
    };
    const cleanup = () => {
      finished = true;
      cancelAnimationFrame(frame);
      signal.removeEventListener("abort", abort);
      window.removeEventListener("blur", abort);
      stopPointer();
      stopPage();
      stopRevision();
    };
    const abort = () => {
      if (finished) {
        return;
      }
      const restore = current(true);
      cleanup();
      try {
        if (restore) {
          renderWidget(api, transaction.rollback || original, false, {
            preview: true,
          });
        }
      } catch (error) {
        reject(error);
        return;
      }
      reject(new DOMException("Solid animation cancelled", "AbortError"));
    };
    const tick = (time: number) => {
      if (signal.aborted || !current()) {
        abort();
        return;
      }
      try {
        start ??= time;
        const elapsed =
          duration <= 0 ? 1 : Math.min(1, (time - start) / duration);
        const progress = elapsed * elapsed * (3 - 2 * elapsed);
        const pose = {
          ...target,
          params: {
            ...target.params,
            solid: {
              ...target.params.solid,
              unfold:
                original.params.solid.unfold +
                (target.params.solid.unfold - original.params.solid.unfold) *
                  progress,
            },
          },
        };
        const elements = renderWidget(
          api,
          pose,
          elapsed === 1 && transaction.remember !== false,
          {
            before:
              elapsed === 1 && transaction.remember !== false
                ? before
                : undefined,
            preview: elapsed !== 1 || transaction.remember === false,
          },
        );
        last = JSON.stringify(
          readWidgets(api).find((widget) => widget.id === original.id),
        );
        if (elapsed === 1) {
          cleanup();
          resolve({ ids: elements.map((element) => element.id) });
        } else {
          frame = requestAnimationFrame(tick);
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    window.addEventListener("blur", abort);
    stopPointer = api.onPointerDown?.(() => abort()) || stopPointer;
    stopPage = classroomCommands.watch("document", () => {
      // FilePreview publishes the pose synchronously while renderWidget is running.
      queueMicrotask(() => {
        if (!finished && !current()) {
          abort();
        }
      });
    });
    stopRevision = classroomCommands.onInvalidate(abort);
    if (signal.aborted) {
      abort();
    } else if (duration <= 0) {
      tick(performance.now());
    } else {
      frame = requestAnimationFrame(tick);
    }
  });
