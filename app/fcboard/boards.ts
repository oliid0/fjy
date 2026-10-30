import { createStore, get, set } from "idb-keyval";
import { canvasStrokeColor } from "@fcboard/common";
import { t } from "@fcboard/fcboard/i18n";
import { validBackgroundImage } from "@fcboard/fcboard/whiteboardBackground";

import type {
  FcboardImperativeAPI,
  BinaryFiles,
  AppState,
} from "@fcboard/fcboard/types";
import type { FcboardElement } from "@fcboard/element/types";

import { classroomCommands } from "./commands";

export type Board = {
  id: string;
  name: string;
  elements: readonly FcboardElement[];
  files: BinaryFiles;
  view: Pick<
    AppState,
    | "scrollX"
    | "scrollY"
    | "zoom"
    | "viewBackgroundColor"
    | "whiteboardBackground"
    | "whiteboardCustomBackground"
  >;
  updated: number;
};
export type Workspace = {
  active: string;
  boards: Board[];
  // NewSlideBackgroundView: page-local custom image first, HDataSet fallback.
  customBackground?: AppState["whiteboardCustomBackground"];
};
const storage = createStore("fcboard-boards", "workspace");
export const readWorkspace = async () => get<Workspace>("workspace", storage);
export const writeWorkspace = (value: Workspace) =>
  set("workspace", value, storage);

/** Save before switching, keep binary assets, and keep undo from crossing boards. */
export class BoardBook {
  value: Workspace = { active: "", boards: [] };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe?: () => void;
  private listeners = new Set<() => void>();
  private writing: Promise<void> = Promise.resolve();
  private switching = false;
  private pendingActive?: string;
  private disposed = false;
  get visibleActive() {
    return this.pendingActive ?? this.value.active;
  }
  constructor(
    private api: FcboardImperativeAPI,
    private onError: (error: unknown) => void,
    private load = readWorkspace,
    private save = writeWorkspace,
  ) {}

