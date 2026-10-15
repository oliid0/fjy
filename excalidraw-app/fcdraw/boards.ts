import { createStore, get, set } from "idb-keyval";

import type {
  ExcalidrawImperativeAPI,
  BinaryFiles,
  AppState,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { classroomCommands } from "./commands";

export type Board = {
  id: string;
  name: string;
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles;
  view: Pick<AppState, "scrollX" | "scrollY" | "zoom" | "viewBackgroundColor">;
  updated: number;
};
export type Workspace = { active: string; boards: Board[] };
const storage = createStore("fcdraw-boards", "workspace");
export const readWorkspace = () => get<Workspace>("workspace", storage);
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
  private disposed = false;
  constructor(
    private api: ExcalidrawImperativeAPI,
    private onError: (error: unknown) => void,
    private load = readWorkspace,
    private save = writeWorkspace,
  ) {}

  private capture(name: string, id: string = crypto.randomUUID()): Board {
    const { scrollX, scrollY, zoom, viewBackgroundColor } =
      this.api.getAppState();
    return {
      id,
      name,
      elements: this.api.getSceneElements(),
      files: this.api.getFiles(),
      view: { scrollX, scrollY, zoom, viewBackgroundColor },
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
      const first = this.capture("白板 1");
      this.value = { active: first.id, boards: [first] };
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
        (board) => board.id === this.value.active,
      );
      if (!previous) {
        return;
      }
      const current = this.capture(previous.name, previous.id);
      this.value = {
        ...this.value,
        boards: this.value.boards.map((board) =>
          board.id === current.id ? current : board,
        ),
      };
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.flush().catch(this.onError);
        }, 1200);
      }
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
  private restore(id: string) {
    const board = this.value.boards.find((item) => item.id === id);
    if (!board) {
      throw new Error("白板不存在");
    }
    this.switching = true;
    classroomCommands.invalidate();
    this.api.resetScene();
    this.api.addFiles(Object.values(board.files));
    this.api.updateScene({
      elements: board.elements,
      appState: { ...board.view, selectedElementIds: {} },
    });
    this.api.history.clear();
    this.switching = false;
  }
  async switch(id: string) {
    if (id === this.value.active) {
      return;
    }
    if (!this.value.boards.some((board) => board.id === id)) {
      throw new Error("白板不存在");
    }
    await this.flush();
    const previous = this.value;
    this.value = { ...previous, active: id };
    try {
      await this.flush();
    } catch (error) {
      this.value = previous;
      throw error;
    }
    this.restore(id);
    this.emit();
  }
  async create(name?: string) {
    await this.flush();
    const board: Board = {
      ...this.capture(
        name?.trim().slice(0, 80) || `白板 ${this.value.boards.length + 1}`,
      ),
      elements: [],
      files: {},
      view: { ...this.capture("").view, scrollX: 0, scrollY: 0 },
    };
    const previous = this.value;
    this.value = { active: board.id, boards: [...previous.boards, board] };
    try {
      await this.flush();
    } catch (error) {
      this.value = previous;
      throw error;
    }
    this.restore(board.id);
    this.emit();
  }
  async rename(id: string, name: string) {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed) {
      throw new Error("请输入白板名称");
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
  async discard(id: string) {
    await this.flush();
    if (this.value.boards.length === 1) {
      await this.create();
    }
    const previous = this.value;
    const boards = previous.boards.filter((board) => board.id !== id);
    if (boards.length === previous.boards.length) {
      throw new Error("白板不存在");
    }
    const active = previous.active === id ? boards[0].id : previous.active;
    this.value = { active, boards };
    try {
      await this.flush();
    } catch (error) {
      this.value = previous;
      throw error;
    }
    if (active !== previous.active) {
      this.restore(active);
    }
    this.emit();
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.unsubscribe?.();
  }
}
