import {
  createElement,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { t, useI18n } from "@fcboard/fcboard/i18n";

import type { TranslationKeys } from "@fcboard/fcboard/i18n";

import { MaterialPanel } from "./MaterialPanel";
import { TransientMessage } from "./TransientMessage";
import {
  functionPresets,
  nextFunctionColor,
  defaultGraphTransform,
  clampGraph,
  zoomGraph,
  sampleSourceFunction,
  validSourceFunction,
  functionGraphNodes,
} from "./functionGraphData";

import "./OriginalResourceTools.scss";

import type {
  FunctionGraphData,
  FunctionItem,
  GraphTransform,
} from "./functionGraphData";

/** FunctionGraphDialogFragment and FunctionGraphView; not the AI function pen. */
export const FactoryFunctionGraph = ({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (graph: FunctionGraphData) => Promise<unknown>;
}) => {
  useI18n();
  const [functions, setFunctions] = useState<FunctionItem[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [view, setView] = useState<GraphTransform>(defaultGraphTransform);
  const [size, setSize] = useState({ width: 558, height: 581 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1000);
  const preview = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragging = useRef(false);
  const alive = useRef(true);
  const pending = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    const measure = () => {
      const rect = preview.current?.getBoundingClientRect();
      if (rect?.width && rect.height) {
        const width = Math.max(200, Math.min(4096, Math.round(rect.width)));
        const height = Math.max(180, Math.min(4096, Math.round(rect.height)));
        setSize((current) =>
          current.width === width && current.height === height
            ? current
            : { width, height },
        );
        setView((current) => clampGraph(current, width, height));
      }
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    if (preview.current) {
      observer?.observe(preview.current);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => {
      alive.current = false;
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const samples = useMemo(
    () => functions.map(sampleSourceFunction),
    [functions],
  );
  const nodes = useMemo(
    () => functionGraphNodes({ ...size, ...view }, samples),
    [size, view, samples],
  );
  const rebuild = (items: FunctionItem[]) => {
    setFunctions(items);
    setDrafts(
      Object.fromEntries(items.map((item) => [item.id, item.expression])),
    );
    setErrors({});
  };
  const add = (id: number, name: string, expression: string) => {
    rebuild(
      functions.some((item) => item.id === id)
        ? functions
        : [
            ...functions,
            { id, name, expression, color: nextFunctionColor(functions) },
          ],
    );
  };
  const insert = async () => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await onInsert({
        ...size,
        ...clampGraph(view, size.width, size.height),
        functions,
      });
      if (alive.current) {
        onClose();
      }
    } catch (failure) {
      if (alive.current && (failure as Error)?.name !== "AbortError") {
        setError(String(failure));
      }
    } finally {
      pending.current = false;
      if (alive.current) {
        setBusy(false);
      }
    }
  };
  const endPointer = (id: number) => {
    pointers.current.delete(id);
    if (!pointers.current.size) {
      dragging.current = false;
    }
  };
  return (
    <MaterialPanel
      centered
      className="fc-original-resource-tool fc-function-graph"
      role="dialog"
      aria-label={t("fcboard.functionGraph.title")}
      onDismiss={onClose}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          onClose();
        }
      }}
    >
      <nav aria-label={t("fcboard.functionGraph.types")}>
        <strong>{t("fcboard.functionGraph.types")}</strong>
        {functionPresets.map((preset) => (
          <button
            key={preset.id}
            disabled={busy}
            onClick={() =>
              add(
                preset.id,
                t(`fcboard.functionGraph.${preset.key}` as TranslationKeys),
                preset.expression,
              )
            }
          >
            {t(`fcboard.functionGraph.${preset.key}` as TranslationKeys)}
          </button>
        ))}
      </nav>
      <section className="fc-function-preview">
        <header>
          <strong>{t("fcboard.functionGraph.preview")}</strong>
          <p>{t("fcboard.functionGraph.viewHint")}</p>
        </header>
        <div ref={preview}>
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${size.width} ${size.height}`}
            fontFamily="sans-serif"
            role="img"
            aria-label={t("fcboard.functionGraph.preview")}
            tabIndex={0}
            onDoubleClick={() => setView(defaultGraphTransform)}
            onKeyDown={(event) => {
              const delta: Record<string, [number, number]> = {
                ArrowLeft: [-20, 0],
                ArrowRight: [20, 0],
                ArrowUp: [0, -20],
                ArrowDown: [0, 20],
              };
              if (delta[event.key]) {
                event.preventDefault();
                const [x, y] = delta[event.key];
                setView((current) =>
                  clampGraph(
                    { ...current, x: current.x + x, y: current.y + y },
                    size.width,
                    size.height,
                  ),
                );
              } else if (event.key === "Home") {
                event.preventDefault();
                setView(defaultGraphTransform);
              }
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 || busy) {
                return;
              }
              const rect = event.currentTarget.getBoundingClientRect();
              pointers.current.set(event.pointerId, {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
              });
              dragging.current = pointers.current.size === 1;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const previous = pointers.current.get(event.pointerId);
              if (!previous || busy) {
                return;
              }
              const rect = event.currentTarget.getBoundingClientRect();
              const point = {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
              };
              const other = Array.from(pointers.current.entries()).find(
                ([id]) => id !== event.pointerId,
              )?.[1];
              pointers.current.set(event.pointerId, point);
              if (pointers.current.size === 2 && other) {
                const before = Math.hypot(
                  previous.x - other.x,
                  previous.y - other.y,
                );
                if (before > 0) {
                  setView((current) =>
                    zoomGraph(
                      current,
                      size.width,
                      size.height,
                      (point.x + other.x) / 2,
                      (point.y + other.y) / 2,
                      Math.hypot(point.x - other.x, point.y - other.y) / before,
                    ),
                  );
                }
              } else if (pointers.current.size === 1 && dragging.current) {
                setView((current) =>
                  clampGraph(
                    {
                      ...current,
                      x: current.x + point.x - previous.x,
                      y: current.y + point.y - previous.y,
                    },
                    size.width,
                    size.height,
                  ),
                );
              }
            }}
            onPointerUp={(event) => {
              endPointer(event.pointerId);
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={(event) => endPointer(event.pointerId)}
            onLostPointerCapture={(event) => endPointer(event.pointerId)}
          >
            {nodes.map(({ tag, attrs, text }, index) =>
              createElement(tag, { ...attrs, key: index }, text),
            )}
          </svg>
        </div>
      </section>
      <section className="fc-function-editor">
        <header>
          <strong>{t("fcboard.functionGraph.editArea")}</strong>
          <p>{t("fcboard.functionGraph.editHint")}</p>
        </header>
        <div className="fc-function-added">
          <strong>{t("fcboard.functionGraph.added")}</strong>
          <button
            disabled={busy}
            onClick={() => {
              const id = nextId.current++;
              add(
                id,
                t("fcboard.functionGraph.customName", { number: id - 999 }),
                "x",
              );
            }}
          >
            {t("fcboard.functionGraph.addCustom")}
          </button>
        </div>
        <div className="fc-function-list">
          {functions.map((item) => (
            <section key={item.id} aria-label={item.name}>
              <div className="fc-function-item-heading">
                <span style={{ background: item.color }} />
                <span>{item.name}</span>
                <button
                  disabled={busy}
                  aria-label={t("fcboard.functionGraph.deleteNamed", {
                    name: item.name,
                  })}
                  onClick={() =>
                    rebuild(functions.filter((fn) => fn.id !== item.id))
                  }
                >
                  {t("labels.delete")}
                </button>
              </div>
              <label>
                {t("fcboard.functionGraph.expression")}
                <input
                  disabled={busy}
                  maxLength={500}
                  value={drafts[item.id] ?? item.expression}
                  placeholder={t("fcboard.functionGraph.enterExpression")}
                  aria-label={t("fcboard.functionGraph.expressionNamed", {
                    name: item.name,
                  })}
                  aria-invalid={!!errors[item.id]}
                  onChange={(event) =>
                    setDrafts({ ...drafts, [item.id]: event.target.value })
                  }
                />
              </label>
              {errors[item.id] && <p role="alert">{errors[item.id]}</p>}
              <small>
                {t("fcboard.functionGraph.example")}:{" "}
                {t("fcboard.functionGraph.formula")}
              </small>
              <div className="fc-function-generate">
                <button
                  disabled={busy}
                  onClick={() => {
                    const expression = (
                      drafts[item.id] ?? item.expression
                    ).trim();
                    if (!expression || !validSourceFunction(expression)) {
                      setErrors({
                        ...errors,
                        [item.id]: t(
                          expression
                            ? "fcboard.functionGraph.invalidExpression"
                            : "fcboard.functionGraph.enterExpression",
                        ),
                      });
                      return;
                    }
                    setErrors({ ...errors, [item.id]: "" });
                    setFunctions((current) =>
                      current.map((fn) =>
                        fn.id === item.id ? { ...fn, expression } : fn,
                      ),
                    );
                  }}
                >
                  {t("fcboard.functionGraph.generate")}
                </button>
              </div>
            </section>
          ))}
        </div>
        <TransientMessage message={error} role="alert" />
        <footer>
          <button disabled={busy} onClick={() => rebuild([])}>
            {t("fcboard.functionGraph.clear")}
          </button>
          <button
            className="fc-resource-primary"
            disabled={busy}
            onClick={() => void insert()}
          >
            {busy
              ? t("fcboard.opening_resource")
              : t("fcboard.functionGraph.insert")}
          </button>
        </footer>
      </section>
      <button
        className="fc-function-close"
        aria-label={t("buttons.close")}
        onClick={onClose}
      >
        ×
      </button>
    </MaterialPanel>
  );
};
