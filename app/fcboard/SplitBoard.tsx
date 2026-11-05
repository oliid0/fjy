import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";

import blackPen from "./assets/multiscreen/ic_black_pen.svg";
import bluePen from "./assets/multiscreen/ic_blue_pen.svg";
import redPen from "./assets/multiscreen/ic_red_pen.svg";
import smallEraser from "./assets/multiscreen/ic_small_eraser.svg";
import largeEraser from "./assets/multiscreen/ic_big_eraser.svg";

import { MaterialPanel } from "./MaterialPanel";

import { classroomCommands } from "./commands";

type Point = [number, number];
type Stroke = { points: Point[]; color: string; width: number; erase: boolean };
type Pane = { strokes: Stroke[] };
const colors = ["#000000", "#0000ff", "#ff0000"];
const toolIcons = [blackPen, bluePen, redPen, smallEraser, largeEraser];
const backgrounds = [
  { color: "#ffffff", label: "split_background_0" },
  { color: "#5c7c62", label: "split_background_1" },
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
/** MultiBar / MultiCanvas: equal independent panes, three pens, two erasers. */
const SplitPane = ({
  model,
  index,
  background,
}: {
  model: Pane;
  index: number;
  background: string;
}) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const active = useRef(new Map<number, Stroke>());
  const [tool, setTool] = useState(0);
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
    }
  }, [model]);
  useEffect(() => {
    const node = canvas.current!;
    const pointers = active.current;
    const fit = () => {
      const rect = node.getBoundingClientRect();
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
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => {
      observer.disconnect();
      pointers.clear();
    };
  }, [redraw]);
  const point = (x: number, y: number): Point => {
    const rect = canvas.current!.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (x - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (y - rect.top) / rect.height)),
    ];
  };
  return (
    <section
      className="fc-split-pane"
      aria-label={t("fcboard.split_pane", { number: index + 1 })}
    >
      <canvas
        ref={canvas}
        style={{ background, touchAction: "none" }}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) {
            return;
          }
          event.preventDefault();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          const stroke: Stroke = {
            color: colors[tool] || colors[0],
            width: tool === 3 ? 120 : tool === 4 ? 180 : 2.5,
            erase: tool > 2,
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
          const samples = event.nativeEvent.getCoalescedEvents?.() || [
            event.nativeEvent,
          ];
          for (const sample of samples) {
            const next = point(sample.clientX, sample.clientY);
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
            active.current.delete(event.pointerId);
          }
        }}
        onPointerCancel={(event) => active.current.delete(event.pointerId)}
        onLostPointerCapture={(event) => active.current.delete(event.pointerId)}
      />
      <div className="fc-split-penbar">
        {(
          [
            "split_black",
            "split_blue",
            "split_red",
            "split_small_eraser",
            "split_large_eraser",
          ] as const
        ).map((label, value) => (
          <button
            type="button"
            key={label}
            aria-label={t(`fcboard.${label}`)}
            aria-pressed={tool === value}
            onClick={() => setTool(value)}
            style={{ color: colors[value] }}
          >
            <img src={toolIcons[value]} alt="" draggable={false} />
          </button>
        ))}
        <button
          type="button"
          aria-label={t("buttons.undo")}
          onClick={() => {
            if (!active.current.size) {
              model.strokes.pop();
              redraw();
            }
          }}
        >
          ↶
        </button>
        <button
          type="button"
          aria-label={t("buttons.clear")}
          onClick={() => {
            active.current.clear();
            model.strokes.length = 0;
            redraw();
          }}
        >
          ⌫
        </button>
      </div>
    </section>
  );
};
export const SplitBoard = () => {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(2);
  const [background, setBackground] = useState(0);
  const [draft, setDraft] = useState<{
    count: number;
    background: number;
  } | null>(null);
  const current = useRef({ open, count, background });
  current.current = { open, count, background };
  const models = useRef<Pane[]>(
    Array.from({ length: 4 }, () => ({ strokes: [] })),
  );
  useEffect(
    () =>
      classroomCommands.register(
        "tools.split",
        "Open independent 2/3/4 column writing canvases (not Android system split). No args opens the original layout/background settings for confirmation. args.open=false closes; args.open=true or args.count=2|3|4 opens immediately; args.background=0..3. args.configure=true reopens settings. Ink is retained per pane when switching layout or closing.",
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
          const configure =
            args.open !== false &&
            (args.configure === true ||
              (args.open !== true &&
                args.count === undefined &&
                args.background === undefined));
          const next = {
            open: configure ? current.current.open : args.open !== false,
            count: Number(args.count ?? current.current.count),
            background: Number(args.background ?? current.current.background),
          };
          if (configure) {
            setDraft({ count: next.count, background: next.background });
          } else {
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
    if (!open) {
      return;
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        if (draft) {
          setDraft(null);
        } else {
          setOpen(false);
        }
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open, draft]);
  return (
    <>
      {open && (
        <section
          className="fc-split-board"
          role="dialog"
          aria-label={t("fcboard.split_screen")}
        >
          <header className="fc-builtin-row">
            <strong>{t("fcboard.split_screen")}</strong>
            <button
              type="button"
              onClick={() => setDraft({ count, background })}
            >
              {t("fcboard.settings")}
            </button>
            <button
              type="button"
              aria-label={t("buttons.close")}
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>
          <div className="fc-split-panes">
            {models.current.slice(0, count).map((model, i) => (
              <SplitPane
                key={i}
                index={i}
                model={model}
                background={backgrounds[background].color}
              />
            ))}
          </div>
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
                    onChange={() => setDraft({ ...draft, count: number })}
                  />
                  <span className="fc-split-preview" aria-hidden="true">
                    {Array.from({ length: number }, (_, i) => (
                      <i key={i} />
                    ))}
                  </span>
                  <span>{number}</span>
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
                  <span
                    className="fc-split-preview"
                    style={{ background: color }}
                    aria-hidden="true"
                  />
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
    </>
  );
};
