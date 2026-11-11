import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";

import { FactoryIcon } from "@fcboard/fcboard/components/FactoryIcon";

import { MaterialPanel } from "./MaterialPanel";

import { classroomCommands } from "./commands";
import { savePageFiles } from "./boardFile";
import { useAnchoredPanel } from "./floating";

import "./SplitBoard.scss";

type Point = [number, number];
type Stroke = {
  points: Point[];
  color: string;
  width: number;
  erase: boolean;
  complete: boolean;
};
type Pane = { strokes: Stroke[]; color: number; penSize: number };
// MultiScreenView.f12491g and the first three PenUtil.PenSize resources.
const colors = ["#f3f3f3", "#000000", "#e95504", "#0079c2"];
const penWidths = [1.34, 2.01, 2.68];
const backgrounds = [
  { color: "#ffffff", label: "split_background_0" },
  { color: "#263731", label: "split_background_1" },
  { color: "#cfaa29", label: "split_background_3" },
  { color: "#312e2e", label: "split_background_2" },
] as const;
const drawSegment = (
  canvas: HTMLCanvasElement,
  stroke: Stroke,
  from: Point,
  to: Point,
  previous?: Point,
) => {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  context.globalCompositeOperation = stroke.erase
    ? "destination-out"
    : "source-over";
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.width * (window.devicePixelRatio || 1);
  context.lineCap = stroke.erase ? "square" : "round";
  context.lineJoin = "round";
  context.beginPath();
  if (!previous && from[0] === to[0] && from[1] === to[1]) {
    if (stroke.erase) {
      context.fillRect(
        to[0] * canvas.width - context.lineWidth / 2,
        to[1] * canvas.height - context.lineWidth / 2,
        context.lineWidth,
        context.lineWidth,
      );
    } else {
      context.arc(
        to[0] * canvas.width,
        to[1] * canvas.height,
        context.lineWidth / 2,
        0,
        2 * Math.PI,
      );
      context.fill();
    }
  } else {
    // HCurveObject joins midpoint quadratic segments for smooth live ink.
    const start = previous
      ? [(previous[0] + from[0]) / 2, (previous[1] + from[1]) / 2]
      : from;
    context.moveTo(start[0] * canvas.width, start[1] * canvas.height);
    context.quadraticCurveTo(
      from[0] * canvas.width,
      from[1] * canvas.height,
      ((from[0] + to[0]) * canvas.width) / 2,
      ((from[1] + to[1]) * canvas.height) / 2,
    );
    context.stroke();
  }
};
const finishStroke = (canvas: HTMLCanvasElement, stroke: Stroke) => {
  const last = stroke.points[stroke.points.length - 1];
  const previous = stroke.points[stroke.points.length - 2];
  if (previous) {
    drawSegment(canvas, stroke, last, last, previous);
  }
  stroke.complete = true;
};
/** com.xbh.whiteboard MultiScreenView: independent ink, four colors, three sizes. */
const SplitPane = ({
  model,
  index,
  background,
  disabled,
}: {
  model: Pane;
  index: number;
  background: string;
  disabled: boolean;
}) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const active = useRef(new Map<number, Stroke>());
  const [tool, setTool] = useState(model.color);
  const [penSize, setPenSize] = useState(model.penSize);
  const redraw = useCallback(() => {
    const node = canvas.current!;
    node.getContext("2d")?.clearRect(0, 0, node.width, node.height);
    for (const stroke of model.strokes) {
      stroke.points.forEach((point, i) =>
        drawSegment(
          node,
          stroke,
          stroke.points[Math.max(0, i - 1)],
          point,
          stroke.points[i - 2],
        ),
      );
      if (stroke.complete) {
        finishStroke(node, stroke);
      }
    }
  }, [model]);
  useEffect(() => {
    const node = canvas.current!;
    const pointers = active.current;
    const fit = () => {
      const rect = node.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) {
        return;
      }
      node.width = Math.max(
        1,
        Math.round(rect.width * (devicePixelRatio || 1)),
      );
      node.height = Math.max(
        1,
        Math.round(rect.height * (devicePixelRatio || 1)),
      );
      redraw();
    };
    fit();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(fit);
    observer?.observe(node);
    window.addEventListener("resize", fit);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", fit);
      // A layout/visibility change can unmount a pane before pointerup.
      pointers.forEach((stroke) => finishStroke(node, stroke));
      pointers.clear();
      node.width = node.height = 1;
    };
  }, [redraw]);
  const point = (x: number, y: number): Point => {
    const rect = canvas.current!.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (x - rect.left) / Math.max(1, rect.width))),
      Math.max(0, Math.min(1, (y - rect.top) / Math.max(1, rect.height))),
    ];
  };
  return (
    <section
      className="fc-split-pane"
      aria-label={t("fcboard.split_pane", { number: index + 1 })}
      onKeyDown={(event) => {
        if (disabled || active.current.size) {
          return;
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "z"
        ) {
          event.preventDefault();
          model.strokes.pop();
          redraw();
        }
        if (event.key === "Delete") {
          event.preventDefault();
          model.strokes.length = 0;
          redraw();
        }
      }}
    >
      <canvas
        ref={canvas}
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onContextMenu={(event) => event.preventDefault()}
        style={{ background, touchAction: "none" }}
        onPointerDown={(event) => {
          if (
            disabled ||
            (event.pointerType === "mouse" && event.button !== 0) ||
            active.current.has(event.pointerId)
          ) {
            return;
          }
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          try {
            event.currentTarget.setPointerCapture?.(event.pointerId);
          } catch {
            // WebViews may retire a pointer before capture reaches the DOM.
          }
          const contact = Math.max(event.width || 0, event.height || 0);
          const erase = event.pointerType === "touch" && contact >= 36;
          const stroke: Stroke = {
            color: colors[tool],
            width: erase ? Math.max(36, contact) : penWidths[penSize],
            erase,
            complete: false,
            points: [point(event.clientX, event.clientY)],
          };
          model.strokes.push(stroke);
          active.current.set(event.pointerId, stroke);
          drawSegment(
            event.currentTarget,
            stroke,
            stroke.points[0],
            stroke.points[0],
          );
        }}
        onPointerMove={(event) => {
          const stroke = active.current.get(event.pointerId);
          if (!stroke) {
            return;
          }
          const coalesced = event.nativeEvent.getCoalescedEvents?.();
          const samples = coalesced?.length ? coalesced : [event.nativeEvent];
          for (const sample of samples) {
            const next = point(sample.clientX, sample.clientY);
            const last = stroke.points[stroke.points.length - 1];
            if (next[0] === last[0] && next[1] === last[1]) {
              continue;
            }
            drawSegment(
              event.currentTarget,
              stroke,
              stroke.points[stroke.points.length - 1],
              next,
              stroke.points[stroke.points.length - 2],
            );
            stroke.points.push(next);
          }
        }}
        onPointerUp={(event) => {
          const stroke = active.current.get(event.pointerId);
          if (stroke) {
            const next = point(event.clientX, event.clientY);
            drawSegment(
              event.currentTarget,
              stroke,
              stroke.points[stroke.points.length - 1],
              next,
              stroke.points[stroke.points.length - 2],
            );
            stroke.points.push(next);
            finishStroke(event.currentTarget, stroke);
            active.current.delete(event.pointerId);
          }
        }}
        onPointerCancel={(event) => {
          const stroke = active.current.get(event.pointerId);
          if (stroke) {
            finishStroke(event.currentTarget, stroke);
            active.current.delete(event.pointerId);
          }
        }}
        onLostPointerCapture={(event) => {
          const stroke = active.current.get(event.pointerId);
          if (stroke) {
            finishStroke(event.currentTarget, stroke);
            active.current.delete(event.pointerId);
          }
        }}
      />
      <div className="fc-split-bottom">
        <div className="fc-split-penbar">
          <div
            className="fc-split-colors"
            role="group"
            aria-label={t("fcboard.split_pen_colors")}
          >
            {(
              [
                "split_white",
                "split_black",
                "split_orange",
                "split_blue",
              ] as const
            ).map((label, value) => (
              <button
                type="button"
                key={label}
                aria-label={t(`fcboard.${label}`)}
                aria-pressed={tool === value}
                disabled={disabled}
                onClick={() => {
                  model.color = value;
                  setTool(value);
                }}
              >
                <span style={{ background: colors[value] }} />
              </button>
            ))}
          </div>
          <span className="fc-split-divider" />
          <div
            className="fc-split-widths"
            role="group"
            aria-label={t("fcboard.split_pen_widths")}
          >
            {penWidths.map((width, value) => (
              <button
                type="button"
                key={width}
                aria-label={t("fcboard.split_pen_size", { size: value + 1 })}
                aria-pressed={penSize === value}
                disabled={disabled}
                onClick={() => {
                  model.penSize = value;
                  setPenSize(value);
                }}
              >
                <span
                  style={{
                    width: `calc(${
                      6 + value * 4
                    } * var(--fc-split-unit, 0.67px))`,
                    height: `calc(${
                      6 + value * 4
                    } * var(--fc-split-unit, 0.67px))`,
                  }}
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
export const SplitBoard = () => {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(2);
  const [ratio, setRatio] = useState(50);
  const resizing = useRef<{ pointer: number; original: number } | null>(null);
  const [background, setBackground] = useState(1);
  const [draft, setDraft] = useState<{
    count: number;
    background: number;
  } | null>(null);
  const [exiting, setExiting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const section = useRef<HTMLElement>(null);
  const saveRequest = useRef<AbortController | undefined>(undefined);
  const exitPanel = useRef<HTMLElement>(null);
  const exitStyle = useAnchoredPanel(
    exitPanel,
    "[data-split-exit]",
    exiting && open,
  );
  useEffect(() => () => saveRequest.current?.abort(), []);
  const save = async () => {
    if (saveRequest.current) {
      return;
    }
    const request = new AbortController();
    saveRequest.current = request;
    setSaving(true);
    setError("");
    let canvas: HTMLCanvasElement | undefined;
    try {
      const panes = Array.from(section.current!.querySelectorAll("canvas"));
      canvas = document.createElement("canvas");
      canvas.width = panes.reduce((sum, pane) => sum + pane.width, 0);
      canvas.height = Math.max(...panes.map((pane) => pane.height));
      const context = canvas.getContext("2d");
      if (!context || !canvas.width || !canvas.height) {
        throw new Error(t("fcboard.the_board_is_empty"));
      }
      context.fillStyle = backgrounds[background].color;
      context.fillRect(0, 0, canvas.width, canvas.height);
      let x = 0;
      context.strokeStyle = "#fcfcfe";
      context.lineWidth = 2 * (window.devicePixelRatio || 1);
      context.setLineDash([]);
      for (const pane of panes) {
        context.drawImage(pane, x, 0);
        if (x) {
          context.beginPath();
          context.moveTo(x, 0);
          context.lineTo(x, canvas.height);
          context.stroke();
        }
        x += pane.width;
      }
      const output = canvas;
      const blob = await new Promise<Blob>((resolve, reject) =>
        output.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(new Error(t("fcboard.split_export_failed"))),
          "image/jpeg",
          1,
        ),
      );
      canvas.width = canvas.height = 1;
      request.signal.throwIfAborted();
      const saved = await savePageFiles(
        [{ page: 1, blob }],
        t("fcboard.split_screen"),
        "jpg",
        request.signal,
      );
      request.signal.throwIfAborted();
      if (saved) {
        setExiting(false);
      }
    } catch (failure) {
      if (!request.signal.aborted) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      if (canvas) {
        canvas.width = canvas.height = 1;
      }
      if (saveRequest.current === request) {
        saveRequest.current = undefined;
        setSaving(false);
      }
    }
  };
  const current = useRef({ open, count, background });
  current.current = { open, count, background };
  const models = useRef<Pane[]>(
    Array.from({ length: 4 }, () => ({ strokes: [], color: 0, penSize: 1 })),
  );
  useEffect(
    () =>
      classroomCommands.register(
        "tools.split",
        "Open independent 2/3/4 column writing canvases immediately. args.open=false closes; args.count=2|3|4; args.background=0..3. args.configure=true opens optional settings. Ink is retained per pane when switching layout or closing.",
        (args) => {
          if (
            (args.open !== undefined && typeof args.open !== "boolean") ||
            (args.configure !== undefined &&
              typeof args.configure !== "boolean") ||
            (args.count !== undefined &&
              ![2, 3, 4].includes(Number(args.count))) ||
            (args.background !== undefined &&
              ![0, 1, 2, 3].includes(Number(args.background)))
          ) {
            throw new Error(t("fcboard.invalid_style_parameters"));
          }
          const configure = args.open !== false && args.configure === true;
          const next = {
            open: configure ? current.current.open : args.open !== false,
            count: Number(args.count ?? current.current.count),
            background: Number(args.background ?? current.current.background),
          };
          if (configure) {
            setDraft({ count: next.count, background: next.background });
          } else {
            saveRequest.current?.abort();
            setError("");
            setExiting(false);
            setDraft(null);
            setOpen(next.open);
            setCount(next.count);
            setBackground(next.background);
            current.current = next;
          }
          return {
            ...next,
            configuring: configure,
            panes: models.current.map((model) => ({
              strokes: model.strokes.length,
            })),
          };
        },
      ),
    [],
  );
  useEffect(() => {
    if (!open || count !== 2 || exiting || saving || draft) {
      resizing.current = null;
      return;
    }
    const move = (event: PointerEvent) => {
      if (resizing.current?.pointer !== event.pointerId) {
        return;
      }
      const rect = section.current?.getBoundingClientRect();
      if (rect && rect.width > 0) {
        event.preventDefault();
        setRatio(
          Math.max(
            15,
            Math.min(85, ((event.clientX - rect.left) / rect.width) * 100),
          ),
        );
      }
    };
    const end = (event: PointerEvent) => {
      if (resizing.current?.pointer === event.pointerId) {
        move(event);
        resizing.current = null;
      }
    };
    const cancel = (event: PointerEvent) => {
      if (resizing.current?.pointer === event.pointerId) {
        setRatio(resizing.current.original);
        resizing.current = null;
      }
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      resizing.current = null;
    };
  }, [open, count, exiting, saving, draft]);
  useEffect(() => {
    if (!open && !draft) {
      return;
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        if (draft) {
          setDraft(null);
        } else if (!saving) {
          setError("");
          setExiting((value) => !value);
        }
      }
    };
    const dismiss = (event: globalThis.PointerEvent) => {
      if (
        exiting &&
        !saving &&
        !exitPanel.current?.contains(event.target as Node) &&
        !(event.target as Element).closest?.("[data-split-exit]")
      ) {
        setExiting(false);
      }
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("pointerdown", dismiss);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("pointerdown", dismiss);
    };
  }, [open, draft, exiting, saving]);
  return (
    <>
      {open && (
        <section
          className="fc-split-board"
          ref={section}
          role="dialog"
          aria-label={t("fcboard.split_screen")}
        >
          <div
            className="fc-split-panes"
            style={{
              display: "grid",
              gridTemplateColumns:
                count === 2
                  ? `minmax(0, ${ratio}fr) minmax(0, ${100 - ratio}fr)`
                  : `repeat(${count}, minmax(0, 1fr))`,
            }}
          >
            {models.current.slice(0, count).map((model, i) => (
              <SplitPane
                key={i}
                index={i}
                model={model}
                background={backgrounds[background].color}
                disabled={exiting || saving || !!draft}
              />
            ))}
          </div>
          {count === 2 && (
            <div
              role="separator"
              aria-label={t("fcboard.split_resize")}
              aria-orientation="vertical"
              aria-valuemin={15}
              aria-valuemax={85}
              aria-valuenow={Math.round(ratio)}
              tabIndex={exiting || saving || draft ? -1 : 0}
              aria-disabled={exiting || saving || !!draft}
              className="fc-split-resize"
              style={{ left: `${ratio}%` }}
              onPointerDown={(event) => {
                if (exiting || saving || draft || event.button !== 0) {
                  return;
                }
                event.preventDefault();
                resizing.current = {
                  pointer: event.pointerId,
                  original: ratio,
                };
                try {
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                } catch {
                  /* Window handlers retain the drag when WebView retires capture. */
                }
              }}
              onLostPointerCapture={() => {
                if (resizing.current) {
                  setRatio(resizing.current.original);
                }
                resizing.current = null;
              }}
              onKeyDown={(event) => {
                if (exiting || saving || draft) {
                  return;
                }
                if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) {
                  event.preventDefault();
                  setRatio((value) =>
                    event.key === "Home"
                      ? 50
                      : Math.max(
                          15,
                          Math.min(
                            85,
                            value + (event.key === "ArrowRight" ? 2 : -2),
                          ),
                        ),
                  );
                }
              }}
            />
          )}
          <button
            className="fc-split-exit"
            data-split-exit
            aria-expanded={exiting}
            disabled={saving}
            type="button"
            aria-label={t("buttons.close")}
            onClick={() => {
              setError("");
              setExiting((value) => !value);
            }}
          >
            <FactoryIcon name="splitExit" />
          </button>
        </section>
      )}
      {draft && (
        <MaterialPanel
          centered
          role="dialog"
          aria-label={`${t("fcboard.split_screen")} · ${t("fcboard.settings")}`}
          className="fc-split-settings"
          onDismiss={() => setDraft(null)}
        >
          <h2>
            {t("fcboard.split_screen")} · {t("fcboard.settings")}
          </h2>
          <fieldset>
            <legend>{t("fcboard.split_screen")}</legend>
            <div className="fc-split-options">
              {[2, 3, 4].map((number) => (
                <label key={number}>
                  <input
                    type="radio"
                    name="fc-split-count"
                    value={number}
                    checked={draft.count === number}
                    aria-label={String(number)}
                    onChange={() => setDraft({ ...draft, count: number })}
                  />
                  <svg
                    className="fc-split-preview"
                    data-count={number}
                    viewBox="0 0 42 42"
                    aria-hidden="true"
                  >
                    <rect
                      x="2"
                      y="6"
                      width="38"
                      height="30"
                      fill="none"
                      stroke="currentColor"
                    />
                    {Array.from({ length: number - 1 }, (_, index) => (
                      <path
                        key={index}
                        d={`M${2 + ((index + 1) * 38) / number} 6v30`}
                        stroke="currentColor"
                        strokeDasharray="1 1"
                      />
                    ))}
                    <text
                      x="21"
                      y="27"
                      textAnchor="middle"
                      fill="currentColor"
                      stroke="#ffffff"
                      strokeWidth="0.5"
                      fontFamily="Arial"
                      fontSize="16"
                    >
                      {number}
                    </text>
                  </svg>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>{t("fcboard.background")}</legend>
            <div className="fc-split-options">
              {backgrounds.map(({ color, label }, value) => (
                <label key={color} title={t(`fcboard.${label}`)}>
                  <input
                    type="radio"
                    name="fc-split-background"
                    aria-label={t(`fcboard.${label}`)}
                    checked={draft.background === value}
                    onChange={() => setDraft({ ...draft, background: value })}
                  />
                  <svg
                    className="fc-split-preview"
                    data-background={value + 1}
                    viewBox="0 0 42 42"
                    aria-hidden="true"
                  >
                    <rect
                      x="2"
                      y="6"
                      width="38"
                      height="30"
                      fill={color}
                      stroke="currentColor"
                    />
                  </svg>
                </label>
              ))}
            </div>
          </fieldset>
          <footer>
            <button
              type="button"
              onClick={() => {
                setCount(draft.count);
                setBackground(draft.background);
                setOpen(true);
                setDraft(null);
              }}
            >
              {t("buttons.confirm")}
            </button>
            <button type="button" onClick={() => setDraft(null)}>
              {t("buttons.cancel")}
            </button>
          </footer>
        </MaterialPanel>
      )}
      {exiting && open && (
        <MaterialPanel
          ref={exitPanel}
          style={exitStyle}
          role="dialog"
          aria-label={t("fcboard.split_exit_prompt")}
          className="fc-split-exit-dialog"
        >
          <p>{t("fcboard.split_exit_prompt")}</p>
          {error && <p role="alert">{error}</p>}
          <footer>
            <button type="button" disabled={saving} onClick={() => void save()}>
              {t("buttons.save")}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setExiting(false);
                setOpen(false);
              }}
            >
              {t("fcboard.exit_without_saving")}
            </button>
          </footer>
        </MaterialPanel>
      )}
    </>
  );
};
