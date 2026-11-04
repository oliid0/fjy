import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";

import { classroomCommands } from "./commands";

type Point = [number, number];
type Stroke = { points: Point[]; color: string; width: number; erase: boolean };
type Pane = { strokes: Stroke[] };
const colors = ["#202124", "#1565c0", "#d32f2f"];
const backgrounds = ["#ffffff", "#e7f2e3", "#252f38", "#fff2d5"];
const drawSegment = (
  canvas: HTMLCanvasElement,
  stroke: Stroke,
  from: Point,
  to: Point,
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
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  if (from[0] === to[0] && from[1] === to[1]) {
    context.arc(
      to[0] * canvas.width,
      to[1] * canvas.height,
      context.lineWidth / 2,
      0,
      2 * Math.PI,
    );
    context.fill();
  } else {
    context.moveTo(from[0] * canvas.width, from[1] * canvas.height);
    context.lineTo(to[0] * canvas.width, to[1] * canvas.height);
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
        drawSegment(node, stroke, stroke.points[Math.max(0, i - 1)], point),
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
            width: tool === 3 ? 18 : tool === 4 ? 48 : 3,
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
            );
            stroke.points.push(next);
          }
        }}
        onPointerUp={(event) => active.current.delete(event.pointerId)}
        onPointerCancel={(event) => active.current.delete(event.pointerId)}
        onLostPointerCapture={(event) => active.current.delete(event.pointerId)}
      />
      <div className="fc-split-penbar">
        {[
          "split_black",
          "split_blue",
          "split_red",
          "split_small_eraser",
          "split_large_eraser",
        ].map((label, value) => (
          <button
            type="button"
            key={label}
            aria-label={t(`fcboard.${label}`)}
            aria-pressed={tool === value}
            onClick={() => setTool(value)}
            style={{ color: colors[value] }}
          >
            {value < 3 ? "✎" : value === 3 ? "▱" : "▰"}
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
  const models = useRef<Pane[]>(
    Array.from({ length: 4 }, () => ({ strokes: [] })),
  );
  useEffect(
    () =>
      classroomCommands.register(
        "tools.split",
        "Open independent 2/3/4 column writing canvases (not Android system split). args.open=false closes, args.count=2|3|4, args.background=0..3; ink is retained per pane when switching layout or closing.",
        (args) => {
          if (
            (args.open !== undefined && typeof args.open !== "boolean") ||
            (args.count !== undefined &&
              ![2, 3, 4].includes(Number(args.count))) ||
            (args.background !== undefined &&
              ![0, 1, 2, 3].includes(Number(args.background)))
          ) {
            throw new Error(t("fcboard.invalid_style_parameters"));
          }
          if (args.count !== undefined) {
            setCount(Number(args.count));
          }
          if (args.background !== undefined) {
            setBackground(Number(args.background));
          }
          setOpen(args.open !== false);
          return {
            open: args.open !== false,
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
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open]);
  return open ? (
    <section
      className="fc-split-board"
      role="dialog"
      aria-label={t("fcboard.split_screen")}
    >
      <header className="fc-builtin-row">
        <strong>{t("fcboard.split_screen")}</strong>
        {[2, 3, 4].map((number) => (
          <button
            type="button"
            key={number}
            aria-pressed={count === number}
            onClick={() => setCount(number)}
          >
            {number}
          </button>
        ))}
        <label>
          {t("fcboard.colour")}
          <select
            value={background}
            onChange={(event) => setBackground(Number(event.target.value))}
          >
            {backgrounds.map((color, i) => (
              <option key={color} value={i}>
                {t(`fcboard.split_background_${i}`)}
              </option>
            ))}
          </select>
        </label>
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
            background={backgrounds[background]}
          />
        ))}
      </div>
    </section>
  ) : null;
};
