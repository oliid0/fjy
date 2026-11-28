import { useEffect, useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";

import type {
  DocumentOutline,
  DocumentPage,
  DocumentReader,
} from "./documentReader";

const Thumbnail = ({
  reader,
  page,
  selected,
  onClick,
}: {
  reader: DocumentReader;
  page: DocumentPage;
  selected: boolean;
  onClick: () => void;
}) => {
  const [image, setImage] = useState("");
  useEffect(() => {
    if (!reader.showThumbnails) {
      return;
    }
    const request = new AbortController();
    let url: string | undefined;
    const scheduled = setTimeout(() => {
      void reader
        .render(page.index, 160, request.signal)
        .then((frame) => {
          if (!request.signal.aborted && frame.image) {
            url = URL.createObjectURL(frame.image);
            setImage(url);
          }
        })
        .catch(() => {});
    }, 120);
    return () => {
      request.abort();
      clearTimeout(scheduled);
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [reader, page.index]);
  return (
    <button
      type="button"
      className="fc-document-thumbnail"
      aria-label={page.name}
      aria-current={selected || undefined}
      onClick={onClick}
    >
      {image && <img src={image} alt="" />}
      {page.name}
    </button>
  );
};

export const DocumentNavigator = ({
  reader,
  selected,
  mode,
  navigate,
}: {
  reader: DocumentReader;
  selected: number;
  mode: "pages" | "outline";
  navigate: (index: number) => void;
}) => {
  const content = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(300);
  const [outline, setOutline] = useState<DocumentOutline[]>();
  const [failed, setFailed] = useState(false);
  const rowHeight = Math.max(78, Math.ceil(height / 3));
  const start = Math.min(
    Math.max(0, reader.pages.length - 3),
    Math.floor(top / rowHeight),
  );
  useEffect(() => {
    if (!content.current) {
      return;
    }
    const resize = new ResizeObserver(([entry]) =>
      setHeight(entry.contentRect.height),
    );
    resize.observe(content.current);
    return () => resize.disconnect();
  }, [mode]);
  useEffect(() => {
    const scroll = content.current;
    if (!scroll || mode !== "pages") {
      return;
    }
    const position = selected * rowHeight;
    if (
      position < scroll.scrollTop ||
      position + rowHeight > scroll.scrollTop + scroll.clientHeight
    ) {
      scroll.scrollTop = Math.max(0, position - rowHeight);
    }
  }, [mode, selected, rowHeight]);
  useEffect(() => {
    if (mode !== "outline" || outline || failed || !reader.outline) {
      return;
    }
    let active = true;
    void reader
      .outline()
      .then((entries) => {
        if (active) {
          setOutline(entries);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [mode, outline, failed, reader]);

  return (
    <div
      ref={content}
      className="fc-document-navigation"
      onScroll={(event) => setTop(event.currentTarget.scrollTop)}
    >
      {mode === "outline" ? (
        outline?.length ? (
          outline.map((entry, index) => (
            <button
              type="button"
              key={index}
              title={entry.title}
              className="fc-document-outline"
              style={{ paddingInlineStart: 8 + Math.min(entry.depth, 6) * 8 }}
              onClick={() => {
                const target = reader.pages.findIndex(
                  (page) => page.index === entry.index,
                );
                if (target >= 0) {
                  navigate(target);
                }
              }}
            >
              {entry.title}
            </button>
          ))
        ) : (
          <p role={failed ? "alert" : "status"}>
            {t(
              failed
                ? "alerts.couldNotLoadInvalidFile"
                : outline
                ? "fcboard.document_no_outline"
                : "fcboard.processing",
            )}
          </p>
        )
      ) : (
        <div
          style={{
            height: reader.pages.length * rowHeight,
            position: "relative",
          }}
        >
          {reader.pages.slice(start, start + 3).map((page, slot) => {
            const index = start + slot;
            return (
              <div
                key={page.index}
                className="fc-document-navigation-item"
                style={{ top: index * rowHeight, height: rowHeight }}
              >
                <Thumbnail
                  reader={reader}
                  page={page}
                  selected={index === selected}
                  onClick={() => navigate(index)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
