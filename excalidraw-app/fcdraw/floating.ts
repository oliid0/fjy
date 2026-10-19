import { useLayoutEffect, useState } from "react";

import type { CSSProperties, RefObject } from "react";

export type PanelRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** Anchor surfaces to their real trigger, including after toolbar scroll and resize. */
export const useAnchoredPanel = (
  ref: RefObject<HTMLElement | null>,
  selector: string,
  open: boolean,
) => {
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open || !ref.current) {
      return;
    }
    const panel = ref.current;
    const update = () => {
      const anchor = Array.from(
        document.querySelectorAll<HTMLElement>(selector),
      ).find((el) => el.getBoundingClientRect().height);
      const parent = panel.offsetParent?.getBoundingClientRect();
      if (!anchor || !parent) {
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const toolbar = anchor
        .closest("[role='toolbar'], .fc-presentation-toolbar")
        ?.getBoundingClientRect();
      const availableHeight = (toolbar?.top ?? rect.top) - parent.top - 12;
      const placement = placePanel(
        {
          left: rect.left - parent.left,
          right: rect.right - parent.left,
          top: rect.top - parent.top,
          bottom: rect.bottom - parent.top,
        },
        { width: parent.width, height: parent.height },
        panel.getBoundingClientRect().width,
        Math.min(panel.scrollHeight, availableHeight - 12),
        "above",
      );
      const next = {
        ...placement,
        right: "auto",
        bottom: "auto",
        maxHeight: Math.max(100, availableHeight - 12),
      };
      setStyle((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);
    observer?.observe(panel);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, ref, selector]);
  return style;
};

/** Prefer the side of content; never choose a side that covers content when space exists. */
export const placePanel = (
  anchor: PanelRect,
  viewport: { width: number; height: number },
  width = 280,
  height = 340,
  side: "side" | "above" = "side",
) => {
  const gap = 12;
  const w = Math.min(width, viewport.width - gap * 2);
  const h = Math.min(height, viewport.height - gap * 2);
  const candidates = [
    { left: anchor.right + gap, top: anchor.top },
    { left: anchor.left - gap - w, top: anchor.top },
    { left: anchor.left, top: anchor.top - gap - h },
    { left: anchor.left, top: anchor.bottom + gap },
  ];
  const order = side === "above" ? [2, 0, 1, 3] : [0, 1, 2, 3];
  if (side === "above") {
    candidates[2].left = Math.max(
      gap,
      Math.min(viewport.width - w - gap, anchor.left),
    );
  }
  const next =
    order
      .map((i) => candidates[i])
      .find(
        (p) =>
          p.left >= gap &&
          p.left + w <= viewport.width - gap &&
          p.top >= gap &&
          p.top + h <= viewport.height - gap,
      ) ||
    candidates[
      order.find((i) => {
        const p = candidates[i];
        return p.left >= gap && p.left + w <= viewport.width - gap;
      }) ?? 2
    ];
  return {
    left: Math.max(gap, Math.min(viewport.width - w - gap, next.left)),
    top: Math.max(gap, Math.min(viewport.height - h - gap, next.top)),
    width: w,
    maxHeight: viewport.height - gap * 2,
  };
};
