import { useMemo } from "react";
import { Button, CircularProgress, IconButton } from "@mui/material";
import { t } from "@fcboard/fcboard/i18n";
import { CloseIcon } from "@fcboard/fcboard/components/icons";

import { MaterialPanel } from "./MaterialPanel";
import { quizDocument } from "./quiz";

import type { Quiz } from "./quiz";

export const QuizPanel = ({
  quiz,
  busy,
  error,
  onClose,
  open = true,
}: {
  open?: boolean;
  quiz: Quiz | null;
  busy: boolean;
  error: string;
  onClose: () => void;
}) => {
  const html = useMemo(() => (quiz ? quizDocument(quiz) : ""), [quiz]);
  return (
    <MaterialPanel
      centered
      open={open}
      keepMounted
      onDismiss={onClose}
      aria-label={t("fcboard.ai_questions")}
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
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
        }}
      >
        <strong>{t("fcboard.ai_questions")}</strong>
        <IconButton aria-label={t("buttons.close")} onClick={onClose}>
          {CloseIcon}
        </IconButton>
      </div>
      {busy ? (
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
      ) : error ? (
        <p role="alert" style={{ padding: 24 }}>
          {error}
        </p>
      ) : quiz ? (
        <iframe
          title={quiz.title}
          srcDoc={html}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          style={{ flex: 1, width: "100%", border: 0, minHeight: 0 }}
        />
      ) : null}
    </MaterialPanel>
  );
};
