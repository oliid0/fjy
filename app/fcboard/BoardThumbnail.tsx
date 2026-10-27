import { useEffect, useState } from "react";
import { exportToBlob } from "@excalidraw/excalidraw";
import { t } from "@excalidraw/excalidraw/i18n";

import type { Board } from "./boards";

export const BoardThumbnail = ({ board }: { board: Board }) => {
  const [source, setSource] = useState("");
  useEffect(() => {
    let active = true;
    let url = "";
    if (board.elements.length) {
      void exportToBlob({
        elements: board.elements,
        files: board.files,
        appState: {
          ...board.view,
          exportBackground: true,
          exportWithDarkMode: false,
        },
        mimeType: "image/png",
        maxWidthOrHeight: 280,
      })
        .then((blob) => {
          url = URL.createObjectURL(blob);
          if (active) {
            setSource(url);
          } else {
            URL.revokeObjectURL(url);
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [board.elements, board.files, board.view, board.updated]);
  return (
    <span
      className="fc-board-thumbnail"
      style={{ backgroundColor: board.view.viewBackgroundColor || "#ffffff" }}
    >
      {source && (
        <img
          src={source}
          alt={t("fcboard.preview_of_name", { name: board.name })}
        />
      )}
    </span>
  );
};
