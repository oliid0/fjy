import { CaptureUpdateAction, restoreElements } from "@excalidraw/excalidraw";
import { canvasStrokeColor } from "@excalidraw/common";
import { flushSync } from "react-dom";
import { reconcileElements } from "@excalidraw/excalidraw/data/reconcile";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { OrderedExcalidrawElement } from "@excalidraw/element/types";
import type {
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

export type ScenePacket = {
  kind: "scene" | "initial";
  elements: readonly OrderedExcalidrawElement[];
  files: BinaryFiles;
  background?: { color: string; clock: number; client: string };
};
const stamp = (element: OrderedExcalidrawElement) =>
  `${element.version}:${element.versionNonce}:${element.isDeleted}`;
const newer = (
  a: NonNullable<ScenePacket["background"]>,
  b?: ScenePacket["background"],
) => !b || a.clock > b.clock || (a.clock === b.clock && a.client > b.client);

/** A transport-independent adapter, sharing the original conflict/history implementation. */
export class SceneSync {
  private known = new Map<string, string>();
  private files = new Set<string>();
  private background: NonNullable<ScenePacket["background"]>;
  private clock = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private stop?: () => void;
  private stopPointer?: () => void;
  private full = false;
  private disposed = false;
  private applying = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private api: ExcalidrawImperativeAPI,
    private send: (packet: ScenePacket) => Promise<void>,
    private onError: (error: unknown) => void,
    private client = crypto.randomUUID(),
  ) {
    this.background = {
      color: api.getAppState().viewBackgroundColor,
      clock: 0,
      client,
    };
  }
  snapshot(): ScenePacket {
    return {
      kind: "scene",
      elements: this.api.getSceneElementsIncludingDeleted(),
      files: this.api.getFiles(),
      background: this.background,
    };
  }
  start() {
    let editing = false;
    this.stop = this.api.onChange((_, state) => {
      if (!this.applying) {
        const nextEditing = !!(
          state.newElement ||
          state.resizingElement ||
          state.editingTextElement
        );
        this.full ||= editing && !nextEditing;
        editing = nextEditing;
        if (!this.timer) {
          this.timer = setTimeout(() => {
            this.timer = undefined;
            this.flush(this.full);
            this.full = false;
          }, 40);
        }
      }
    });
    this.stopPointer = this.api.onPointerUp(() => {
      this.full = true;
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.flush(true);
          this.full = false;
        }, 40);
      }
    });
  }
  flush(full = false) {
    if (this.disposed) {
      return;
    }
    const all = this.api.getSceneElementsIncludingDeleted();
    const elements = all.filter(
      (el) => full || this.known.get(el.id) !== stamp(el),
    );
    const files = Object.fromEntries(
      Object.entries(this.api.getFiles()).filter(
        ([id]) => full || !this.files.has(id),
      ),
    );
    const color = this.api.getAppState().viewBackgroundColor;
    const changedColor = this.background.color !== color;
    if (changedColor) {
      this.background = { color, clock: ++this.clock, client: this.client };
    }
    if (
      !full &&
      !elements.length &&
      !Object.keys(files).length &&
      !changedColor
    ) {
      return;
    }
    for (const el of elements) {
      this.known.set(el.id, stamp(el));
    }
    Object.keys(files).forEach((id) => this.files.add(id));
    const packet: ScenePacket = {
      kind: "scene",
      elements,
      files,
      ...(full || changedColor ? { background: this.background } : {}),
    };
    this.queue = this.queue
      .then(() => (this.disposed ? undefined : this.send(packet)))
      .catch((error) => {
        this.known.clear();
        this.files.clear();
        this.onError(error);
      });
  }
  receive(packet: ScenePacket, replace = false) {
    if (
      this.disposed ||
      !Array.isArray(packet.elements) ||
      packet.elements.length > 50000 ||
      !packet.files ||
      typeof packet.files !== "object"
    ) {
      throw new Error("同步数据无效");
    }
    if (!replace) {
      this.flush();
    }
    const local = replace ? [] : this.api.getSceneElementsIncludingDeleted();
    const remote = restoreElements(packet.elements, null, {
      refreshDimensions: false,
      repairBindings: false,
    }) as unknown as RemoteExcalidrawElement[];
    const elements = reconcileElements(local, remote, this.api.getAppState());
    this.applying = true;
    try {
      const received = new Map(remote.map((el) => [el.id, stamp(el)]));
      for (const el of elements) {
        if (received.get(el.id) === stamp(el)) {
          this.known.set(el.id, stamp(el));
        }
      }
      Object.keys(packet.files).forEach((id) => this.files.add(id));
      const color = packet.background;
      if (
        color &&
        Number.isSafeInteger(color.clock) &&
        typeof color.color === "string" &&
        typeof color.client === "string"
      ) {
        this.clock = Math.max(this.clock, color.clock);
        if (newer(color, this.background) || replace) {
          this.background = color;
        }
      }
      flushSync(() => {
        this.api.addFiles(Object.values(packet.files));
        this.api.updateScene({
          elements,
          appState: {
            viewBackgroundColor: this.background.color,
            currentItemStrokeColor:
              this.background.color !==
              this.api.getAppState().viewBackgroundColor
                ? canvasStrokeColor(
                    this.background.color,
                    this.api.getAppState().currentItemStrokeColor,
                    this.api.getAppState().viewBackgroundColor,
                  )
                : this.api.getAppState().currentItemStrokeColor,
          },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      });
    } finally {
      this.applying = false;
    }
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.stop?.();
    this.stopPointer?.();
  }
}
