import { useState, useLayoutEffect } from "react";

import { THEME } from "@fcboard/common";

import { useEditorInterface, useFcboardContainer } from "../components/App";
import { useUIAppState } from "../context/ui-appState";

export const useCreatePortalContainer = (opts?: {
  className?: string;
  parentSelector?: string;
}) => {
  const [div, setDiv] = useState<HTMLDivElement | null>(null);

  const editorInterface = useEditorInterface();
  const { theme } = useUIAppState();

  const { container: excalidrawContainer } = useFcboardContainer();

  useLayoutEffect(() => {
    if (div) {
      div.className = "";
      div.classList.add("fcboard", ...(opts?.className?.split(/\s+/) || []));
      div.classList.toggle(
        "fcboard--mobile",
        editorInterface.formFactor === "phone",
      );
      div.classList.toggle("theme--dark", theme === THEME.DARK);
    }
  }, [div, theme, editorInterface.formFactor, opts?.className]);

  useLayoutEffect(() => {
    const container = opts?.parentSelector
      ? excalidrawContainer?.querySelector(opts.parentSelector)
      : document.body;

    if (!container) {
      return;
    }

    const div = document.createElement("div");

    if (excalidrawContainer?.dataset.fcboardId) {
      div.dataset.fcboardOwner = excalidrawContainer.dataset.fcboardId;
    }

    container.appendChild(div);

    setDiv(div);

    return () => {
      container.removeChild(div);
    };
  }, [excalidrawContainer, opts?.parentSelector]);

  return div;
};
