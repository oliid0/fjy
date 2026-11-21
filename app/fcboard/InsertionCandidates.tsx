import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Paper from "@mui/material/Paper";
import ButtonBase from "@mui/material/ButtonBase";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import { t, useI18n } from "@fcboard/fcboard/i18n";

import { classroomCommands } from "./commands";
import { MagicCandidates } from "./MagicCandidates";

type CandidateRequest = {
  id: number;
  candidates: string[];
  x: number;
  y: number;
  finish: (value?: string) => void;
};

export const chooseInsertionCandidate = async (
  candidates: readonly string[],
  position: { x: number; y: number },
  signal: AbortSignal,
): Promise<string> => {
  signal.throwIfAborted();
  if (!classroomCommands.has("insertion.candidates")) {
    return candidates[0] || "";
  }
  return classroomCommands.execute({
    name: "insertion.candidates",
    args: { candidates, position, signal },
  }) as Promise<string>;
};

/** ModelManager / HFuzzyRecognitionWindow: choose from the recognizer's real alternatives. */
export const InsertionCandidates = () => {
  useI18n();
  const [requests, setRequests] = useState<CandidateRequest[]>([]);
  const request = requests[0];
  const finish = useRef<(value?: string) => void>(() => {});
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    if (!request) {
      return;
    }
    const update = () => {
      const bounds = popup.current?.getBoundingClientRect();
      const next = {
        left: Math.max(
          8,
          Math.min(request.x, innerWidth - (bounds?.width || 240) - 8),
        ),
        top: Math.max(
          8,
          Math.min(request.y, innerHeight - (bounds?.height || 64) - 8),
        ),
      };
      setPosition((previous) =>
        previous.left === next.left && previous.top === next.top
          ? previous
          : next,
      );
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);
    if (popup.current) {
      observer?.observe(popup.current);
    }
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [request]);
  useEffect(() => {
    const pending = new Map<number, CandidateRequest>();
    let sequence = 0;
    let mounted = true;
    const publish = () => {
      if (mounted) {
        setRequests([...pending.values()]);
      }
    };
    finish.current = (value) => pending.values().next().value?.finish(value);
    const cancelAll = () =>
      [...pending.values()].forEach((item) => item.finish());
    const unregister = classroomCommands.register(
      "insertion.candidates",
      "@internal",
      (args) => {
        const candidates = Array.isArray(args.candidates)
          ? [
              ...new Set(
                args.candidates.filter(
                  (value): value is string =>
                    typeof value === "string" &&
                    !!value.trim() &&
                    value.length <= 4000,
                ),
              ),
            ].slice(0, 10)
          : [];
        const position = args.position as { x: number; y: number } | undefined;
        const signal = args.signal;
        if (
          !candidates.length ||
          !(signal instanceof AbortSignal) ||
          !position ||
          ![position.x, position.y].every(Number.isFinite)
        ) {
          throw new Error("Invalid handwriting candidates");
        }
        signal.throwIfAborted();
        if (pending.size >= 8) {
          throw new Error(t("fcboard.local_queue_full"));
        }
        return new Promise<string>((resolve, reject) => {
          const id = ++sequence;
          const abort = () => complete();
          const complete = (value?: string) => {
            if (!pending.delete(id)) {
              return;
            }
            signal.removeEventListener("abort", abort);
            publish();
            if (value !== undefined && candidates.includes(value)) {
              resolve(value);
            } else {
              reject(
                new DOMException("Handwriting input cancelled", "AbortError"),
              );
            }
          };
          pending.set(id, {
            id,
            candidates,
            x: position.x,
            y: position.y,
            finish: complete,
          });
          signal.addEventListener("abort", abort, { once: true });
          publish();
        });
      },
    );
    const invalidate = classroomCommands.onInvalidate(cancelAll);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        finish.current();
      }
    };
    window.addEventListener("keydown", key);
    const toolbar = cancelAll;
    window.addEventListener("fcboard:toolbar-action", toolbar);
    return () => {
      mounted = false;
      cancelAll();
      finish.current = () => {};
      unregister();
      invalidate();
      window.removeEventListener("keydown", key);
      window.removeEventListener("fcboard:toolbar-action", toolbar);
    };
  }, []);
  return (
    <>
      <MagicCandidates />
      {request &&
        createPortal(
          <ClickAwayListener onClickAway={() => finish.current()}>
            <Paper
              ref={popup}
              data-insertion-candidates
              role="toolbar"
              aria-label={t("fcboard.handwriting_recognition")}
              onPointerDown={(event) => event.stopPropagation()}
              style={position}
              sx={{
                position: "fixed",
                zIndex: 1700,
                pointerEvents: "auto",
                touchAction: "manipulation",
                display: "flex",
                gap: "4px",
                padding: "7px",
                borderRadius: "5px",
                bgcolor: "rgba(255,255,255,.96)",
                boxShadow: "0 2px 12px #0002",
                maxWidth: "calc(100vw - 16px)",
                maxHeight: "calc(100vh - 16px)",
                overflow: "auto",
              }}
            >
              <div style={{ display: "flex", overflowX: "auto" }}>
                {request.candidates.map((candidate) => (
                  <ButtonBase
                    key={candidate}
                    onClick={() => request.finish(candidate)}
                    sx={{
                      padding: "6px 14px",
                      whiteSpace: "nowrap",
                      fontSize: "15px",
                      color: "#333",
                    }}
                  >
                    {candidate}
                  </ButtonBase>
                ))}
              </div>
              <ButtonBase
                aria-label={t("buttons.cancel")}
                onClick={() => request.finish()}
                sx={{ padding: "6px 10px", color: "#777" }}
              >
                ×
              </ButtonBase>
            </Paper>
          </ClickAwayListener>,
          document.body,
        )}
    </>
  );
};
