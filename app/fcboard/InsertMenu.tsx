import { getLanguage, t, useI18n } from "@fcboard/fcboard/i18n";
import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ToolbarExtras } from "@fcboard/fcboard";
import { FactoryIcon } from "@fcboard/fcboard/components/FactoryIcon";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { TransientMessage } from "./TransientMessage";

import { MaterialPanel } from "./MaterialPanel";

import { classroomCommands } from "./commands";
import { insertionPoint } from "./board";
import {
  configureInsertion,
  insertionDefaults,
  readInsertions,
  renderInsertion,
  changeTableTrack,
} from "./insertObjects";
import { Classroom } from "./native";
import { useAnchoredPanel } from "./floating";
import { TableSizePicker } from "./TableSizePicker";
import { InsertionPlacement } from "./InsertionPlacement";

import type { FactoryInsertion } from "./native";
import type { InsertKind, InsertObject } from "./insertObjects";
import type { TableTrackAction } from "./insertObjects";
import type { ContentRect } from "./placement";

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

export const InsertMenu = ({ api }: { api: FcboardImperativeAPI }) => {
  useI18n();
  const [form, setForm] = useState<InsertKind | null>(null);
  const [draft, setDraft] = useState<InsertObject>(() =>
    insertionDefaults("table", { x: 0, y: 0 }),
  );
  const [available, setAvailable] = useState<FactoryInsertion[]>([]);
  const [loading, setLoading] = useState(Capacitor.isNativePlatform);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<InsertObject>();
  const [placing, setPlacing] = useState<InsertObject>();
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
        setForm(null);
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
  const newInsertion = (kind: InsertKind) => {
    const document =
      !!classroomCommands.read("document") ||
      classroomCommands.has("document.draw");
    const viewport = document
      ? (
          classroomCommands.read("document.layout") as
            | { viewport?: ContentRect }
            | undefined
        )?.viewport
      : undefined;
    const visible =
      viewport &&
      [viewport.left, viewport.top, viewport.right, viewport.bottom].every(
        Number.isFinite,
      ) &&
      viewport.right > viewport.left &&
      viewport.bottom > viewport.top
        ? viewport
        : undefined;
    const base = insertionDefaults(
      kind,
      document ? { x: 60, y: 60 } : insertionPoint(api),
    );
    base.color =
      (
        classroomCommands.read("document") as
          | { pen?: { color: string } }
          | undefined
      )?.pen?.color ||
      api.getAppState().currentItemStrokeColor ||
      "#333333";
    if (kind === "fourline") {
      if (visible) {
        base.width = Math.max(
          80,
          Math.min(1600, (visible.right - visible.left) / 5),
        );
        base.height = Math.max(
          40,
          Math.min(1200, (visible.bottom - visible.top) / 5),
        );
      } else if (!document) {
        const state = api.getAppState();
        base.width = Math.max(80, state.width / state.zoom.value / 5);
        base.height = Math.max(40, state.height / state.zoom.value / 5);
      }
    }
    if (visible) {
      base.position = {
        x:
          visible.left +
          Math.min(60, Math.max(0, visible.right - visible.left - base.width)),
        y:
          visible.top +
          Math.min(60, Math.max(0, visible.bottom - visible.top - base.height)),
      };
    }
    return base;
  };
  const create = async (kind: InsertKind, args: Record<string, unknown>) => {
    const signal =
      args.signal instanceof AbortSignal
        ? args.signal
        : classroomCommands.interactionSource;
    signal?.throwIfAborted();
    const revision = classroomCommands.revision;
    const base = newInsertion(kind);
    const object = configureInsertion(base, args);
    await renderInsertion(api, object);
    signal?.throwIfAborted();
    if (!classroomCommands.isCurrent(revision, signal)) {
      throw new DOMException("Insertion surface changed", "AbortError");
    }
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
  const open = async (
    kind: unknown,
    signal = classroomCommands.interactionSource,
  ) => {
    signal?.throwIfAborted();
    if (typeof kind !== "string" || !(kind in names)) {
      throw new Error(t("fcboard.this_insertion_type_is_unavailable"));
    }
    setError("");
    if (kind === "resources") {
      return classroomCommands.execute({ name: "resources.open" });
    }
    if (kind === "website") {
      setForm(null);
      return classroomCommands.execute({
        name: "web.open",
        args: {
          url:
            getLanguage().code === "zh-CN"
              ? "https://image.baidu.com/search/index?tn=baiduimage&word=壁纸"
              : "https://www.google.com/",
          signal,
        },
      });
    }
    if (kind === "fourline" || kind === "mindmap") {
      return create(kind, { signal });
    }
    if (kind === "document" || kind === "media" || kind === "signal") {
      if (kind === "signal") {
        if (available.includes(kind)) {
          return Classroom.openFactoryInsertion({
            insertion: kind,
            language: getLanguage().code,
          });
        }
        throw new Error(
          t("fcboard.the_signal_app_is_not_installed_on_this_display"),
        );
      }
      return classroomCommands.execute({
        name: "files.open",
        args: { signal },
      });
    }
    if (kind !== "website") {
      setDraft(newInsertion(kind as InsertKind));
    }
    setForm(kind as InsertKind);
  };
  useEffect(() => {
    const stops = [
      classroomCommands.register(
        "insert.open",
        "Open an insertion: args.kind=website|mindmap|table|fourline|document|media|signal|resources. Documents and media open in the internal file viewer; signal uses the available display input app.",
        (args) =>
          open(
            args.kind,
            args.signal instanceof AbortSignal ? args.signal : undefined,
          ),
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
        "table.track",
        "Change the last row or column of an existing table. args.action=row.add|row.remove|column.add|column.remove, args.id is the table ID (or use the current selection). Appends a track of the current average size; removes only the last edge and preserves writing. At least one row and column remain. Reads and updates the visible board or courseware and supports undo.",
        async (args) => {
          const signal =
            args.signal instanceof AbortSignal ? args.signal : undefined;
          signal?.throwIfAborted();
          if (
            !["row.add", "row.remove", "column.add", "column.remove"].includes(
              String(args.action),
            )
          ) {
            throw new Error(t("fcboard.invalid_insertion_data"));
          }
          const object =
            typeof args.id === "string"
              ? readInsertions(api).find((item) => item.id === args.id)
              : selectedRef.current;
          if (!object || object.kind !== "table") {
            throw new Error(
              t("fcboard.select_a_table_mind_map_or_four_line_grid_first"),
            );
          }
          const next = changeTableTrack(
            object,
            args.action as TableTrackAction,
          );
          await renderInsertion(api, next, true, {
            exact: true,
            preserveSelection: true,
          });
          signal?.throwIfAborted();
          return {
            id: next.id,
            rows: next.rows,
            columns: next.columns,
            width: next.width,
            height: next.height,
          };
        },
      ),
      classroomCommands.register(
        "insert.configure",
        "Update an existing insertion by args.id or current selection. Accepts rows, columns, cells, columnWidths, rowHeights, outline, nodePositions (relative x/y or null per node), nodeSize (width/height), text, width and height; preserves existing text when omitted. Use text to edit four-line paper and outline to edit mind-map labels. Read actual insertions context before modifying individual nodes or table tracks.",
        async (args) => {
          const signal =
            args.signal instanceof AbortSignal ? args.signal : undefined;
          signal?.throwIfAborted();
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
          signal?.throwIfAborted();
          return { id: object.id, kind: object.kind };
        },
      ),
      classroomCommands.context("insertions", () => ({
        selected: selectedRef.current?.id,
        objects: readInsertions(api),
        factory: available,
      })),
    ];
    if (Capacitor.isNativePlatform()) {
      stops.push(
        classroomCommands.register(
          "signal.action",
          "Inspect or control the embedded display input: args.action=read|select|reload|reset|close (default read). Read lists real input IDs, connection states and video state. Select requires an exact id from read. Open first with insert.open kind=signal. External OEM signal apps cannot be controlled by this command; an unopened input rejects select/reload/reset.",
          async (args) => {
            const action = args.action ?? "read";
            if (
              typeof action !== "string" ||
              !["read", "select", "reload", "reset", "close"].includes(
                action,
              ) ||
              (action === "select" &&
                (typeof args.id !== "string" || !args.id.trim())) ||
              (args.id !== undefined && typeof args.id !== "string")
            ) {
              throw new Error("Invalid signal source action or input ID");
            }
            const signal =
              args.signal instanceof AbortSignal ? args.signal : undefined;
            signal?.throwIfAborted();
            const result = await Classroom.signalAction({
              action: action as Parameters<
                typeof Classroom.signalAction
              >[0]["action"],
              id: args.id as string | undefined,
              language: getLanguage().code,
            });
            signal?.throwIfAborted();
            return result;
          },
        ),
      );
    }
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
      {placing && (
        <InsertionPlacement
          api={api}
          object={placing}
          onFinish={() => setPlacing(undefined)}
          onError={(failure) => setError(String(failure))}
        />
      )}
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
          className={`fc-insertion-properties fc-surface${
            form === "table" && selected?.id !== draft.id
              ? " fc-table-insertion"
              : ""
          }`}
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
                if (form === "table" && selected?.id !== draft.id) {
                  api.setActiveTool({
                    type: "custom",
                    customType: "factory-insertion:table",
                  });
                  setPlacing(draft);
                } else {
                  await renderInsertion(api, draft);
                  api.setActiveTool({ type: "selection" });
                }
                setForm(null);
              });
            }}
          >
            {form === "table" && (
              <>
                <TableSizePicker
                  rows={draft.rows}
                  columns={draft.columns}
                  disabled={busy}
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
                        value={Array.from({ length: draft.rows }, (_, row) =>
                          Array.from(
                            { length: draft.columns },
                            (_, column) =>
                              draft.cells[row * draft.columns + column] || "",
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
            <button type="submit" disabled={busy}>
              {busy
                ? t("fcboard.applying")
                : selected?.id === draft.id
                ? t("fcboard.apply_changes")
                : form === "table"
                ? t("buttons.confirm")
                : t("fcboard.insert_into_board")}
            </button>
          </form>
        </MaterialPanel>
      )}
    </>
  );
};
