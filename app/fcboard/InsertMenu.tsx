import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ToolbarExtras } from "@excalidraw/excalidraw";
import { FactoryIcon } from "@excalidraw/excalidraw/components/FactoryIcon";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { TransientMessage } from "./TransientMessage";

import { MaterialPanel } from "./MaterialPanel";

import { classroomCommands } from "./commands";
import { insertionPoint } from "./board";
import {
  configureInsertion,
  insertionDefaults,
  readInsertions,
  renderInsertion,
} from "./insertObjects";
import { Classroom } from "./native";
import { useAnchoredPanel } from "./floating";
import { TableSizePicker } from "./TableSizePicker";

import type { FactoryInsertion } from "./native";
import type { InsertKind, InsertObject } from "./insertObjects";

const names = {
  website: "website",
  mindmap: "mind_map",
  table: "table",
  fourline: "four_line_grid",
  document: "document",
  media: "media",
  signal: "signal",
  resources: "teaching_resources",
} as const;
type MenuKind = keyof typeof names;

export const InsertMenu = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  useI18n();
  const [form, setForm] = useState<InsertKind | "website" | null>(null);
  const [draft, setDraft] = useState<InsertObject>(() =>
    insertionDefaults("table", { x: 0, y: 0 }),
  );
  const [url, setUrl] = useState("");
  const [available, setAvailable] = useState<FactoryInsertion[]>([]);
  const [loading, setLoading] = useState(Capacitor.isNativePlatform);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<InsertObject>();
  const selectedRef = useRef<InsertObject | undefined>(undefined);
  const previousSelection = useRef("");
  const panel = useRef<HTMLElement>(null);
  const style = useAnchoredPanel(panel, "[data-board-insert]", !!form);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    let disposed = false;
    Classroom.getFactoryInsertions()
      .then((result) => {
        if (!disposed) {
          setAvailable(result.available || []);
        }
      })
      .catch((failure) => {
        if (!disposed) {
          setError(
            t("fcboard.could_not_read_insertion_apps_error", {
              error: String(failure),
            }),
          );
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    const refresh = () => {
      const document = classroomCommands.read("document") as
        | {
            selection?: string[];
            ink: { id: string; insertion?: InsertObject }[];
          }
        | undefined;
      const state = api.getAppState();
      const ids = document
        ? new Set(
            document.ink
              .filter((stroke) => document.selection?.includes(stroke.id))
              .map((stroke) => stroke.insertion?.id)
              .filter(Boolean),
          )
        : new Set(
            api
              .getSceneElements()
              .filter((element) => state.selectedElementIds[element.id])
              .map((element) => element.customData?.fcInsertion?.id)
              .filter(Boolean),
          );
      const object =
        ids.size === 1
          ? readInsertions(api).find((object) => ids.has(object.id))
          : undefined;
      selectedRef.current = object;
      setSelected((previous) =>
        JSON.stringify(previous) === JSON.stringify(object) ? previous : object,
      );
      if ((object?.id || "") !== previousSelection.current) {
        previousSelection.current = object?.id || "";
        if (object && ["selection", "custom"].includes(state.activeTool.type)) {
          setDraft(object);
          setForm(object.kind);
        } else {
          setForm(null);
        }
      }
      if (state.toolbarHidden || state.activeTool.type === "lasso") {
        setForm(null);
      }
    };
    const stop = api.onChange(refresh);
    const documentChanged = classroomCommands.watch("document", refresh);
    refresh();
    return () => {
      stop();
      documentChanged();
    };
  }, [api]);
  const create = async (kind: InsertKind, args: Record<string, unknown>) => {
    const position = classroomCommands.has("document.draw")
      ? { x: 60, y: 60 }
      : insertionPoint(api);
    const base = insertionDefaults(kind, position);
    if (kind === "fourline") {
      const state = api.getAppState();
      base.width = Math.max(80, state.width / state.zoom.value / 5);
      base.height = Math.max(40, state.height / state.zoom.value / 5);
    }
    const object = configureInsertion(base, args);
    await renderInsertion(api, object);
    if (kind === "fourline" || kind === "mindmap") {
      setForm(null);
      if (classroomCommands.has("document.tool")) {
        await classroomCommands.execute({
          name: "document.tool",
          args: { tool: "freedraw" },
        });
      } else {
        api.updateScene({
          appState: { selectedElementIds: {}, selectedGroupIds: {} },
        });
        api.setActiveTool({ type: "freedraw" });
      }
    } else {
      api.setActiveTool({ type: "selection" });
    }
    return { id: object.id, kind };
  };
  const open = async (kind: unknown) => {
    if (typeof kind !== "string" || !(kind in names)) {
      throw new Error(t("fcboard.this_insertion_type_is_unavailable"));
    }
    setError("");
    if (kind === "resources") {
      return classroomCommands.execute({ name: "resources.open" });
    }
    if (kind === "fourline" || kind === "mindmap") {
      return create(kind, {});
    }
    if (kind === "document" || kind === "media" || kind === "signal") {
      if (available.includes(kind)) {
        return Classroom.openFactoryInsertion({ insertion: kind });
      }
      if (kind === "signal") {
        throw new Error(
          t("fcboard.the_signal_app_is_not_installed_on_this_display"),
        );
      }
      return classroomCommands.execute({ name: "files.open" });
    }
    if (kind !== "website") {
      setDraft(
        insertionDefaults(
          kind as InsertKind,
          classroomCommands.has("document.draw")
            ? { x: 60, y: 60 }
            : insertionPoint(api),
        ),
      );
    }
    setForm(kind as InsertKind | "website");
  };
  useEffect(() => {
    const stops = [
      classroomCommands.register(
        "insert.open",
        "打开原插入操作，args.kind=website|mindmap|table|fourline|document|media|signal|resources；文档/媒体优先原厂应用，缺失时打开本机课件",
        (args) => open(args.kind),
      ),
      classroomCommands.register(
        "insert.object",
        "Insert an editable object: args.kind=table|mindmap|fourline. Tables accept rows, columns and cells (row-major strings); mind maps accept outline (one node per line, two-space indentation); four-line paper accepts text. width and height are optional.",
        async (args) => {
          if (!["table", "mindmap", "fourline"].includes(String(args.kind))) {
            throw new Error(t("fcboard.this_object_is_unavailable"));
          }
          return create(args.kind as InsertKind, args);
        },
      ),
      classroomCommands.register(
        "insert.configure",
        "Update an existing insertion by args.id or current selection. Accepts rows, columns, cells, outline, text, width and height; preserves existing text when omitted. Use text to edit four-line paper and outline to edit mind-map labels.",
        async (args) => {
          const object =
            typeof args.id === "string"
              ? readInsertions(api).find((object) => object.id === args.id)
              : selectedRef.current;
          if (!object) {
            throw new Error(
              t("fcboard.select_a_table_mind_map_or_four_line_grid_first"),
            );
          }
          await renderInsertion(api, configureInsertion(object, args));
        },
      ),
      classroomCommands.context("insertions", () => ({
        selected: selectedRef.current?.id,
        objects: readInsertions(api),
        factory: available,
      })),
    ];
    return () => stops.forEach((stop) => stop());
  });
  const run = async (operation: () => Promise<unknown>) => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (failure) {
      setError(String(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <ToolbarExtras placement="insert">
        {(Object.keys(names) as MenuKind[]).map((kind) => (
          <button
            key={kind}
            data-close-insert
            type="button"
            disabled={
              busy ||
              (kind === "signal" && (loading || !available.includes("signal")))
            }
            title={
              kind === "signal" && !available.includes("signal")
                ? t("fcboard.no_signal_app_is_available_on_this_display")
                : t(`fcboard.${names[kind]}`)
            }
            onClick={() =>
              void run(() =>
                classroomCommands.execute({
                  name: "insert.open",
                  args: { kind },
                }),
              )
            }
          >
            <FactoryIcon name={kind} />
            <span>{t(`fcboard.${names[kind]}`)}</span>
          </button>
        ))}
      </ToolbarExtras>
      <TransientMessage
        message={error}
        role="alert"
        className="fc-insert-error fc-surface"
      />
      {form && (
        <MaterialPanel
          ref={panel}
          className="fc-insertion-properties fc-surface"
          role="dialog"
          aria-label={t(`fcboard.${names[form]}`)}
          style={style}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              setForm(null);
            }
          }}
        >
          <header>
            <strong>{t(`fcboard.${names[form]}`)}</strong>
            <button onClick={() => setForm(null)}>
              {t("fcboard.close")}
              {t(`fcboard.${names[form]}`)}
            </button>
          </header>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                if (form === "website") {
                  await classroomCommands.execute({
                    name: "web.open",
                    args: { url },
                  });
                } else {
                  await renderInsertion(api, draft);
                  api.setActiveTool({ type: "selection" });
                }
                setForm(null);
              });
            }}
          >
            {form === "website" ? (
              <label>
                {t("fcboard.website_address")}
                <input
                  type="url"
                  required
                  value={url}
                  placeholder="https://"
                  onChange={(event) => setUrl(event.target.value)}
                />
              </label>
            ) : (
              <>
                {form === "table" && (
                  <>
                    <TableSizePicker
                      rows={draft.rows}
                      columns={draft.columns}
                      disabled={busy}
                      onSelect={
                        selected?.id === draft.id
                          ? undefined
                          : (rows, columns) =>
                              void run(async () => {
                                await renderInsertion(
                                  api,
                                  configureInsertion(draft, { rows, columns }),
                                );
                                api.setActiveTool({ type: "selection" });
                                setForm(null);
                              })
                      }
                      onChange={(rows, columns) =>
                        setDraft((current) =>
                          configureInsertion(current, { rows, columns }),
                        )
                      }
                    />
                    {selected?.id === draft.id && (
                      <details>
                        <summary>{t("fcboard.apply_changes")}</summary>
                        <label>
                          {t("fcboard.rows")}
                          <input
                            type="number"
                            min="1"
                            max="12"
                            value={draft.rows}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              if (value >= 1 && value <= 12) {
                                setDraft((current) =>
                                  configureInsertion(current, { rows: value }),
                                );
                              }
                            }}
                          />
                        </label>
                        <label>
                          {t("fcboard.columns")}
                          <input
                            type="number"
                            min="1"
                            max="12"
                            value={draft.columns}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              if (value >= 1 && value <= 12) {
                                setDraft((current) =>
                                  configureInsertion(current, {
                                    columns: value,
                                  }),
                                );
                              }
                            }}
                          />
                        </label>
                        <label>
                          {t(
                            "fcboard.cells_one_row_per_line_columns_separated_by_tabs",
                          )}
                          <textarea
                            value={Array.from(
                              { length: draft.rows },
                              (_, row) =>
                                Array.from(
                                  { length: draft.columns },
                                  (_, column) =>
                                    draft.cells[row * draft.columns + column] ||
                                    "",
                                ).join("\t"),
                            ).join("\n")}
                            onChange={(event) => {
                              const rows = event.target.value
                                .split("\n")
                                .map((row) => row.split("\t"));
                              setDraft((current) => ({
                                ...current,
                                cells: Array.from(
                                  { length: current.rows * current.columns },
                                  (_, index) =>
                                    rows[Math.floor(index / current.columns)]?.[
                                      index % current.columns
                                    ] || "",
                                ),
                              }));
                            }}
                          />
                        </label>
                      </details>
                    )}
                  </>
                )}
                {form === "mindmap" && (
                  <label>
                    {t("fcboard.outline_indent_each_level_by_two_spaces")}
                    <textarea
                      value={draft.outline}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          outline: event.target.value,
                        }))
                      }
                    />
                  </label>
                )}
                {form !== "mindmap" &&
                  (form !== "table" || selected?.id === draft.id) && (
                    <>
                      <label>
                        {t("fcboard.width")}
                        <input
                          type="number"
                          min="80"
                          max="1600"
                          value={draft.width}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              width: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <label>
                        {t("fcboard.height")}
                        <input
                          type="number"
                          min="40"
                          max="1200"
                          value={draft.height}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              height: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                    </>
                  )}
              </>
            )}
            <button type="submit" disabled={busy}>
              {busy
                ? t("fcboard.applying")
                : form === "website"
                ? t("fcboard.open_website")
                : selected?.id === draft.id
                ? t("fcboard.apply_changes")
                : t("fcboard.insert_into_board")}
            </button>
          </form>
        </MaterialPanel>
      )}
    </>
  );
};
