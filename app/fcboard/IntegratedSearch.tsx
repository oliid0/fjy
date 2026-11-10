import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t, useI18n } from "@fcboard/fcboard/i18n";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { classroomCommands } from "./commands";
import { searchPage, searchUrl } from "./searchService";
import { insertWebSelection } from "./webSelection";
import { SearchMediaStrip } from "./SearchMediaStrip";
import switchIcon from "./factory-search-icons/switch.svg";
import hideIcon from "./factory-search-icons/hide.svg";
import closeIcon from "./factory-search-icons/close.svg";
import clearIcon from "./factory-search-icons/clear.svg";
import searchIcon from "./factory-search-icons/search.svg";
import wordIcon from "./factory-search-icons/word.svg";
import photoIcon from "./factory-search-icons/photo.svg";
import videoIcon from "./factory-search-icons/video.svg";
import loadingIcon from "./factory-search-icons/loading.png";
import "./IntegratedSearch.scss";

import type { SearchKind, SearchMedia } from "./searchService";

type Channel = {
  text: string;
  items: SearchMedia[];
  page: number;
  loading: boolean;
  more: boolean;
  error: string;
};
const emptyChannel = (): Channel => ({
  text: "",
  items: [],
  page: 0,
  loading: false,
  more: true,
  error: "",
});
const empty = (): Record<SearchKind, Channel> => ({
  word: emptyChannel(),
  photo: emptyChannel(),
  video: emptyChannel(),
});
const SearchWindow = ({
  api,
  keyword,
  hidden,
  onClose,
  onHide,
}: {
  api: FcboardImperativeAPI;
  keyword: string;
  hidden: boolean;
  onClose: () => void;
  onHide: () => void;
}) => {
  useI18n();
  const [query, setQuery] = useState(keyword);
  const [channels, setChannels] = useState(empty);
  const current = useRef(channels);
  const request = useRef<
    { id: number; keyword: string; controller: AbortController } | undefined
  >(undefined);
  const insertion = useRef<AbortController | undefined>(undefined);
  const queryId = useRef(0);
  const [inserting, setInserting] = useState(false);
  const [error, setError] = useState("");
  const [side, setSide] = useState(() => {
    try {
      return localStorage.getItem("fcboard.search.side") === "left"
        ? "left"
        : "right";
    } catch {
      return "right";
    }
  });
  const panel = useRef<HTMLElement>(null);
  const update = useCallback(
    (kind: SearchKind, fn: (old: Channel) => Channel) => {
      current.current = {
        ...current.current,
        [kind]: fn(current.current[kind]),
      };
      setChannels(current.current);
    },
    [],
  );
  const load = useCallback(
    async (kind: SearchKind, job: NonNullable<typeof request.current>) => {
      if (
        job.controller.signal.aborted ||
        request.current !== job ||
        current.current[kind].loading
      ) {
        return;
      }
      const page = current.current[kind].page + 1;
      update(kind, (old) => ({ ...old, loading: true, error: "" }));
      try {
        const result = await searchPage(
          kind,
          job.keyword,
          page,
          job.controller.signal,
        );
        if (request.current !== job || job.controller.signal.aborted) {
          return;
        }
        update(kind, (old) => {
          const urls = new Set(old.items.map((item) => item.url));
          return {
            ...old,
            text: result.text,
            page,
            items: [
              ...old.items,
              ...result.items.filter((item) => !urls.has(item.url)),
            ],
            more:
              kind !== "word" &&
              result.items.some((item) => !urls.has(item.url)),
          };
        });
      } catch (failure) {
        if (request.current === job && !job.controller.signal.aborted) {
          update(kind, (old) => ({
            ...old,
            error: failure instanceof Error ? failure.message : String(failure),
          }));
        }
      } finally {
        if (request.current === job && !job.controller.signal.aborted) {
          update(kind, (old) => ({ ...old, loading: false }));
        }
      }
    },
    [update],
  );
  const start = useCallback(
    (value: string) => {
      request.current?.controller.abort();
      insertion.current?.abort();
      setInserting(false);
      setError("");
      current.current = empty();
      setChannels(current.current);
      const job = {
        id: ++queryId.current,
        keyword: value.trim(),
        controller: new AbortController(),
      };
      request.current = job;
      if (!job.keyword) {
        return;
      }
      if (navigator.onLine === false) {
        for (const kind of ["word", "photo", "video"] as const) {
          update(kind, (old) => ({
            ...old,
            error: t("fcboard.search_offline"),
          }));
        }
        return;
      }
      for (const kind of ["word", "photo", "video"] as const) {
        void load(kind, job);
      }
    },
    [load, update],
  );
  useEffect(() => {
    start(keyword);
    return () => {
      request.current?.controller.abort();
      insertion.current?.abort();
    };
  }, [keyword, start]);
  const insert = async (selection: {
    kind: "text" | "image";
    value: string;
    sourceUrl?: string;
    position?: { x: number; y: number };
  }) => {
    insertion.current?.abort();
    const controller = new AbortController();
    insertion.current = controller;
    setInserting(true);
    setError("");
    try {
      await insertWebSelection(api, selection, controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      if (insertion.current === controller && !controller.signal.aborted) {
        setInserting(false);
      }
    }
  };
  const outside = (x: number, y: number) => {
    const bounds = panel.current?.getBoundingClientRect();
    return (
      !!bounds &&
      (x < bounds.left ||
        x > bounds.right ||
        y < bounds.top ||
        y > bounds.bottom)
    );
  };
  const busy = Object.values(channels).some(
    (channel) => channel.loading && channel.page === 0,
  );
  const section = (kind: "photo" | "video", icon: string, label: string) => {
    const value = channels[kind];
    return (
      <section className={`fc-search-section fc-search-${kind}`}>
        <h3>
          <img src={icon} alt="" />
          {label}
        </h3>
        <SearchMediaStrip
          key={`${request.current?.id}:${kind}`}
          kind={kind}
          items={value.items}
          loading={value.loading}
          error={value.error}
          hasMore={value.more}
          onMore={() => {
            if (request.current) {
              void load(kind, request.current);
            }
          }}
          outside={outside}
          onImage={(item, position) =>
            void insert({
              kind: "image",
              value: item.url,
              sourceUrl: searchUrl(item.from) || undefined,
              position,
            })
          }
          onVideo={(item) => {
            setError("");
            void classroomCommands
              .execute({ name: "web.open", args: { url: item.url } })
              .catch((failure) => setError(String(failure)));
          }}
        />
      </section>
    );
  };
  return createPortal(
    <section
      ref={panel}
      className={`fc-integrated-search fc-search-on-${side}`}
      role="dialog"
      aria-label={t("fcboard.search")}
      aria-modal="false"
      hidden={hidden}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          onClose();
        }
      }}
    >
      <aside className="fc-search-action-bar">
        <button
          type="button"
          aria-label={t("fcboard.search_switch_side")}
          onClick={() =>
            setSide((previous) => {
              const next = previous === "right" ? "left" : "right";
              try {
                localStorage.setItem("fcboard.search.side", next);
              } catch {}
              return next;
            })
          }
        >
          <img src={switchIcon} alt="" />
        </button>
        <button
          type="button"
          aria-label={t("fcboard.search_hide")}
          onClick={onHide}
        >
          <img src={hideIcon} alt="" />
        </button>
        <button type="button" aria-label={t("buttons.close")} onClick={onClose}>
          <img src={closeIcon} alt="" />
        </button>
      </aside>
      <div className="fc-search-content">
        <form
          className="fc-search-input"
          onSubmit={(event) => {
            event.preventDefault();
            start(query);
          }}
        >
          <input
            aria-label={t("fcboard.search")}
            placeholder={t("fcboard.search_placeholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              type="button"
              aria-label={t("buttons.clear")}
              onClick={() => {
                setQuery("");
                start("");
              }}
            >
              <img src={clearIcon} alt="" />
            </button>
          )}
          <button
            type="submit"
            aria-label={t("fcboard.search")}
            disabled={!query.trim()}
          >
            <img src={searchIcon} alt="" />
          </button>
        </form>
        <section
          className="fc-search-definition"
          aria-label={t("fcboard.search_definition")}
        >
          <h3>
            <img src={wordIcon} alt="" />
            {t("fcboard.search_definition")}
            <button
              type="button"
              disabled={inserting || !channels.word.text}
              onClick={() =>
                void insert({ kind: "text", value: channels.word.text })
              }
            >
              {t("fcboard.search_insert")}
            </button>
          </h3>
          <div className="fc-search-definition-text">
            {channels.word.text ||
              (channels.word.error ? (
                <span role="alert">
                  {channels.word.error}
                  <button type="button" onClick={() => start(query)}>
                    {t("chat.retry")}
                  </button>
                </span>
              ) : (
                t("fcboard.search_empty")
              ))}
          </div>
        </section>
        {section("photo", photoIcon, t("fcboard.search_images"))}
        {section("video", videoIcon, t("fcboard.search_videos"))}
        {busy && (
          <div className="fc-search-status" role="status">
            <img src={loadingIcon} alt="" />
            {t("fcboard.search_loading")}
          </div>
        )}
        {(error || inserting) && (
          <p
            className="fc-search-insertion-status"
            role={error ? "alert" : "status"}
          >
            {error || t("fcboard.search_inserting")}
          </p>
        )}
      </div>
    </section>,
    document.body,
  );
};

