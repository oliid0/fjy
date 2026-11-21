import { Capacitor, registerPlugin } from "@capacitor/core";

export type SplitContact = {
  owner: string;
  id: string;
  token: string;
  phase: "start" | "move" | "end" | "cancel";
  mode: "pen" | "erase";
  width: number;
  height: number;
  points: [number, number, number][];
};
export type SplitStyle = {
  color: string;
  width: number;
  eraser: number;
  disabled: boolean;
};
const input = registerPlugin<{
  configure(options: Record<string, unknown>): Promise<void>;
  checkpoint(): Promise<void>;
  restore(options: {
    owner: string;
    token: string;
    bitmap: string;
  }): Promise<void>;
  remove(options: { owner: string }): Promise<void>;
  acknowledge(options: {
    owner: string;
    id: string;
    complete?: boolean;
  }): Promise<void>;
  addListener(
    event: "contact",
    listener: (contact: SplitContact) => void,
  ): Promise<{ remove(): Promise<void> }>;
}>("FcboardNativeInk");

/** Persistent native split ink shares the main-board pen, eraser and pointer
 * router. The web canvas stays current for export/fallback. Only lifecycle
 * changes send a snapshot; writing/erasure pixels never wait for a bridge reply. */
export const createNativeSplitInk = (
  canvas: HTMLCanvasElement,
  style: () => SplitStyle,
  contact: (event: SplitContact, style: SplitStyle, bounds: DOMRect) => void,
) => {
  if (Capacitor.getPlatform() !== "android") {
    return;
  }
  const owner = `split-${crypto.randomUUID()}`;
  let alive = true;
  let failed = false;
  let busy = false;
  let queued = false;
  let version = 1;
  let installed = 0;
  let revision = 0;
  let viewport = "";
  let signature = "";
  let currentToken = "";
  const tokens = new Map<string, { style: SplitStyle; bounds: DOMRect }>();
  const activeTokens = new Map<string, string>();
  const retireTokens = () => {
    const retained = new Set(activeTokens.values());
    retained.add(currentToken);
    for (const token of tokens.keys()) {
      if (!retained.has(token)) {
        tokens.delete(token);
      }
    }
  };
  const fail = (error: unknown) => {
    if (!alive || failed) {
      return;
    }
    failed = true;
    canvas.style.opacity = "";
    void input.remove({ owner }).catch(() => {});
    console.error("Native split ink unavailable", error);
  };
  const flush = async () => {
    if (!alive || failed || busy) {
      return;
    }
    busy = true;
    const restoreVersion = version;
    try {
      // Input must not hide the fallback until its contact listener is ready.
      await listener;
      if (!alive || failed) {
        return;
      }
      const bounds = canvas.getBoundingClientRect();
      if (!(bounds.width > 0 && bounds.height > 0)) {
        return;
      }
      const settings = style();
      const nextViewport = JSON.stringify([
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        innerWidth,
        devicePixelRatio,
      ]);
      const blocked = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".fc-split-board button,.fc-split-resize",
        ),
      )
        .filter((node) => node.getClientRects().length)
        .map((node) => {
          const box = node.getBoundingClientRect();
          return [box.left, box.top, box.right, box.bottom];
        });
      const nextSignature = JSON.stringify([nextViewport, settings, blocked]);
      const restoring =
        installed !== restoreVersion || viewport !== nextViewport;
      if (!restoring && signature === nextSignature) {
        return;
      }
      const token = `${owner}:${++revision}`;
      tokens.set(token, { style: settings, bounds });
      const options = {
        owner,
        token,
        persistent: true,
        enabled: !settings.disabled,
        multiStroke: true,
        shortcutsEnabled: false,
        mode: settings.eraser ? "erase" : "pen",
        eraserMode: "stroke",
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
        viewportWidth: innerWidth,
        penWidth: settings.width,
        unit: 1,
        opacity: 1,
        color: settings.color,
        dashed: false,
        palm: 36,
        palmEnabled: true,
        eraserSize: settings.eraser || 60,
        blocked,
      };
      if (restoring) {
        await input.configure({ ...options, enabled: false });
        if (!alive || failed) {
          return;
        }
        // Notifications already queued by the previous native gesture precede
        // this barrier, so the exported snapshot includes the last completed ink.
        await input.checkpoint();
        if (!alive || failed) {
          return;
        }
        await input.restore({
          owner,
          token,
          bitmap: canvas.toDataURL("image/png"),
        });
      }
      if (!alive || failed) {
        return;
      }
      await input.configure(options);
      if (!alive || failed) {
        return;
      }
      currentToken = token;
      // configure cancels previous-token contacts. Drain their notifications
      // before releasing the style/bounds needed to mirror cancellation.
      await input.checkpoint();
      if (!alive || failed) {
        return;
      }
      retireTokens();
      viewport = nextViewport;
      signature = nextSignature;
      installed = restoreVersion;
      canvas.style.opacity = "0";
    } catch (error) {
      fail(error);
    } finally {
      busy = false;
      if (alive && !failed && (queued || version !== restoreVersion)) {
        queued = false;
        schedule();
      }
    }
  };
  const schedule = () => {
    if (!alive || failed) {
      return;
    }
    if (busy) {
      queued = true;
      return;
    }
    if (!queued) {
      queued = true;
      queueMicrotask(() => {
        queued = false;
        void flush();
      });
    }
  };
  const listener = input
    .addListener("contact", (event) => {
      if (!alive || event.owner !== owner) {
        return;
      }
      const source = tokens.get(event.token);
      if (source) {
        if (event.phase === "start") {
          activeTokens.set(event.id, event.token);
        }
        contact(event, source.style, source.bounds);
        if (event.phase === "end" || event.phase === "cancel") {
          activeTokens.delete(event.id);
          if (!busy) {
            retireTokens();
          }
        }
      }
      if (
        event.phase === "start" ||
        event.phase === "move" ||
        event.phase === "end"
      ) {
        void input
          .acknowledge({ owner, id: event.id, complete: event.phase === "end" })
          .catch(fail);
      }
    })
    .catch((error) => {
      fail(error);
      return undefined;
    });
  const observer = new MutationObserver(schedule);
  observer.observe(canvas.closest(".fc-split-board") || canvas.parentElement!, {
    attributes: true,
    childList: true,
    subtree: true,
  });
  addEventListener("resize", schedule);
  addEventListener("scroll", schedule, true);
  schedule();
  return {
    update: schedule,
    restore() {
      version++;
      schedule();
    },
    dispose() {
      alive = false;
      tokens.clear();
      activeTokens.clear();
      observer.disconnect();
      removeEventListener("resize", schedule);
      removeEventListener("scroll", schedule, true);
      canvas.style.opacity = "";
      void listener.then((handle) => handle?.remove()).catch(() => {});
      void input.remove({ owner }).catch(() => {});
    },
  };
};