  private capture(name: string, id: string = crypto.randomUUID()): Board {
    const {
      scrollX,
      scrollY,
      zoom,
      viewBackgroundColor,
      whiteboardBackground,
      whiteboardCustomBackground,
    } = this.api.getAppState();
    return {
      id,
      name,
      elements: this.api.getSceneElements(),
      files: this.api.getFiles(),
      view: {
        scrollX,
        scrollY,
        zoom,
        viewBackgroundColor,
        whiteboardBackground,
        whiteboardCustomBackground,
      },
      updated: Date.now(),
    };
  }
  async initialize() {
    const stored = await this.load();
    if (this.disposed) {
      return;
    }
    if (
      stored?.boards.length &&
      stored.boards.some((board) => board.id === stored.active)
    ) {
      this.value = stored;
      this.restore(stored.active);
    } else {
      const first = this.capture(`${t("fcboard.board")} 1`);
      this.value = {
        active: first.id,
        boards: [first],
        customBackground: first.view.whiteboardCustomBackground,
      };
      await this.flush();
    }
    if (this.disposed) {
      return;
    }
    this.unsubscribe = this.api.onChange(() => {
      if (this.switching) {
        return;
      }
      const previous = this.value.boards.find(
        (board) => board.id === this.visibleActive,
      );
      if (!previous) {
        return;
      }
      const current = this.capture(previous.name, previous.id);
      const custom = current.view.whiteboardCustomBackground;
      const choseCustom =
        custom !==
          (previous.view.whiteboardCustomBackground ??
            this.value.customBackground) ||
        (current.view.whiteboardBackground?.pattern === 14 &&
          current.view.whiteboardBackground.image === custom &&
          previous.view.whiteboardBackground?.image !== custom);
      if (!choseCustom) {
        // A preview fallback is not a page-local image until it is applied.
        current.view.whiteboardCustomBackground =
          previous.view.whiteboardCustomBackground;
      }
      this.value = {
        ...this.value,
        customBackground:
          choseCustom && validBackgroundImage(custom)
            ? custom
            : this.value.customBackground,
        boards: this.value.boards.map((board) =>
          board.id === current.id ? current : board,
        ),
      };
      // Saving serializes every page. Wait for an idle gap instead of cloning
      // the workspace in the middle of a long pen or eraser gesture.
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush().catch(this.onError);
      }, 1200);
    });
    this.emit();
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit() {
    this.listeners.forEach((listener) => listener());
  }
  async flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    // Clone now: live element mutations must not change an in-flight persistence operation.
    const snapshot = JSON.parse(JSON.stringify(this.value)) as Workspace;
    this.writing = this.writing.catch(() => {}).then(() => this.save(snapshot));
    await this.writing;
  }
  private restore(id: string, source?: AbortSignal) {
    const board = this.value.boards.find((item) => item.id === id);
    if (!board) {
      throw new Error(t("fcboard.board_does_not_exist"));
    }
    source?.throwIfAborted();
    this.switching = true;
    const previousState = this.api.getAppState();
    classroomCommands.invalidate(source);
    this.api.resetScene();
    this.api.addFiles(Object.values(board.files));
    this.api.updateScene({
      elements: board.elements,
      appState: {
        ...board.view,
        whiteboardBackground: board.view.whiteboardBackground,
        whiteboardCustomBackground: validBackgroundImage(
          board.view.whiteboardCustomBackground,
        )
          ? board.view.whiteboardCustomBackground
          : validBackgroundImage(this.value.customBackground)
          ? this.value.customBackground
          : undefined,
        selectedElementIds: {},
        currentItemStrokeColor: canvasStrokeColor(
          board.view.viewBackgroundColor,
          previousState.currentItemStrokeColor,
          previousState.viewBackgroundColor,
        ),
      },
    });
    this.api.history.clear();
    this.switching = false;
  }
  /** Persist the destination while in-flight edits still belong to the visible source page. */
  private async commitWorkspace(next: Workspace, source?: AbortSignal) {
    const previous = this.value;
    this.pendingActive = previous.active;
    this.value = next;
    try {
      await this.flush();
      source?.throwIfAborted();
    } catch (error) {
      if (this.value.active === next.active) {
        const current = this.value;
        this.value =
          current === next
            ? previous
            : {
                ...previous,
                boards: previous.boards.map(
                  (board) =>
                    current.boards.find((item) => item.id === board.id) ??
                    board,
                ),
              };
        if (source?.aborted) {
          await this.flush();
        }
      }
      throw error;
    } finally {
      this.pendingActive = undefined;
    }
  }
  async switch(id: string, source?: AbortSignal) {
    source?.throwIfAborted();
    if (id === this.value.active) {
      return;
    }
    if (!this.value.boards.some((board) => board.id === id)) {
      throw new Error(t("fcboard.board_does_not_exist"));
    }
    await this.flush();
    source?.throwIfAborted();
    const previous = this.value;
    const next = { ...previous, active: id };
    await this.commitWorkspace(next, source);
    this.restore(id, source);
    this.emit();
  }
  async create(name?: string, source?: AbortSignal) {
    source?.throwIfAborted();
    await this.flush();
    source?.throwIfAborted();
    const board: Board = {
      ...this.capture(
        name?.trim().slice(0, 80) ||
          `${t("fcboard.board")} ${this.value.boards.length + 1}`,
      ),
      elements: [],
      files: {},
      view: {
        ...this.capture("").view,
        whiteboardCustomBackground: this.value.boards.find(
          (item) => item.id === this.value.active,
        )?.view.whiteboardCustomBackground,
        scrollX: 0,
        scrollY: 0,
      },
    };
    const previous = this.value;
    const next = {
      ...previous,
      active: board.id,
      boards: [...previous.boards, board],
    };
    await this.commitWorkspace(next, source);
    this.restore(board.id, source);
    this.emit();
  }
  async importPages(pages: Board[], source?: AbortSignal) {
    source?.throwIfAborted();
    if (!pages.length || pages.length > 100) {
      throw new Error("Invalid board pages");
    }
    await this.flush();
    source?.throwIfAborted();
    const previous = this.value;
    const imported = pages.map((page) => ({
      ...page,
      id: crypto.randomUUID(),
    }));
    const next = {
      ...previous,
      active: imported[0].id,
      boards: [...previous.boards, ...imported],
    };
    await this.commitWorkspace(next, source);
    this.restore(next.active, source);
    this.emit();
  }
  async rename(id: string, name: string) {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed) {
      throw new Error(t("fcboard.enter_a_board_name"));
    }
    const previous = this.value;
    this.value = {
      ...previous,
      boards: previous.boards.map((board) =>
        board.id === id ? { ...board, name: trimmed } : board,
      ),
    };
    try {
      await this.flush();
    } catch (error) {
      this.value = previous;
      throw error;
    }
    this.emit();
  }
  async discard(id: string, source?: AbortSignal) {
    source?.throwIfAborted();
    if (!this.value.boards.some((board) => board.id === id)) {
      throw new Error(t("fcboard.board_does_not_exist"));
    }
    await this.flush();
    source?.throwIfAborted();
    if (this.value.boards.length === 1) {
      await this.create(undefined, source);
    }
    source?.throwIfAborted();
    const previous = this.value;
    const boards = previous.boards.filter((board) => board.id !== id);
    if (boards.length === previous.boards.length) {
      throw new Error(t("fcboard.board_does_not_exist"));
    }
    const active = previous.active === id ? boards[0].id : previous.active;
    const next = { ...previous, active, boards };
    await this.commitWorkspace(next, source);
    if (active !== previous.active) {
      this.restore(active, source);
    }
    this.emit();
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.unsubscribe?.();
  }
}
