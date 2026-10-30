import type { InkStroke } from "./documents";
import type { SharedDocumentView } from "./sceneSync";

/** Private live-view bridge; files and callbacks never enter the AI context. */
export type SharedDocumentSource = {
  id: string;
  file: File;
  page: number;
  ready: boolean;
  ink: InkStroke[];
  draft?: string;
  view: SharedDocumentView;
  present(view: SharedDocumentView): void;
  apply(ink: InkStroke[], reset: boolean): void;
  navigate(page: number): Promise<void>;
  close(): Promise<void>;
};

let source: (() => SharedDocumentSource) | undefined;
const listeners = new Set<() => void>();
let following = false;
export const documentSharing = {
  current: () => source?.(),
  get following() {
    return following;
  },
  follow(value: boolean) {
    if (following === value) {
      return;
    }
    following = value;
    this.changed();
  },
  attach(read: () => SharedDocumentSource) {
    source = read;
    this.changed();
    return () => {
      if (source === read) {
        source = undefined;
        this.changed();
      }
    };
  },
  changed() {
    listeners.forEach((listener) => listener());
  },
  watch(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
