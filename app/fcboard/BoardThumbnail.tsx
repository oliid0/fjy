import { useEffect, useRef, useState } from "react";
import { exportToBlob } from "@fcboard/fcboard";
import { t } from "@fcboard/fcboard/i18n";

import { boardPageExportOptions, boardCanvasSize } from "./boardExport";

import type { Board } from "./boards";
import type { BoardCanvasSize } from "./boardExport";

// Native RecyclerView creates only visible previews. Serialize exports so opening
// a long book never allocates a canvas for every saved page at once.
let previewExports = Promise.resolve();

export const BoardThumbnail = ({
  board,
  canvasSize = boardCanvasSize(),
}: {
  board: Board;
  canvasSize?: BoardCanvasSize;
}) => {
  const [source, setSource] = useState("");
  const container = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    const element = container.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { root: element.closest(".fc-board-list"), rootMargin: "48px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    let url = "";
    setSource("");
    if (!visible) {
      return;
    }
    previewExports = previewExports
      .catch(() => {})
      .then(async () => {
        if (!active) {
          return undefined;
        }
        const blob = await exportToBlob({
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
        if (active && blob) {
          url = URL.createObjectURL(blob);
          setSource(url);
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
    visible,
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
      ref={container}
      className="fc-board-thumbnail"
      style={{
        backgroundColor: board.view.viewBackgroundColor || "#ffffff",
        aspectRatio: `${canvasSize.width} / ${canvasSize.height}`,
      }}
    >
      {source && (
        <img
          src={source}
          decoding="async"
          draggable={false}
          alt={t("fcboard.preview_of_name", { name: board.name })}
        />
      )}
    </span>
  );
};
