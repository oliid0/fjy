import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@fcboard/fcboard/i18n";

import { searchDuration } from "./searchService";
import play from "./factory-search-icons/play.svg";
import loadingIcon from "./factory-search-icons/loading.svg";

import type { SearchMedia } from "./searchService";

const SearchImageTile = ({
  item,
  label,
  onInsert,
  outside,
}: {
  item: SearchMedia;
  label: string;
  onInsert: (item: SearchMedia, position?: { x: number; y: number }) => void;
  outside: (x: number, y: number) => boolean;
}) => {
  const contact = useRef<
    | {
        id: number;
        x: number;
        y: number;
        active: boolean;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined
  >(undefined);
  const [ghost, setGhost] = useState<{ x: number; y: number }>();
  useEffect(
    () => () => {
      if (contact.current) {
        clearTimeout(contact.current.timer);
      }
    },
    [],
  );
  const clear = () => {
    if (contact.current) {
      clearTimeout(contact.current.timer);
    }
    contact.current = undefined;
    setGhost(undefined);
  };
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={item.desc}
        className="fc-search-image-tile"
        onContextMenu={(event) => event.preventDefault()}
        onClick={(event) => {
          if (event.detail === 0) {
            onInsert(item);
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || contact.current) {
            return;
          }
          event.stopPropagation();
          const target = event.currentTarget;
          const id = event.pointerId;
          const x = event.clientX;
          const y = event.clientY;
          try {
            target.setPointerCapture?.(id);
          } catch {}
          const timer = setTimeout(() => {
            if (contact.current?.id === id) {
              contact.current.active = true;
              setGhost({ x, y });
            }
          }, 500);
          contact.current = { id, x, y, active: false, timer };
        }}
        onPointerMove={(event) => {
          const current = contact.current;
          if (!current || current.id !== event.pointerId) {
            return;
          }
          if (current.active) {
            event.preventDefault();
            event.stopPropagation();
            setGhost({ x: event.clientX, y: event.clientY });
          } else if (
            Math.hypot(event.clientX - current.x, event.clientY - current.y) > 6
          ) {
            clear();
          }
        }}
        onPointerCancel={clear}
        onLostPointerCapture={clear}
        onPointerUp={(event) => {
          const current = contact.current;
          if (!current || current.id !== event.pointerId) {
            return;
          }
          const insert =
            current.active && outside(event.clientX, event.clientY);
          clear();
          if (insert) {
            event.preventDefault();
            event.stopPropagation();
            onInsert(item, { x: event.clientX, y: event.clientY });
          }
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
      >
        <img
          src={item.pictureUrl || item.url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      </button>
      {ghost &&
        createPortal(
          <img
            className="fc-search-drag-image"
            alt=""
            src={item.pictureUrl || item.url}
            style={{ left: ghost.x, top: ghost.y }}
          />,
          document.body,
        )}
    </>
  );
};

/** RecyclerView equivalent: only the visible columns decode images, with native four-column preload. */
export const SearchMediaStrip = ({
  kind,
  items,
  loading,
  error,
  hasMore,
  onMore,
  onImage,
  onVideo,
  outside,
}: {
  kind: "photo" | "video";
  items: SearchMedia[];
  loading: boolean;
  error: string;
  hasMore: boolean;
  onMore: () => void;
  onImage: (item: SearchMedia, position?: { x: number; y: number }) => void;
  onVideo: (item: SearchMedia) => void;
  outside: (x: number, y: number) => boolean;
}) => {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 320, height: 120 });
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const measure = () => {
      const node = host.current;
      if (node) {
        setSize({
          width: node.clientWidth || 320,
          height: node.clientHeight || 120,
        });
      }
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      if (host.current) {
        observer.observe(host.current);
      }
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  useEffect(() => {
    if (host.current) {
      host.current.scrollLeft = 0;
      setOffset(0);
    }
  }, [kind]);
  const rows = kind === "photo" ? 2 : 1;
  const gap = 10 * 0.67;
  const tileHeight = (size.height - (rows - 1) * gap) / rows;
  const width =
    kind === "photo"
      ? (tileHeight * 140) / 92
      : (Math.max(24, tileHeight - 36 * 0.67) * 172) / 100;
  const step = width + gap;
  const columns = Math.ceil(items.length / rows);
  const start = Math.max(0, Math.floor(offset / step) - 1) * rows;
  const end = Math.min(
    items.length,
    (Math.ceil((offset + size.width) / step) + 1) * rows,
  );
  useEffect(() => {
    if (
      items.length &&
      hasMore &&
      !loading &&
      !error &&
      columns * step - offset - size.width <= 4 * step
    ) {
      onMore();
    }
  }, [
    items.length,
    hasMore,
    loading,
    error,
    columns,
    step,
    offset,
    size.width,
    onMore,
  ]);
  const label = t(
    kind === "photo" ? "fcboard.search_images" : "fcboard.search_videos",
  );
  return (
    <div
      className="fc-search-strip"
      ref={host}
      role="region"
      aria-label={label}
      aria-busy={loading}
      onScroll={(event) => {
        const node = event.currentTarget;
        setOffset(node.scrollLeft);
        if (
          !loading &&
          hasMore &&
          node.scrollWidth - node.clientWidth - node.scrollLeft <= 4 * step
        ) {
          onMore();
        }
      }}
    >
      {!items.length ? (
        <div className="fc-search-no-data" role={error ? "alert" : "status"}>
          {error ||
            (loading ? t("fcboard.search_loading") : t("fcboard.search_empty"))}
          {error && (
            <button type="button" onClick={onMore}>
              {t("chat.retry")}
            </button>
          )}
        </div>
      ) : (
        <div
          className="fc-search-strip-track"
          style={{
            width: Math.max(size.width, columns * step + size.width),
            height: size.height,
          }}
        >
          {items.slice(start, end).map((item, index) => {
            const at = start + index;
            return (
              <div
                className="fc-search-media-cell"
                key={`${at}:${item.url}`}
                style={{
                  left: Math.floor(at / rows) * step,
                  top: (at % rows) * (tileHeight + gap),
                  width,
                  height: tileHeight,
                }}
              >
                {kind === "photo" ? (
                  <SearchImageTile
                    item={item}
                    label={item.desc || `${label} ${at + 1}`}
                    onInsert={onImage}
                    outside={outside}
                  />
                ) : (
                  <button
                    type="button"
                    className="fc-search-video-tile"
                    aria-label={item.desc || `${label} ${at + 1}`}
                    onClick={() => onVideo(item)}
                  >
                    <span className="fc-search-video-thumb">
                      <img
                        src={item.pictureUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                      <img className="fc-search-video-play" src={play} alt="" />
                      <span>{searchDuration(item.duration)}</span>
                    </span>
                    <strong title={item.from}>{item.from}</strong>
                    <span title={item.desc}>{item.desc}</span>
                  </button>
                )}
              </div>
            );
          })}
          {error && (
            <span className="fc-search-page-error" role="alert">
              {error}
            </span>
          )}
          <div
            className="fc-search-page-footer"
            style={{ left: columns * step, width: size.width }}
          >
            {hasMore ? (
              <button
                type="button"
                className={`fc-search-more ${
                  !loading && !error ? "fc-search-more-idle" : ""
                }`}
                disabled={loading}
                onClick={onMore}
                aria-label={error ? t("chat.retry") : t("fcboard.search_more")}
              >
                {loading ? (
                  <>
                    <img src={loadingIcon} alt="" />
                    {t("fcboard.search_loading")}
                  </>
                ) : error ? (
                  t("chat.retry")
                ) : (
                  <span>{t("fcboard.search_more")}</span>
                )}
              </button>
            ) : (
              <span className="fc-search-end">No more data</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
