import { useEffect, useRef } from "react";
import { t } from "@fcboard/fcboard/i18n";
import { CloseIcon } from "@fcboard/fcboard/components/icons";

import { MaterialPanel } from "./MaterialPanel";

import type { ReactNode } from "react";

/** App-local counterpart of the vendor timer/calculator windows. No overlay permission. */
export const FloatingToolPanel = ({
  title,
  width,
  children,
  fullscreen = false,
  onClose,
}: {
  title: string;
  width: number;
  fullscreen?: boolean;
  children: ReactNode;
  onClose: () => void;
}) => {
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<
    | {
        id: number;
        x: number;
        y: number;
        left: number;
        top: number;
      }
    | undefined
  >(undefined);
  useEffect(() => {
    const element = panel.current!;
    const fit = (center = false) => {
      const rect = element.getBoundingClientRect();
      element.style.left = `${Math.max(
        8,
        Math.min(
          innerWidth - rect.width - 8,
          center ? (innerWidth - rect.width) / 2 : rect.left,
        ),
      )}px`;
      element.style.top = `${Math.max(
        8,
        Math.min(
          innerHeight - rect.height - 8,
          center ? (innerHeight - rect.height) / 2 : rect.top,
        ),
      )}px`;
    };
    fit(true);
    const resize = () => fit();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [fullscreen]);
  return (
    <MaterialPanel
      ref={panel}
      className="fc-floating-tool"
      role="dialog"
      aria-label={title}
      style={{
        position: "fixed",
        width: fullscreen
          ? "calc(100vw - 16px)"
          : `min(${width}px, calc(100vw - 16px))`,
        height: fullscreen ? "calc(100dvh - 16px)" : undefined,
        maxHeight: "calc(100dvh - 16px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 20,
        zIndex: 45,
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          onClose();
        }
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 12px",
          touchAction: "none",
          cursor: "move",
        }}
        onPointerDown={(event) => {
          if ((event.target as Element).closest("button")) {
            return;
          }
          const rect = panel.current!.getBoundingClientRect();
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: rect.left,
            top: rect.top,
          };
          event.currentTarget.setPointerCapture?.(event.pointerId);
          event.stopPropagation();
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (start?.id !== event.pointerId || !panel.current) {
            return;
          }
          const rect = panel.current.getBoundingClientRect();
          panel.current.style.left = `${Math.max(
            8,
            Math.min(
              innerWidth - rect.width - 8,
              start.left + event.clientX - start.x,
            ),
          )}px`;
          panel.current.style.top = `${Math.max(
            8,
            Math.min(
              innerHeight - rect.height - 8,
              start.top + event.clientY - start.y,
            ),
          )}px`;
        }}
        onPointerUp={() => {
          drag.current = undefined;
        }}
        onPointerCancel={() => {
          drag.current = undefined;
        }}
        onLostPointerCapture={() => {
          drag.current = undefined;
        }}
      >
        <strong>{title}</strong>
        <button
          type="button"
          aria-label={t("buttons.close")}
          onClick={onClose}
          style={{
            width: 44,
            height: 44,
            background: "transparent",
            border: 0,
            color: "inherit",
          }}
        >
          {CloseIcon}
        </button>
      </header>
      {children}
    </MaterialPanel>
  );
};
