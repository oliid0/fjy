import { useState } from "react";
import { t } from "@excalidraw/excalidraw/i18n";

import { MaterialPanel } from "./MaterialPanel";

export const SummaryText = ({
  value,
  placeholder,
}: {
  value: string;
  placeholder: string;
}) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <button
        type="button"
        className="fc-summary-text"
        aria-label={t("fcboard.view_summary_full_screen")}
        disabled={!value}
        onClick={() => setExpanded(true)}
      >
        {value || placeholder}
      </button>
      {expanded && (
        <MaterialPanel
          centered
          className="fc-summary-fullscreen"
          role="dialog"
          aria-label={t("fcboard.ai_summary")}
          onDismiss={() => setExpanded(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setExpanded(false);
            }
          }}
        >
          <button
            type="button"
            className="fc-summary-text"
            aria-label={t("fcboard.exit_full_screen_summary")}
            onClick={() => setExpanded(false)}
          >
            {value}
          </button>
        </MaterialPanel>
      )}
    </>
  );
};
