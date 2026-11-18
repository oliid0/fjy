import { useEffect, useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";
import { CloseIcon, settingsIcon } from "@fcboard/fcboard/components/icons";

import { nativeErrorMessage } from "./nativeErrorMessage";

import { MaterialPanel } from "./MaterialPanel";
import { classroomCommands } from "./commands";
import { namelistText, parseNamelist } from "./namelist";
import { importNamelist } from "./namelistImport";

import "./RollCall.scss";

import type { NamelistTable } from "./namelistData";

const storageKey = "fcboard-rollcall-names";
const loadNames = () => {
  try {
    return parseNamelist(localStorage.getItem(storageKey) || "");
  } catch {
    return [];
  }
};

/** The content surface toggles rolling; namelist edits persist immediately. */
export const RollCall = () => {
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState(loadNames);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const index = useRef(-1);
  const [tables, setTables] = useState<NamelistTable[]>([]);
  const [sheet, setSheet] = useState(0);
  const [column, setColumn] = useState(0);
  const [header, setHeader] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const cancelImport = () => {
    request.current?.abort();
    request.current = null;
    setBusy(false);
  };
  const close = () => {
    cancelImport();
    setRolling(false);
    setTables([]);
    setOpen(false);
  };
  useEffect(() => () => request.current?.abort(), []);
  useEffect(
    () =>
      classroomCommands.register(
        "tools.rollcall",
        "Open the centered roll-call window. args.open=false closes. Names are edited in its namelist settings.",
        (args) => {
          if (args.open !== undefined && typeof args.open !== "boolean") {
            throw new Error(t("fcboard.invalid_style_parameters"));
          }
          cancelImport();
          setTables([]);
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
    setDraft(namelistText(names));
    setSaved(false);
    setError("");
    setTables([]);
    setEditing(true);
  };
  const persist = (value: string) => {
    setDraft(value);
    setSaved(false);
    try {
      const next = parseNamelist(value);
      if (next.length > 5000 || next.some((name) => name.length > 80)) {
        throw new Error(t("fcboard.namelist_invalid"));
      }
      localStorage.setItem(storageKey, namelistText(next));
      setNames(next);
      setSaved(true);
      setResult("");
      index.current = -1;
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message === "namelist_invalid"
          ? t("fcboard.namelistImport.invalid")
          : failure instanceof Error
          ? failure.message
          : String(failure),
      );
    }
  };
  const choose = (
    source: NamelistTable[],
    nextSheet: number,
    nextColumn: number,
    nextHeader: boolean,
  ) => {
    setSheet(nextSheet);
    setColumn(nextColumn);
    setHeader(nextHeader);
    const rows = source[nextSheet].rows;
    persist(
      namelistText(
        rows
          .slice(nextHeader ? 1 : 0)
          .map((row) => row[nextColumn]?.trim() || "")
          .filter(Boolean),
      ),
    );
  };
  const chooseSheet = (source: NamelistTable[], nextSheet: number) => {
    const headings = source[nextSheet].rows[0] || [];
    const known = headings.findIndex((value) =>
      /^(?:姓名|名字|学生姓名|學生姓名|name|full name|student name)$/i.test(
        value.trim(),
      ),
    );
    choose(source, nextSheet, Math.max(0, known), known >= 0);
  };
  const readFile = async (file: File) => {
    cancelImport();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const source = await importNamelist(file, controller.signal);
      controller.signal.throwIfAborted();
      if (request.current !== controller) {
        return;
      }
      setTables(source);
      chooseSheet(source, 0);
    } catch (failure) {
      if (!controller.signal.aborted && request.current === controller) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  };
  const toggle = () => {
    if (!names.length) {
      return;
    }
    if (!rolling) {
      index.current = Math.floor(Math.random() * names.length) - 1;
    }
    setRolling(!rolling);
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
        <div className="fc-rollcall-header-actions">
          <button
            type="button"
            aria-label={t("fcboard.namelist")}
            aria-expanded={editing}
            onClick={() => {
              if (editing) {
                cancelImport();
                setTables([]);
                setEditing(false);
              } else {
                edit();
              }
            }}
          >
            {settingsIcon}
          </button>
          <button type="button" aria-label={t("buttons.close")} onClick={close}>
            {CloseIcon}
          </button>
        </div>
      </header>
      {editing ? (
        <section className="fc-rollcall-editor">
          <label htmlFor="fc-rollcall-names">
            {t("fcboard.namelist_hint")}
          </label>
          <textarea
            id="fc-rollcall-names"
            value={draft}
            onChange={(event) => {
              cancelImport();
              persist(event.target.value);
            }}
            maxLength={400000}
          />
          <p className="fc-rollcall-import-hint">
            {t("fcboard.namelistImport.formats")}
          </p>
          {tables.length > 0 && (
            <div className="fc-rollcall-import-fields">
              {tables.length > 1 && (
                <label>
                  {t("fcboard.namelistImport.sheet")}
                  <select
                    value={sheet}
                    onChange={(event) =>
                      chooseSheet(tables, Number(event.target.value))
                    }
                  >
                    {tables.map((table, i) => (
                      <option key={i} value={i}>
                        {table.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                {t("fcboard.namelistImport.column")}
                <select
                  value={column}
                  onChange={(event) =>
                    choose(tables, sheet, Number(event.target.value), header)
                  }
                >
                  {Array.from(
                    {
                      length: Math.max(
                        ...tables[sheet].rows.map((row) => row.length),
                      ),
                    },
                    (_, i) => (
                      <option key={i} value={i}>
                        {t("fcboard.namelistImport.columnNumber", {
                          column: i + 1,
                        })}
                        {header && tables[sheet].rows[0][i]
                          ? `: ${tables[sheet].rows[0][i]}`
                          : ""}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className="fc-rollcall-header-check">
                <input
                  type="checkbox"
                  checked={header}
                  onChange={(event) =>
                    choose(tables, sheet, column, event.target.checked)
                  }
                />
                {t("fcboard.namelistImport.header")}
              </label>
            </div>
          )}
          {busy ? (
            <p role="status">{t("fcboard.namelistImport.loading")}</p>
          ) : error ? (
            <p role="alert">{nativeErrorMessage(error)}</p>
          ) : saved ? (
            <p role="status">{t("fcboard.namelistImport.saved")}</p>
          ) : null}
          <input
            ref={input}
            type="file"
            hidden
            aria-label={t("fcboard.namelistImport.importFile")}
            accept=".xlsx,.csv,.tsv,.txt,.text,.md,.markdown"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) {
                void readFile(file);
              }
            }}
          />
          <footer>
            <button
              type="button"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {t("fcboard.namelistImport.importFile")}
            </button>
            <button
              type="button"
              disabled={!!error}
              onClick={() => {
                cancelImport();
                setTables([]);
                setEditing(false);
              }}
            >
              {t("buttons.done")}
            </button>
          </footer>
        </section>
      ) : (
        <>
          <button
            type="button"
            className="fc-rollcall-stage"
            data-rolling={rolling}
            aria-label={t("fcboard.roll_call")}
            aria-pressed={rolling}
            disabled={!names.length}
            onClick={toggle}
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
          </button>
        </>
      )}
    </MaterialPanel>
  ) : null;
};
