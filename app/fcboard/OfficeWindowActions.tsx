import {
  CloseIcon,
  MoonIcon,
  SunIcon,
  fullscreenIcon,
} from "@fcboard/fcboard/components/icons";
import { t } from "@fcboard/fcboard/i18n";

import type { ReactNode } from "react";

export const OfficeWindowActions = ({
  dark,
  fullscreen,
  toggleTheme,
  toggleFullscreen,
  close,
  drag,
}: {
  dark?: boolean;
  fullscreen: boolean;
  toggleTheme?: () => void;
  toggleFullscreen: () => void;
  close: () => void;
  drag?: ReactNode;
}) => {
  const theme = t(dark ? "buttons.lightMode" : "buttons.darkMode");
  const expand = t(
    fullscreen ? "fcboard.media_exit_fullscreen" : "fcboard.fullscreen",
  );
  return (
    <div className="fc-office-window-actions">
      {toggleTheme && (
        <button
          type="button"
          title={theme}
          aria-label={theme}
          onClick={toggleTheme}
        >
          {dark ? SunIcon : MoonIcon}
        </button>
      )}
      <button
        type="button"
        title={expand}
        aria-label={expand}
        aria-pressed={fullscreen}
        onClick={toggleFullscreen}
      >
        {fullscreenIcon}
      </button>
      <button
        type="button"
        title={t("fcboard.close_document")}
        aria-label={t("fcboard.close_document")}
        onClick={close}
      >
        {CloseIcon}
      </button>
      {!fullscreen && drag}
    </div>
  );
};