/** One in-app search surface shared by selected handwriting and typed queries. */
export const IntegratedSearch = ({ api }: { api: FcboardImperativeAPI }) => {
  const [session, setSession] = useState<{
    id: number;
    keyword: string;
    visible: boolean;
  }>();
  const next = useRef(0);
  useEffect(() => {
    const stops = [
      classroomCommands.register(
        "search.open",
        "在应用内同时搜索释义、图片和视频；args.keyword 可省略以输入关键词。",
        (args) => {
          if (
            args.keyword !== undefined &&
            (typeof args.keyword !== "string" || args.keyword.length > 10000)
          ) {
            throw Error(t("fcboard.invalid_style_parameters"));
          }
          if (args.keyword === undefined) {
            setSession((old) =>
              old
                ? { ...old, visible: true }
                : { id: ++next.current, keyword: "", visible: true },
            );
          } else {
            setSession({
              id: ++next.current,
              keyword: args.keyword as string,
              visible: true,
            });
          }
          return { open: true };
        },
      ),
      classroomCommands.register("search.close", "@internal", () =>
        setSession(undefined),
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, []);
  return session ? (
    <SearchWindow
      key={session.id}
      api={api}
      keyword={session.keyword}
      hidden={!session.visible}
      onClose={() => setSession(undefined)}
      onHide={() => setSession((old) => old && { ...old, visible: false })}
    />
  ) : null;
};
