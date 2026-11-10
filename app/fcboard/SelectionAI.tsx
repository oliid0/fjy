import { useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";
import ButtonBase from "@mui/material/ButtonBase";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import Paper from "@mui/material/Paper";
import Popper from "@mui/material/Popper";

import aiIcon from "./factory-selection-icons/ai.svg";
import questionIcon from "./factory-selection-icons/question-default.svg";
import questionFocus from "./factory-selection-icons/question-focus.svg";
import creativeIcon from "./factory-selection-icons/creative-default.svg";
import creativeFocus from "./factory-selection-icons/creative-focus.svg";
import quizIcon from "./factory-selection-icons/quiz-default.svg";
import quizFocus from "./factory-selection-icons/quiz-focus.svg";

export type SelectionAIAction = "question" | "creative" | "quiz";

/** layout_select_ai + e.R0: same trigger toggles; opening outside closes this child. */
export const SelectionAI = ({
  pending,
  onCancel,
  onAction,
}: {
  pending: boolean;
  onCancel: () => void;
  onAction: (action: SelectionAIAction) => void;
}) => {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const choices = [
    ["question", questionIcon, questionFocus],
    ["creative", creativeIcon, creativeFocus],
    ["quiz", quizIcon, quizFocus],
  ] as const;
  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <div className="fc-selection-ai">
        <ButtonBase
          ref={anchor}
          aria-label={pending ? t("fcboard.cancel_recognition") : "AI"}
          aria-busy={pending}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => {
            if (pending) {
              setOpen(false);
              onCancel();
            } else {
              setOpen((value) => !value);
            }
          }}
        >
          {pending ? (
            <span>×</span>
          ) : (
            <>
              <img src={aiIcon} alt="" draggable={false} />
              <span>AI</span>
            </>
          )}
        </ButtonBase>
        <Popper
          open={open && !pending}
          anchorEl={anchor.current}
          placement="bottom"
          modifiers={[
            { name: "offset", options: { offset: [0, 8 * 0.67] } },
            { name: "flip" },
            { name: "preventOverflow", options: { padding: 12 } },
          ]}
          style={{ zIndex: 1301 }}
        >
          <Paper
            role="menu"
            aria-label="AI"
            className="fc-selection-ai-menu"
            elevation={0}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                setOpen(false);
                anchor.current?.focus();
              }
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                const items = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button",
                  ),
                ];
                const index = items.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                items[
                  (index +
                    (event.key === "ArrowRight" ? 1 : items.length - 1)) %
                    items.length
                ]?.focus();
              }
            }}
          >
            {choices.map(([action, normal, focus]) => (
              <ButtonBase
                key={action}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onAction(action);
                }}
              >
                <img
                  className="fc-selection-ai-normal"
                  src={normal}
                  alt=""
                  draggable={false}
                />
                <img
                  className="fc-selection-ai-focus"
                  src={focus}
                  alt=""
                  draggable={false}
                />
                <span>{t(`fcboard.selection_${action}`)}</span>
              </ButtonBase>
            ))}
          </Paper>
        </Popper>
      </div>
    </ClickAwayListener>
  );
};
