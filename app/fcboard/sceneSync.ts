import { t } from "@fcboard/fcboard/i18n";
import { CaptureUpdateAction, restoreElements } from "@fcboard/fcboard";
import { canvasStrokeColor } from "@fcboard/common";
import { flushSync } from "react-dom";
import { reconcileElements } from "@fcboard/fcboard/data/reconcile";
import { validWhiteboardBackground } from "@fcboard/fcboard/whiteboardBackground";

import type { WhiteboardBackground } from "@fcboard/fcboard/whiteboardBackground";

import type { RemoteFcboardElement } from "@fcboard/fcboard/data/reconcile";
import type { OrderedFcboardElement } from "@fcboard/element/types";
import type { BinaryFiles, FcboardImperativeAPI } from "@fcboard/fcboard/types";

export type ScenePacket = {
  kind: "scene" | "initial";
  page?: { id: string; epoch: number };
  document?: SharedDocument;
  elements: readonly OrderedFcboardElement[];
  files: BinaryFiles;
  background?: {
    color: string;
    clock: number;
    client: string;
    pattern?: WhiteboardBackground | null;
  };
};
export type SharedDocument = {
  id: string;
  name: string;
  mimeType: string;
  page: number;
  dataURL?: string;
  view?: SharedDocumentView;
};
export type SharedDocumentView = {
  zoom: number;
  scroll: number;
  animation: number;
  animate: boolean;
};
export type SceneSyncAPI = Pick<
  FcboardImperativeAPI,
  | "getAppState"
  | "getFiles"
  | "getSceneElementsIncludingDeleted"
  | "onChange"
  | "onPointerUp"
  | "resetScene"
  | "history"
  | "addFiles"
  | "updateScene"
>;
const stamp = (element: OrderedFcboardElement) =>
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
  private page?: ScenePacket["page"];
  private authoritative = false;

  constructor(
    private api: SceneSyncAPI,
    private send: (packet: ScenePacket) => Promise<void>,
    private onError: (error: unknown) => void,
    private client = crypto.randomUUID(),
  ) {
    this.background = {
      color: api.getAppState().viewBackgroundColor,
      pattern: api.getAppState().whiteboardBackground ?? null,
      clock: 0,
      client,
    };
  }
  snapshot(): ScenePacket {
    return {
      kind: "scene",
      ...(this.page ? { page: this.page } : {}),
      elements: this.api.getSceneElementsIncludingDeleted(),
      files: this.api.getFiles(),
      background: this.background,
    };
  }
  /** Host navigation starts a new scene epoch, including when returning to an earlier board. */
  hostPage(id: string, epoch = (this.page?.epoch ?? -1) + 1) {
    this.authoritative = true;
    if (this.page?.id === id) {
      return false;
    }
    this.page = { id, epoch };
    clearTimeout(this.timer);
    this.timer = undefined;
    this.known.clear();
    this.files.clear();
    this.background = {
      color: this.api.getAppState().viewBackgroundColor,
      pattern: this.api.getAppState().whiteboardBackground ?? null,
      clock: ++this.clock,
      client: this.client,
    };
    return true;
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
          }, 16);
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
        }, 16);
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
    const pattern = this.api.getAppState().whiteboardBackground ?? null;
    const changedColor =
      this.background.color !== color ||
      (this.background.pattern !== pattern &&
        (this.background.pattern?.pattern !== pattern?.pattern ||
          this.background.pattern?.width !== pattern?.width ||
          this.background.pattern?.height !== pattern?.height ||
          this.background.pattern?.image !== pattern?.image));
    if (changedColor) {
      this.background = {
        color,
        pattern,
        clock: ++this.clock,
        client: this.client,
      };
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
      ...(this.page ? { page: this.page } : {}),
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
      throw new Error(t("fcboard.invalid_sync_data"));
    }
    if (
      packet.page &&
      (typeof packet.page.id !== "string" ||
        !packet.page.id ||
        packet.page.id.length > 128 ||
        !Number.isSafeInteger(packet.page.epoch) ||
        packet.page.epoch < 0)
    ) {
      throw new Error(t("fcboard.invalid_sync_data"));
    }
    const changedPage =
      packet.page?.id !== this.page?.id ||
      packet.page?.epoch !== this.page?.epoch;
    if (changedPage) {
      if (
        this.authoritative ||
        !packet.page ||
        (this.page && packet.page.epoch <= this.page.epoch)
      ) {
        return;
      }
      this.page = { id: packet.page.id, epoch: packet.page.epoch };
      this.known.clear();
      this.files.clear();
      clearTimeout(this.timer);
      this.timer = undefined;
      replace = true;
    }
    if (!replace) {
      this.flush();
    }
    const local = replace ? [] : this.api.getSceneElementsIncludingDeleted();
    const remote = restoreElements(packet.elements, null, {
      refreshDimensions: false,
      repairBindings: false,
    }) as unknown as RemoteFcboardElement[];
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
        typeof color.client === "string" &&
        (color.pattern == null || validWhiteboardBackground(color.pattern))
      ) {
        this.clock = Math.max(this.clock, color.clock);
        if (newer(color, this.background) || replace) {
          this.background = color;
        }
      }
      flushSync(() => {
        if (changedPage) {
          this.api.resetScene();
          this.api.history.clear();
        }
        this.api.addFiles(Object.values(packet.files));
        this.api.updateScene({
          elements,
          appState: {
            viewBackgroundColor: this.background.color,
            whiteboardBackground: this.background.pattern ?? undefined,
            ...(this.background.pattern?.image
              ? { whiteboardCustomBackground: this.background.pattern.image }
              : {}),
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
