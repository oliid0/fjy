import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";

import { compileExpression, sampleFunctionCurve } from "./math";

import type { Chart, FunctionPlotDatum } from "function-plot";
import type { Plot } from "./math";

/** Interactive SVG is evaluated locally from the same validated expression as
 * the saved vector graph. No remote page, bitmap or generated graph image. */
export const InteractiveFunctionPlot = ({
  plot,
  onExpression,
}: {
  plot: Plot;
  onExpression: (expression: string) => void;
}) => {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<Chart | undefined>(undefined);
  const [reset, setReset] = useState(0);
  const [draft, setDraft] = useState(plot.expression);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [cursor, setCursor] = useState("");
  const compiled = useMemo(
    () => compileExpression(plot.expression),
    [plot.expression],
  );
  useEffect(() => setDraft(plot.expression), [plot.expression]);
  useEffect(() => {
    const element = host.current;
    if (!element) {
      return;
    }
    let disposed = false;
    let chart: Chart | undefined;
    let cache: Record<string, Chart> | undefined;
    setReady(false);
    setError("");
    const scope = {
      x: plot.x,
      y: plot.y,
      z: plot.z,
      a: plot.a,
      b: plot.b,
      c: plot.c,
    };
    const data = (
      left: number,
      right: number,
      bottom: number,
      top: number,
    ): FunctionPlotDatum[] =>
      sampleFunctionCurve(
        plot.expression,
        { left, right, bottom, top },
        scope,
      ).map((points) => ({
        fnType: "points",
        graphType: "polyline",
        points: points as [number, number][],
        color: "#2563eb",
        skipTip: true,
      }));
    void import("function-plot")
      .then(({ default: exported, Chart }) => {
        // Published package is CommonJS; native import and browser bundlers
        // expose its default differently. Both are verified package exports.
        const functionPlot =
          typeof exported === "function"
            ? exported
            : (exported as unknown as { default: typeof exported }).default;
        if (disposed) {
          return;
        }
        cache = Chart.cache;
        chart = functionPlot({
          target: element,
          width: Math.max(220, element.clientWidth || 248),
          height: 240,
          grid: true,
          xAxis: { domain: [plot.x - plot.range, plot.x + plot.range] },
          yAxis: { domain: [-plot.range, plot.range] },
          data: data(
            plot.x - plot.range,
            plot.x + plot.range,
            -plot.range,
            plot.range,
          ),
        });
        runtime.current = chart;
        chart.on("before:draw", () => {
          const x = chart?.meta.xScale?.domain();
          const y = chart?.meta.yScale?.domain();
          if (!chart || !x || !y) {
            return;
          }
          try {
            chart.options.data = data(x[0], x[1], y[0], y[1]);
          } catch (error) {
            chart.options.data = [];
            setError(String(error));
          }
        });
        setReady(true);
      })
      .catch((error) => {
        if (!disposed) {
          setError(String(error));
        }
      });
    return () => {
      disposed = true;
      chart?.root?.selectAll("*").on(".zoom", null).on(".tip", null);
      chart?.removeAllListeners();
      if (cache && chart) {
        for (const [key, item] of Object.entries(cache)) {
          if (item === chart) {
            delete cache[key];
          }
        }
      }
      runtime.current = undefined;
      element.replaceChildren();
    };
  }, [plot, reset]);
  return (
    <section aria-label={t("fcboard.interactive_function_plot")}>
      <label className="fc-settings-input">
        {t("fcboard.functionGraph.expression")}
        <input
          value={draft}
          maxLength={500}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              try {
                onExpression(draft);
                setError("");
              } catch (error) {
                setError(String(error));
              }
            }
          }}
        />
      </label>
      <button
        onClick={() => {
          try {
            onExpression(draft);
            setError("");
          } catch (error) {
            setError(String(error));
          }
        }}
      >
        {t("fcboard.functionGraph.generate")}
      </button>
      <button disabled={!ready} onClick={() => setReset((value) => value + 1)}>
        {t("fcboard.reset")}
      </button>
      {!ready && !error && <p role="status">{t("fcboard.opening_resource")}</p>}
      <div
        ref={host}
        style={{ width: "100%", height: 240, touchAction: "none" }}
        onPointerMove={(event) => {
          const chart = runtime.current;
          const rect = event.currentTarget.getBoundingClientRect();
          const x = chart?.meta.xScale?.invert(
            event.clientX - rect.left - (chart.meta.margin?.left || 0),
          );
          if (x === undefined) {
            return;
          }
          try {
            const value = compiled.evaluate({ ...plot, x, y: plot.y });
            setCursor(
              typeof value === "number" && Number.isFinite(value)
                ? `x = ${x.toPrecision(5)}, y = ${(value + plot.z).toPrecision(
                    5,
                  )}`
                : "",
            );
          } catch {
            setCursor("");
          }
        }}
      />
      <output aria-live="off">{cursor}</output>
      <p>{t("fcboard.interactive_function_plot_help")}</p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
};
