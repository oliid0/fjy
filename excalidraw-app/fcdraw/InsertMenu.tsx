import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ToolbarExtras } from "@excalidraw/excalidraw";
import { FactoryIcon } from "@excalidraw/excalidraw/components/FactoryIcon";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

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

import type { FactoryInsertion } from "./native";
import type { InsertKind, InsertObject } from "./insertObjects";

const names = {
  website: "网页",
  mindmap: "思维导图",
  table: "表格",
  fourline: "四线格",
  document: "文档",
  media: "多媒体",
  signal: "信号源",
  resources: "教学资源",
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
            t("fcboard.无法读取插入应用：{{error}}", {
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
        if (object && state.activeTool.type !== "lasso") {
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
    api.setActiveTool({ type: "selection" });
    return { id: object.id, kind };
  };
  const open = async (kind: unknown) => {
    if (typeof kind !== "string" || !(kind in names)) {
      throw new Error(t("fcboard.插入类型不存在"));
    }
    setError("");
    if (kind === "resources") {
      return classroomCommands.execute({ name: "resources.open" });
    }
    if (kind === "fourline") {
      return create(kind, {});
    }
    if (kind === "document" || kind === "media" || kind === "signal") {
      if (available.includes(kind)) {
        return Classroom.openFactoryInsertion({ insertion: kind });
      }
      if (kind === "signal") {
        throw new Error(t("fcboard.当前设备未安装信号源应用"));
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
        "直接插入可编辑对象，args.kind=table|mindmap|fourline；表格可带rows,columns,cells(逐行字符串数组)，思维导图带outline(每行一个节点，每两空格表示一层)，width,height可选",
        async (args) => {
          if (!["table", "mindmap", "fourline"].includes(String(args.kind))) {
            throw new Error(t("fcboard.此插入对象不存在"));
          }
          return create(args.kind as InsertKind, args);
        },
      ),
      classroomCommands.register(
        "insert.configure",
        "修改原插入对象，可带args.id，否则修改选中对象；支持rows,columns,cells,outline,width,height，保留已编辑文字",
        async (args) => {
          const object =
            typeof args.id === "string"
              ? readInsertions(api).find((object) => object.id === args.id)
              : selectedRef.current;
          if (!object) {
            throw new Error(t("fcboard.请先选择表格、思维导图或四线格"));
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
                ? t("fcboard.当前设备未提供信号源应用")
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
      {error && (
        <div className="fc-insert-error fc-surface" role="alert">
          {error}
          <button onClick={() => setError("")}>{t("fcboard.关闭提示")}</button>
        </div>
      )}
      {form && (
        <section
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
              {t("fcboard.关闭")}
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
                {t("fcboard.网页地址")}
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
                    <label>
                      {t("fcboard.行数")}
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
                      {t("fcboard.列数")}
                      <input
                        type="number"
                        min="1"
                        max="12"
                        value={draft.columns}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (value >= 1 && value <= 12) {
                            setDraft((current) =>
                              configureInsertion(current, { columns: value }),
                            );
                          }
                        }}
                      />
                    </label>
                    <label>
                      {t("fcboard.单元格内容（每行一行，列以 Tab 分隔）")}
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
                  </>
                )}
                {form === "mindmap" && (
                  <label>
                    {t("fcboard.导图大纲（每两空格缩进一层）")}
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
                {form !== "mindmap" && (
                  <>
                    <label>
                      {t("fcboard.宽度")}
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
                      {t("fcboard.高度")}
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
                ? t("fcboard.正在应用…")
                : form === "website"
                ? t("fcboard.打开网页")
                : selected?.id === draft.id
                ? t("fcboard.应用修改")
                : t("fcboard.插入白板")}
            </button>
          </form>
        </section>
      )}
    </>
  );
};
