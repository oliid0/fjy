import { Capacitor } from "@capacitor/core";

const savedExitKey = "fcboard-saved-exit";
let restore: boolean | undefined;

export const isNativeBoardSession = () => Capacitor.getPlatform() === "android";

/** Consume saved-exit intent once per document. Task removal, process death
 * and ordinary exits have no such intent, so old scratch ink is never loaded. */
export const shouldRestoreBoardSession = () => {
  if (!isNativeBoardSession()) {
    return true;
  }
  if (restore === undefined) {
    restore = false;
    try {
      const saved = localStorage.getItem(savedExitKey) === "1";
      localStorage.removeItem(savedExitKey);
      restore = saved;
    } catch {
      // A blocked store must still open a fresh writable board.
    }
  }
  return restore;
};

export const markSavedBoardExit = () => {
  if (isNativeBoardSession()) {
    localStorage.setItem(savedExitKey, "1");
  }
};

export const invalidateSavedBoardExit = () => {
  if (isNativeBoardSession()) {
    try {
      localStorage.removeItem(savedExitKey);
    } catch {
      // Reading an inaccessible store also defaults to a fresh board.
    }
  }
};
