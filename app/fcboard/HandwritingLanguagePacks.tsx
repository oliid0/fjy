import { useEffect, useRef, useState } from "react";
import { getLanguage, t, useI18n } from "@fcboard/fcboard/i18n";

import {
  digitalInkEngine,
  hasDigitalInk,
  currentTextInkLanguage,
} from "./digitalInk";
import { handwritingPackTags, languagePacksEvent } from "./languagePacks";
import { MaterialPanel } from "./MaterialPanel";
import { TransientMessage } from "./TransientMessage";

import type { PluginListenerHandle } from "@capacitor/core";

import type { HandwritingPack, HandwritingPacks } from "./languagePacks";

const states = [
  "checking",
  "builtin",
  "not_downloaded",
  "downloading",
  "downloaded",
  "deleting",
  "not_supported",
  "operation_failed",
  "waiting",
] as const;

/** LanguagePackDialogFragment / LanguagePackAdapter: current language first,
 * bundled packs protected, serial downloads and confirmed deletion. */
export const LanguagePacks = () => {
  useI18n();
  const [open, setOpen] = useState(false);
  const [packs, setPacks] = useState<HandwritingPack[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState<{
    kind: "required" | "remove";
    tag: string;
  }>();
  const [attempt, setAttempt] = useState(0);
  const requested = useRef("");
  const revision = useRef(-1);
  const generation = useRef(0);
  const scrolled = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const locale = getLanguage().code;
  const current = currentTextInkLanguage();
  const name = (tag: string) => {
    try {
      return (
        new Intl.DisplayNames([locale], { type: "language" }).of(
          tag.split("-")[0],
        ) || tag
      );
    } catch {
      return tag;
    }
  };
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (
        event as CustomEvent<{ tag?: string; required?: boolean }>
      ).detail;
      const tag = detail?.tag;
      requested.current =
        tag && (handwritingPackTags as readonly string[]).includes(tag)
          ? tag
          : currentTextInkLanguage();
      scrolled.current = false;
      if (detail?.required) {
        setConfirm({ kind: "required", tag: requested.current });
      } else {
        setOpen(true);
      }
    };
    window.addEventListener(languagePacksEvent, show);
    return () => window.removeEventListener(languagePacksEvent, show);
  }, []);
  useEffect(() => {
    if (!open) {
      return;
    }
    const request = ++generation.current;
    revision.current = -1;
    setPacks([]);
    setError("");
    if (!hasDigitalInk()) {
      return;
    }
    setLoading(true);
    let listener: PluginListenerHandle | undefined;
    const receive = (value: HandwritingPacks) => {
      if (generation.current !== request || value.revision < revision.current) {
        return;
      }
      revision.current = value.revision;
      setPacks(value.packs);
    };
    const refresh = () =>
      digitalInkEngine
        .listPacks()
        .then(receive)
        .catch((failure) => {
          if (generation.current === request) {
            setError(String(failure.message || failure));
          }
        })
        .finally(() => {
          if (generation.current === request) {
            setLoading(false);
          }
        });
    digitalInkEngine
      .addListener("packsChanged", receive)
      .then((handle) => {
        if (generation.current === request) {
          listener = handle;
        } else {
          void handle.remove();
        }
      })
      .catch((failure) => {
        if (generation.current === request) {
          setError(String(failure.message || failure));
        }
      });
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      generation.current = request + 1;
      void listener?.remove();
      window.removeEventListener("focus", refresh);
    };
  }, [open, attempt]);
  useEffect(() => {
    if (open && packs.length && !scrolled.current) {
      list.current
        ?.querySelector<HTMLElement>(
          `[data-pack="${requested.current || current}"]`,
        )
        ?.scrollIntoView?.({ block: "nearest" });
      scrolled.current = true;
    }
  }, [open, packs, current]);
  const close = () => {
    setOpen(false);
    setConfirm(undefined);
  };
  const operate = async (pack: HandwritingPack, remove: boolean) => {
    const request = generation.current;
    setError("");
    setPacks((previous) =>
      previous.map((item) =>
        item.tag === pack.tag ? { ...item, state: remove ? 5 : 8 } : item,
      ),
    );
    try {
      const result = await (remove
        ? digitalInkEngine.deletePack({ tag: pack.tag })
        : digitalInkEngine.downloadPack({ tag: pack.tag }));
      if (
        generation.current === request &&
        result.revision >= revision.current
      ) {
        revision.current = result.revision;
        setPacks(result.packs);
      }
    } catch (failure) {
      if (generation.current === request) {
        setError(failure instanceof Error ? failure.message : String(failure));
        setPacks((previous) =>
          previous.map((item) =>
            item.tag === pack.tag ? { ...item, state: 7 } : item,
          ),
        );
      }
    }
  };
  const sorted = [...packs].sort(
    (a, b) =>
      Number(b.tag === current) - Number(a.tag === current) ||
      Number(b.bundled) - Number(a.bundled) ||
      name(a.tag).localeCompare(name(b.tag), locale),
  );
  return (
    <>
      {open && (
        <MaterialPanel
          centered
          className="fc-language-pack-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t("fcboard.languagePacks.title")}
          onDismiss={close}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              close();
            }
          }}
        >
          <header>
            <h2>{t("fcboard.languagePacks.title")}</h2>
            <button
              type="button"
              aria-label={t("fcboard.close")}
              onClick={close}
            >
              ×
            </button>
          </header>
          <p className="fc-language-pack-description">
            {t("fcboard.languagePacks.description")}
          </p>
          <div className="fc-language-pack-list" ref={list} aria-busy={loading}>
            {!hasDigitalInk() && (
              <p role="status">{t("fcboard.languagePacks.android_only")}</p>
            )}
            {loading && (
              <p role="status">{t("fcboard.languagePacks.checking")}</p>
            )}
            {sorted.map((pack) => (
              <div
                className="fc-language-pack-row"
                key={pack.tag}
                data-pack={pack.tag}
              >
                <div>
                  <strong>{name(pack.tag)}</strong>
                  {pack.tag === current && (
                    <b>{t("fcboard.languagePacks.current")}</b>
                  )}
                  <small>{pack.tag}</small>
                </div>
                <span>{t(`fcboard.languagePacks.${states[pack.state]}`)}</span>
                {[3, 5].includes(pack.state) ? (
                  <progress
                    aria-label={`${name(pack.tag)} ${t(
                      `fcboard.languagePacks.${states[pack.state]}`,
                    )}`}
                  />
                ) : (
                  <button
                    type="button"
                    className={
                      pack.state === 4 || pack.bundled
                        ? "fc-language-pack-secondary"
                        : ""
                    }
                    disabled={
                      (pack.bundled && pack.state !== 7) ||
                      [0, 6, 8].includes(pack.state)
                    }
                    aria-label={`${name(pack.tag)} ${t(
                      `fcboard.languagePacks.${
                        pack.state === 4
                          ? "delete"
                          : pack.state === 7
                          ? "retry"
                          : pack.bundled
                          ? "builtin"
                          : pack.state === 8
                          ? "waiting"
                          : pack.state === 6
                          ? "not_supported"
                          : "download"
                      }`,
                    )}`}
                    onClick={() => {
                      if (pack.state === 4) {
                        setConfirm({ kind: "remove", tag: pack.tag });
                      } else {
                        void operate(pack, false);
                      }
                    }}
                  >
                    {t(
                      `fcboard.languagePacks.${
                        pack.state === 4
                          ? "delete"
                          : pack.state === 7
                          ? "retry"
                          : pack.bundled
                          ? "builtin"
                          : pack.state === 8
                          ? "waiting"
                          : pack.state === 6
                          ? "not_supported"
                          : "download"
                      }`,
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
          {error && (
            <>
              <TransientMessage
                role="alert"
                message={error}
                className="fc-error"
              />
              <button type="button" onClick={() => setAttempt(attempt + 1)}>
                {t("fcboard.languagePacks.retry")}
              </button>
            </>
          )}
        </MaterialPanel>
      )}
      {confirm && (
        <MaterialPanel
          centered
          className="fc-language-pack-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-label={t(
            `fcboard.languagePacks.${
              confirm.kind === "remove"
                ? "delete_confirm_title"
                : "required_title"
            }`,
          )}
          onDismiss={() => setConfirm(undefined)}
        >
          <h2>
            {t(
              `fcboard.languagePacks.${
                confirm.kind === "remove"
                  ? "delete_confirm_title"
                  : "required_title"
              }`,
            )}
          </h2>
          <p>
            {t(
              `fcboard.languagePacks.${
                confirm.kind === "remove"
                  ? "delete_confirm_message"
                  : "required_message"
              }`,
              { name: name(confirm.tag) },
            )}
          </p>
          <footer>
            <button type="button" onClick={() => setConfirm(undefined)}>
              {t("fcboard.languagePacks.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm.kind === "required") {
                  setOpen(true);
                } else {
                  const pack = packs.find((item) => item.tag === confirm.tag);
                  if (pack && !pack.bundled && pack.state === 4) {
                    void operate(pack, true);
                  }
                }
                setConfirm(undefined);
              }}
            >
              {t(
                `fcboard.languagePacks.${
                  confirm.kind === "remove" ? "delete" : "manage"
                }`,
              )}
            </button>
          </footer>
        </MaterialPanel>
      )}
    </>
  );
};
