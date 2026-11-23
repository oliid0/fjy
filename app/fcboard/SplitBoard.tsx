import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";

import {
  isPalmContact,
  pointerSamples,
  sweptRectangle,
} from "@fcboard/fcboard/eraser/stroke";

import { FactoryIcon } from "@fcboard/fcboard/components/FactoryIcon";

import blackPenIcon from "./assets/multiscreen/ic_black_pen.svg?url";
import bluePenIcon from "./assets/multiscreen/ic_blue_pen.svg?url";
import redPenIcon from "./assets/multiscreen/ic_red_pen.svg?url";
import eraserIcon from "./assets/multiscreen/ic_big_eraser.svg?url";

import { MaterialPanel } from "./MaterialPanel";
import { createNativeSplitInk } from "./nativeSplitInk";

import { classroomCommands } from "./commands";
import { savePageFiles } from "./boardFile";
import { useAnchoredPanel } from "./floating";

import "./SplitBoard.scss";

type Point = [number, number];
type Stroke = {
  points: Point[];
  color: string;
  width: number;
  height: number;
  erase: boolean;
  complete: boolean;
  gesture?: string;
};
type Pane = {
  strokes: Stroke[];
  color: number;
  eraser?: number;
};
// BSD HDataSet.getSplitColor and the visible big eraser in canvas_item_mid_layout.
const colors = ["#000000", "#0000ff", "#ff0000"];
const penWidth = 2.01;
const penIcons = [blackPenIcon, bluePenIcon, redPenIcon];
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
  if (stroke.erase) {
    const polygon = sweptRectangle(
      { x: from[0] * canvas.width, y: from[1] * canvas.height },
      { x: to[0] * canvas.width, y: to[1] * canvas.height },
      context.lineWidth,
      stroke.height * (window.devicePixelRatio || 1),
    );
    polygon.forEach((point, index) =>
      index
        ? context.lineTo(point.x, point.y)
        : context.moveTo(point.x, point.y),
    );
    context.closePath();
    context.fill();
    return;
  }
  if (!previous && from[0] === to[0] && from[1] === to[1]) {
    context.arc(
      to[0] * canvas.width,
      to[1] * canvas.height,
      context.lineWidth / 2,
      0,
      2 * Math.PI,
    );
    context.fill();
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
/** BSD MultiScreen: independent ink and the original three pens plus eraser. */
const SplitPane = ({
  model,
  index,
  background,
  resizing,
  disabled,
}: {
  model: Pane;
  index: number;
  background: string;
  resizing: boolean;
  disabled: boolean;
}) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const active = useRef(new Map<number, Stroke>());
  const fitCanvas = useRef<() => void>(undefined);
  const native = useRef<ReturnType<typeof createNativeSplitInk>>(undefined);
  const nativeContacts = useRef(new Map<string, Stroke>());
  const [tool, setTool] = useState(model.color);
  const [eraser, setEraser] = useState(model.eraser || 0);
  const nativeStyle = useRef({
    color: colors[tool],
    width: penWidth,
    eraser,
    resizing,
    disabled,
  });
  nativeStyle.current = {
    color: colors[tool],
    width: penWidth,
    eraser,
    resizing,
    disabled,
  };
  const redraw = useCallback(
    (restoreNative = true) => {
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
      if (restoreNative) {
        native.current?.restore();
      }
    },
    [model],
  );
  useEffect(() => {
    const node = canvas.current!;
    const pointers = active.current;
    const fit = () => {
      if (nativeStyle.current.resizing) {
        return;
      }
      const rect = node.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) {
        return;
      }
      const width = Math.max(
        1,
        Math.round(rect.width * (devicePixelRatio || 1)),
      );
      const height = Math.max(
        1,
        Math.round(rect.height * (devicePixelRatio || 1)),
      );
      if (node.width !== width || node.height !== height) {
        node.width = width;
        node.height = height;
        redraw();
      }
    };
    fitCanvas.current = fit;
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
  useEffect(() => {
    const node = canvas.current!;
    const contacts = nativeContacts.current;
    const eraseParts = new Map<string, Stroke[]>();
    native.current = createNativeSplitInk(
      node,
      () => nativeStyle.current,
      (event, style, bounds) => {
        let stroke = contacts.get(event.id);
        if (event.phase === "cancel") {
          if (stroke) {
            const owned = eraseParts.get(event.id) || [stroke];
            for (const part of owned) {
              const index = model.strokes.indexOf(part);
              if (index >= 0) {
                model.strokes.splice(index, 1);
              }
            }
            eraseParts.delete(event.id);
            contacts.delete(event.id);
            // Native already restored this gesture's tiles. A new snapshot
            // would cancel a different writer still active in the same pane.
            redraw(false);
          }
          return;
        }
        if (event.phase === "start") {
          stroke = {
            color: style.color,
            width: event.mode === "erase" ? event.width : style.width,
            height: event.mode === "erase" ? event.height : style.width,
            erase: event.mode === "erase",
            complete: false,
            points: [],
            gesture: event.id,
          };
          if (stroke.erase) {
            eraseParts.set(event.id, [stroke]);
          }
          contacts.set(event.id, stroke);
          model.strokes.push(stroke);
        }
        if (!stroke) {
          return;
        }
        const points = event.points.map(
          ([x, y]): Point => [
            Math.max(0, Math.min(1, (x - bounds.left) / bounds.width)),
            Math.max(0, Math.min(1, (y - bounds.top) / bounds.height)),
          ],
        );
        const fresh =
          event.mode === "pen" && event.phase === "end"
            ? points.slice(stroke.points.length)
            : points;
        for (const point of fresh) {
          const previous = stroke.points.at(-1) || point;
          drawSegment(node, stroke, previous, point, stroke.points.at(-2));
          stroke.points.push(point);
        }
        if (event.phase === "end") {
          finishStroke(node, stroke);
          contacts.delete(event.id);
          if (stroke.erase) {
            eraseParts.delete(event.id);
          } else {
            // Native installs the completed pen above earlier erasure. Keep
            // later erase packets above that pen in resize/export replay too.
            const index = model.strokes.indexOf(stroke);
            if (index >= 0) {
              model.strokes.splice(index, 1);
            }
            model.strokes.push(stroke);
            for (const [id, erasing] of contacts) {
              if (!erasing.erase || !erasing.points.length) {
                continue;
              }
              erasing.complete = true;
              const continuation: Stroke = {
                ...erasing,
                complete: false,
                points: [erasing.points.at(-1)!],
              };
              eraseParts.get(id)?.push(continuation);
              contacts.set(id, continuation);
              model.strokes.push(continuation);
            }
          }
        }
      },
    );
    return () => {
      native.current?.dispose();
      native.current = undefined;
      for (const [id, stroke] of contacts) {
        for (const owned of eraseParts.get(id) || [stroke]) {
          const index = model.strokes.indexOf(owned);
          if (index >= 0) {
            model.strokes.splice(index, 1);
          }
        }
      }
      contacts.clear();
      eraseParts.clear();
    };
  }, [model, redraw]);
  useEffect(() => {
    if (!resizing) {
      fitCanvas.current?.();
    }
    native.current?.update();
  }, [disabled, resizing, tool, eraser]);
  const point = (x: number, y: number, rect: DOMRect): Point => {
    return [
      Math.max(0, Math.min(1, (x - rect.left) / Math.max(1, rect.width))),
      Math.max(0, Math.min(1, (y - rect.top) / Math.max(1, rect.height))),
    ];
  };
  const appendSamples = (
    node: HTMLCanvasElement,
    stroke: Stroke,
    event: PointerEvent,
  ) => {
    const bounds = node.getBoundingClientRect();
    for (const sample of pointerSamples(event)) {
      const next = point(sample.clientX, sample.clientY, bounds);
      const last = stroke.points.at(-1)!;
      if (next[0] === last[0] && next[1] === last[1]) {
        continue;
      }
      drawSegment(node, stroke, last, next, stroke.points.at(-2));
      stroke.points.push(next);
    }
  };
  return (
    <section
      className="fc-split-pane"
      style={{ background }}
      aria-label={t("fcboard.split_pane", { number: index + 1 })}
      onKeyDown={(event) => {
        if (disabled || active.current.size || nativeContacts.current.size) {
          return;
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "z"
        ) {
          event.preventDefault();
          const undone = model.strokes.pop();
          if (undone?.gesture) {
            model.strokes = model.strokes.filter(
              (stroke) => stroke.gesture !== undone.gesture,
            );
          }
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
          const erase =
            !!eraser ||
            isPalmContact(event, 36) ||
            (event.pointerType === "pen" &&
              (event.button === 2 ||
                event.button === 5 ||
                !!(event.buttons & 34)));
          const stroke: Stroke = {
            color: colors[tool],
            width: erase ? eraser || Math.max(60, event.width || 0) : penWidth,
            height: erase
              ? eraser
                ? eraser * 1.2
                : Math.max(72, event.height || 0)
              : penWidth,
            erase,
            complete: false,
            points: [
              point(
                event.clientX,
                event.clientY,
                event.currentTarget.getBoundingClientRect(),
              ),
            ],
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
          appendSamples(event.currentTarget, stroke, event.nativeEvent);
        }}
        onPointerUp={(event) => {
          const stroke = active.current.get(event.pointerId);
          if (stroke) {
            appendSamples(event.currentTarget, stroke, event.nativeEvent);
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
            {(["split_black", "split_blue", "split_red"] as const).map(
              (label, value) => (
                <button
                  type="button"
                  key={label}
                  aria-label={t(`fcboard.${label}`)}
                  aria-pressed={!eraser && tool === value}
                  disabled={disabled}
                  onClick={() => {
                    model.color = value;
                    model.eraser = 0;
                    setTool(value);
                    setEraser(0);
                  }}
                >
                  <img src={penIcons[value]} alt="" draggable={false} />
                </button>
              ),
            )}
          </div>
          <div
            className="fc-split-erasers"
            role="group"
            aria-label={t("toolBar.eraser")}
          >
            <button
              type="button"
              aria-label={t("fcboard.split_large_eraser")}
              aria-pressed={eraser === 90}
              disabled={disabled}
              onClick={() => {
                model.eraser = 90;
                setEraser(90);
              }}
            >
              <img src={eraserIcon} alt="" draggable={false} />
            </button>
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
  const [draggingDivider, setDraggingDivider] = useState(false);
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
    Array.from({ length: 4 }, () => ({ strokes: [], color: 0 })),
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
      setDraggingDivider(false);
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
        setDraggingDivider(false);
      }
    };
    const cancel = (event: PointerEvent) => {
      if (resizing.current?.pointer === event.pointerId) {
        setRatio(resizing.current.original);
        resizing.current = null;
        setDraggingDivider(false);
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
        } else {
          if (exiting) {
            saveRequest.current?.abort();
            saveRequest.current = undefined;
            setSaving(false);
          }
          setError("");
          setExiting((value) => !value);
        }
      }
    };
    const dismiss = (event: globalThis.PointerEvent) => {
      if (
        exiting &&
        !exitPanel.current?.contains(event.target as Node) &&
        !(event.target as Element).closest?.("[data-split-exit]")
      ) {
        saveRequest.current?.abort();
        saveRequest.current = undefined;
        setSaving(false);
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
                resizing={draggingDivider}
                disabled={exiting || saving || !!draft || draggingDivider}
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
                setDraggingDivider(true);
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
                setDraggingDivider(false);
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
            type="button"
            aria-label={t("buttons.close")}
            onClick={() => {
              if (exiting) {
                saveRequest.current?.abort();
                saveRequest.current = undefined;
                setSaving(false);
              }
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
              {t("fcboard.save")}
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
