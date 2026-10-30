import { useEffect, useRef, useState } from "react";
import Paper from "@mui/material/Paper";
import ButtonBase from "@mui/material/ButtonBase";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import { t, useI18n } from "@fcboard/fcboard/i18n";

import { classroomCommands } from "./commands";

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
  const [request, setRequest] = useState<{
    candidates: string[];
    x: number;
    y: number;
  }>();
  const finish = useRef<(value?: string) => void>(() => {});
  useEffect(() => {
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
        finish.current();
        return new Promise<string>((resolve, reject) => {
          const abort = () => finish.current();
          const complete = (value?: string) => {
            signal.removeEventListener("abort", abort);
            finish.current = () => {};
            setRequest(undefined);
            if (value !== undefined && candidates.includes(value)) {
              resolve(value);
            } else {
              reject(
                new DOMException("Handwriting input cancelled", "AbortError"),
              );
            }
          };
          finish.current = complete;
          signal.addEventListener("abort", abort, { once: true });
          setRequest({ candidates, x: position.x, y: position.y });
        });
      },
    );
    const invalidate = classroomCommands.onInvalidate(() => finish.current());
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        finish.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      finish.current();
      unregister();
      invalidate();
      window.removeEventListener("keydown", key);
    };
  }, []);
  if (!request) {
    return null;
  }
  const left = Math.max(8, Math.min(request.x, window.innerWidth - 240));
  return (
    <ClickAwayListener onClickAway={() => finish.current()}>
      <Paper
        data-insertion-candidates
        role="toolbar"
        aria-label={t("fcboard.handwriting_recognition")}
        onPointerDown={(event) => event.stopPropagation()}
        sx={{
          position: "fixed",
          zIndex: 1700,
          left,
          top: Math.max(8, Math.min(request.y, window.innerHeight - 64)),
          display: "flex",
          gap: "4px",
          padding: "7px",
          borderRadius: "5px",
          bgcolor: "rgba(255,255,255,.96)",
          boxShadow: "0 2px 12px #0002",
          maxWidth: `calc(100vw - ${left + 8}px)`,
        }}
      >
        <div style={{ display: "flex", overflowX: "auto" }}>
          {request.candidates.map((candidate) => (
            <ButtonBase
              key={candidate}
              onClick={() => finish.current(candidate)}
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
          onClick={() => finish.current()}
          sx={{ padding: "6px 10px", color: "#777" }}
        >
          ×
        </ButtonBase>
      </Paper>
    </ClickAwayListener>
  );
};
