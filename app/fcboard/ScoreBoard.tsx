import { useState } from "react";
import { t, useI18n } from "@fcboard/fcboard/i18n";
import { pencilIcon } from "@fcboard/fcboard/components/icons";

import { MaterialPanel } from "./MaterialPanel";

import "./OriginalResourceTools.scss";

/** ScoreBoardWindow and dialog_score_name_edit: each opening starts a new game. */
export const ScoreBoard = ({ onClose }: { onClose: () => void }) => {
  useI18n();
  const [groups, setGroups] = useState(() => [
    { name: t("fcboard.scoreBoard.group1"), score: 1 },
    { name: t("fcboard.scoreBoard.group2"), score: 2 },
    { name: t("fcboard.scoreBoard.group3"), score: 1 },
  ]);
  const [editing, setEditing] = useState<{ index: number; name: string }>();
  const updateScore = (index: number, delta: number) =>
    setGroups((current) =>
      current.map((group, i) =>
        i === index ? { ...group, score: group.score + delta } : group,
      ),
    );
  return (
    <>
      <MaterialPanel
        centered
        className="fc-original-resource-tool fc-score-board"
        role="dialog"
        aria-label={t("fcboard.scoreBoard.title")}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape" && !editing) {
            onClose();
          }
        }}
      >
        <header>
          <strong>{t("fcboard.scoreBoard.title")}</strong>
          <button aria-label={t("buttons.close")} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="fc-score-groups">
          {groups.map((group, index) => (
            <div className="fc-score-group-slot" key={index}>
              {index > 0 && (
                <span className="fc-score-separator" aria-hidden="true">
                  {":\n:"}
                </span>
              )}
              <section className="fc-score-group" aria-label={group.name}>
                <div className="fc-score-group-heading">
                  <strong>{group.name}</strong>
                  <button
                    aria-label={t("fcboard.scoreBoard.editNameFor", {
                      name: group.name,
                    })}
                    onClick={() => setEditing({ index, name: group.name })}
                  >
                    {pencilIcon}
                  </button>
                </div>
                <output aria-live="polite">{group.score}</output>
                <div className="fc-score-buttons">
                  <button
                    aria-label={t("fcboard.scoreBoard.decrease", {
                      name: group.name,
                    })}
                    onClick={() => updateScore(index, -1)}
                  >
                    -
                  </button>
                  <button
                    aria-label={t("fcboard.scoreBoard.increase", {
                      name: group.name,
                    })}
                    onClick={() => updateScore(index, 1)}
                  >
                    +
                  </button>
                </div>
              </section>
            </div>
          ))}
        </div>
      </MaterialPanel>
      {editing && (
        <MaterialPanel
          centered
          className="fc-original-resource-tool fc-score-name-editor"
          role="dialog"
          aria-label={t("fcboard.scoreBoard.editName")}
          onDismiss={() => setEditing(undefined)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              setEditing(undefined);
            }
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setGroups((current) =>
                current.map((group, index) =>
                  index === editing.index
                    ? { ...group, name: editing.name }
                    : group,
                ),
              );
              setEditing(undefined);
            }}
          >
            <strong>{t("fcboard.scoreBoard.editName")}</strong>
            <input
              autoFocus
              aria-label={t("fcboard.scoreBoard.editName")}
              value={editing.name}
              onFocus={(event) => {
                const input = event.currentTarget;
                input.setSelectionRange(input.value.length, input.value.length);
              }}
              onChange={(event) =>
                setEditing({ ...editing, name: event.target.value })
              }
            />
            <footer>
              <button type="button" onClick={() => setEditing(undefined)}>
                {t("fcboard.scoreBoard.cancel")}
              </button>
              <button type="submit" className="fc-resource-primary">
                {t("fcboard.scoreBoard.confirm")}
              </button>
            </footer>
          </form>
        </MaterialPanel>
      )}
    </>
  );
};
