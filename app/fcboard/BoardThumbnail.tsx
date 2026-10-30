import { useEffect, useState } from "react";
import { exportToBlob } from "@fcboard/fcboard";
import { t } from "@fcboard/fcboard/i18n";

import { boardPageExportOptions, boardCanvasSize } from "./boardExport";

import type { Board } from "./boards";
import type { BoardCanvasSize } from "./boardExport";

export const BoardThumbnail = ({
  board,
  canvasSize = boardCanvasSize(),
}: {
  board: Board;
  canvasSize?: BoardCanvasSize;
}) => {
  const [source, setSource] = useState("");
  useEffect(() => {
    let active = true;
    let url = "";
    setSource("");
    void Promise.resolve()
      .then(() => {
        if (!active) {
          return undefined;
        }
        return exportToBlob({
          ...boardPageExportOptions(
            { elements: board.elements, files: board.files, view: board.view },
            {
              width: canvasSize.width,
              height: canvasSize.height,
              pixelRatio: canvasSize.pixelRatio,
            },
            280,
          ),
          mimeType: "image/png",
        });
      })
      .then((blob) => {
        if (!blob) {
          return;
        }
        url = URL.createObjectURL(blob);
        if (active) {
          setSource(url);
        } else {
          URL.revokeObjectURL(url);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [
    board.elements,
    board.files,
    board.view,
    board.updated,
    canvasSize.width,
    canvasSize.height,
    canvasSize.pixelRatio,
  ]);
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
