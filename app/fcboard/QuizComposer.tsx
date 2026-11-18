import { useState } from "react";
import { IconButton } from "@mui/material";
import { CloseIcon } from "@fcboard/fcboard/components/icons";
import { t, useI18n } from "@fcboard/fcboard/i18n";

import { MaterialPanel } from "./MaterialPanel";
import { quizTypes } from "./quiz";

import "./QuizComposer.scss";

import type { QuizQuestion } from "./quiz";

export const QuizComposer = ({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (prompt: string, type?: QuizQuestion["type"]) => void;
}) => {
  useI18n();
  const [grade, setGrade] = useState("any");
  const [type, setType] = useState<QuizQuestion["type"] | "mixed">("mixed");
  const [difficulty, setDifficulty] = useState("medium");
  const [supplement, setSupplement] = useState("");
  return (
    <MaterialPanel
      centered
      open={open}
      keepMounted
      onDismiss={onClose}
      aria-label={t("fcboard.quizForm.title")}
      className="fc-quiz-composer"
    >
      <header>
        <strong>{t("fcboard.quizForm.title")}</strong>
        <IconButton aria-label={t("buttons.close")} onClick={onClose}>
          {CloseIcon}
        </IconButton>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const prompt = [
            "Generate a quiz using the following requirements and the supplied board/selection context.",
            `Grade: ${
              grade === "any"
                ? "appropriate to the supplied content"
                : grade === "higher"
                ? "higher education"
                : `Grade ${grade}`
            }.`,
            `Question type: ${
              type === "mixed" ? "a suitable mixture" : `only ${type}`
            }.`,
            `Difficulty: ${difficulty}.`,
            ...(supplement.trim()
              ? [
                  `Additional requirements (subject, knowledge points, quantity or other instructions):\n${supplement.trim()}`,
                ]
              : []),
          ].join("\n");
          onSubmit(prompt, type === "mixed" ? undefined : type);
        }}
      >
        <div className="fc-quiz-fields">
          <label>
            {t("fcboard.quizForm.grade")}
            <select
              value={grade}
              onChange={(event) => setGrade(event.target.value)}
            >
              <option value="any">{t("fcboard.quizForm.gradeAny")}</option>
              {Array.from({ length: 12 }, (_, index) => String(index + 1)).map(
                (value) => (
                  <option key={value} value={value}>
                    {t("fcboard.quizForm.gradeNumber", { grade: value })}
                  </option>
                ),
              )}
              <option value="higher">
                {t("fcboard.quizForm.gradeHigher")}
              </option>
            </select>
          </label>
          <label>
            {t("fcboard.quizForm.type")}
            <select
              value={type}
              onChange={(event) => setType(event.target.value as typeof type)}
            >
              <option value="mixed">{t("fcboard.quizForm.mixed")}</option>
              {quizTypes.map((value) => (
                <option key={value} value={value}>
                  {t(`fcboard.aiMessages.quizType_${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("fcboard.quizForm.difficulty")}
            <select
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value)}
            >
              {(["easy", "medium", "hard"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`fcboard.quizForm.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="fc-quiz-supplement">
            {t("fcboard.quizForm.supplement")}
            <textarea
              value={supplement}
              onChange={(event) => setSupplement(event.target.value)}
              maxLength={4000}
              rows={5}
              placeholder={t("fcboard.quizForm.placeholder")}
            />
          </label>
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            {t("buttons.cancel")}
          </button>
          <button type="submit" className="fc-primary">
            {t("fcboard.quizForm.generate")}
          </button>
        </footer>
      </form>
    </MaterialPanel>
  );
};
