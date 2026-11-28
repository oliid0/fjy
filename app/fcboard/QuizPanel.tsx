import { useCallback, useEffect, useRef } from "react";
import { Button, CircularProgress, IconButton } from "@mui/material";
import { t } from "@fcboard/fcboard/i18n";

import { MaterialPanel } from "./MaterialPanel";
import { quizDocument, quizUpdate } from "./quiz";

import type { Quiz } from "./quiz";

export const QuizPanel = ({
  quiz,
  busy,
  error,
  onClose,
  onRetryImage,
  open = true,
}: {
  open?: boolean;
  quiz: Quiz | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onRetryImage?: (id: string) => void;
}) => {
  const iframe = useRef<HTMLIFrameElement>(null);
  const documentValue = useRef({ identity: "", channel: "", html: "" });
  const sent = useRef<Quiz | undefined>(undefined);
  const identity = quiz?.id || quiz?.title || "";
  if (quiz && documentValue.current.identity !== identity) {
    const channel = crypto.randomUUID();
    documentValue.current = {
      identity,
      channel,
      html: quizDocument(quiz, channel),
    };
    sent.current = undefined;
  }
  const sync = useCallback(
    (full = false) => {
      if (quiz) {
        iframe.current?.contentWindow?.postMessage(
          {
            type: "quiz-progress",
            channel: documentValue.current.channel,
            ...quizUpdate(quiz, full ? undefined : sent.current),
          },
          "*",
        );
        sent.current = quiz;
      }
    },
    [quiz],
  );
  useEffect(() => sync(), [sync]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source === iframe.current?.contentWindow &&
        event.data?.type === "quiz-retry-image" &&
        event.data.channel === documentValue.current.channel &&
        typeof event.data.id === "string"
      ) {
        onRetryImage?.(event.data.id);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onRetryImage]);
  return (
    <MaterialPanel
      centered
      open={open}
      keepMounted
      onDismiss={onClose}
      aria-label={t("fcboard.quizForm.results")}
      className="fc-quiz-panel"
      style={{
        width: "min(760px, calc(100vw - 32px))",
        height: "min(680px, calc(100dvh - 40px))",
        borderRadius: 24,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        padding: 0,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          gap: 12,
        }}
      >
        <strong>{t("fcboard.quizForm.results")}</strong>
        {busy && quiz && (
          <span role="status">
            <CircularProgress size={16} />{" "}
            {t("fcboard.quizForm.generatingCount", {
              ready: quiz.questions.length,
              total: quiz.plannedCount || quiz.questions.length,
            })}
          </span>
        )}
        <IconButton
          aria-label={t("buttons.close")}
          onClick={onClose}
          sx={{ marginLeft: "auto", flexShrink: 0, color: "inherit" }}
        >
          <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24">
            <path
              d="m6 6 12 12M18 6 6 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </IconButton>
      </div>
      {error && (
        <p role="alert" style={{ padding: 24 }}>
          {error}
        </p>
      )}
      {quiz ? (
        <iframe
          ref={iframe}
          title={quiz.title}
          srcDoc={documentValue.current.html}
          onLoad={() => sync(true)}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          style={{ flex: 1, width: "100%", border: 0, minHeight: 0 }}
        />
      ) : busy ? (
        <div
          role="status"
          style={{
            flex: 1,
            display: "grid",
            placeContent: "center",
            justifyItems: "center",
            gap: 16,
          }}
        >
          <CircularProgress />
          <span>{t("fcboard.quiz_generating")}</span>
          <Button onClick={onClose}>{t("buttons.cancel")}</Button>
        </div>
      ) : null}
    </MaterialPanel>
  );
};
