import { useEffect, useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";
import { CloseIcon } from "@fcboard/fcboard/components/icons";

import { MaterialPanel } from "./MaterialPanel";
import { classroomCommands } from "./commands";

import "./RollCall.scss";

const storageKey = "fcboard-rollcall-names";
export const parseNamelist = (text: string) =>
  text
    .split(/\r?\n|[,，;；]/)
    .map((name) => name.trim())
    .filter(Boolean);
const loadNames = () => {
  try {
    return parseNamelist(localStorage.getItem(storageKey) || "");
  } catch {
    return [];
  }
};

/** ex-caller: start, roll, stop and resume; settings contain the namelist only. */
export const RollCall = () => {
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState(loadNames);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const index = useRef(-1);
  const close = () => {
    setRolling(false);
    setOpen(false);
  };
  useEffect(
    () =>
      classroomCommands.register(
        "tools.rollcall",
        "Open the centered roll-call window. args.open=false closes. Names are edited in its namelist settings.",
        (args) => {
          if (args.open !== undefined && typeof args.open !== "boolean") {
            throw new Error(t("fcboard.invalid_style_parameters"));
          }
          setRolling(false);
          setEditing(false);
          setOpen(args.open !== false);
          return { open: args.open !== false };
        },
      ),
    [],
  );
  useEffect(() => {
    if (!open || !rolling || !names.length) {
      return;
    }
    const next = () => {
      index.current = (index.current + 1) % names.length;
      setResult(names[index.current]);
    };
    next();
    const timer = setInterval(next, 70);
    return () => clearInterval(timer);
  }, [open, rolling, names]);
  const edit = () => {
    setRolling(false);
    setDraft(names.join("\n"));
    setError("");
    setEditing(true);
  };
  const save = () => {
    const next = parseNamelist(draft);
    if (next.length > 5000 || next.some((name) => name.length > 80)) {
      setError(t("fcboard.namelist_invalid"));
      return;
    }
    try {
      localStorage.setItem(storageKey, next.join("\n"));
      setNames(next);
      setResult("");
      index.current = -1;
      setEditing(false);
      setError("");
    } catch (failure) {
      setError(String(failure));
    }
  };
  return open ? (
    <MaterialPanel
      centered
      role="dialog"
      className="fc-rollcall"
      aria-label={t("fcboard.roll_call")}
      onDismiss={close}
    >
      <header>
        <h2>{t(editing ? "fcboard.namelist" : "fcboard.roll_call")}</h2>
        <button type="button" aria-label={t("buttons.close")} onClick={close}>
          {CloseIcon}
        </button>
      </header>
      {editing ? (
        <section className="fc-rollcall-editor">
          <label htmlFor="fc-rollcall-names">
            {t("fcboard.namelist_hint")}
          </label>
          <textarea
            id="fc-rollcall-names"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={400000}
          />
          {error && <p role="alert">{error}</p>}
          <footer>
            <button type="button" onClick={() => setEditing(false)}>
              {t("buttons.cancel")}
            </button>
            <button type="button" onClick={save}>
              {t("buttons.save")}
            </button>
          </footer>
        </section>
      ) : (
        <>
          <div
            className="fc-rollcall-stage"
            data-rolling={rolling}
            onClick={() => {
              if (rolling) {
                setRolling(false);
              }
            }}
          >
            {result ? (
              <output
                aria-live={rolling ? "off" : "polite"}
                style={{
                  fontSize: `min(22cqh, ${Math.min(
                    18,
                    80 / Math.max(1, Array.from(result).length),
                  )}cqw)`,
                }}
              >
                {result}
              </output>
            ) : (
              <p>
                {t(
                  names.length
                    ? "fcboard.rollcall_ready"
                    : "fcboard.namelist_empty",
                )}
              </p>
            )}
          </div>
          <footer>
            <button type="button" onClick={edit}>
              {t("fcboard.namelist")}
            </button>
            <button
              type="button"
              disabled={!names.length}
              onClick={() => {
                if (!rolling) {
                  index.current = Math.floor(Math.random() * names.length) - 1;
                }
                setRolling(!rolling);
              }}
            >
              {t(
                rolling
                  ? "fcboard.rollcall_stop"
                  : result
                  ? "fcboard.rollcall_resume"
                  : "fcboard.rollcall_start",
              )}
            </button>
          </footer>
        </>
      )}
    </MaterialPanel>
  ) : null;
};
