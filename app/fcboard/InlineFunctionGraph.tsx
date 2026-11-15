import { useEffect, useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";
import {
  createInlineVegaView,
  vega,
} from "@fcboard/fcboard/visualizationRuntime";

import type { VisualizationView } from "@fcboard/fcboard/visualizationRuntime";

import {
  functionGraphData,
  functionGraphSpec,
  pickFunctionPoint,
  plotSize,
} from "./functionVisualization";
import { functionGraphNavigation } from "./functionGraphNavigation";
import { functionView } from "./math";

import type { Plot } from "./math";

export const InlineFunctionGraph = ({
  id,
  plot,
  color,
  onCommit,
  onReady,
}: {
  id: string;
  plot: Plot;
  color: string;
  onCommit: (plot: Plot) => void;
  onReady?: () => void;
}) => {
  const root = useRef<HTMLDivElement>(null);
  const props = useRef({ plot, onCommit });
  props.current = { plot, onCommit };
  const live = useRef<VisualizationView | undefined>(undefined);
  const [parameters, setParameters] = useState<
    Partial<Pick<Plot, "a" | "b" | "c">>
  >({});
  const parameterValues = useRef<Partial<Pick<Plot, "a" | "b" | "c">>>({});
  const changeParameter = (key: "a" | "b" | "c", value: number) => {
    if ((parameterValues.current[key] ?? props.current.plot[key]) === value) {
      return;
    }
    parameterValues.current = { ...parameterValues.current, [key]: value };
    setParameters(parameterValues.current);
    const view = live.current;
    if (view) {
      void view
        .change(
          "curves",
          vega
            .changeset()
            .remove(() => true)
            .insert(
              functionGraphData(
                { ...props.current.plot, ...parameterValues.current },
                color,
              ),
            ),
        )
        .runAsync();
    }
  };
  const commitParameters = () => {
    if (!Object.keys(parameterValues.current).length) {
      return;
    }
    props.current.onCommit({
      ...props.current.plot,
      ...parameterValues.current,
    });
    parameterValues.current = {};
  };
  const [point, setPoint] = useState<{
    expression: string;
    x: number;
    y: number;
  }>();
  const [error, setError] = useState("");
  useEffect(() => {
    const node = root.current!;
    let alive = true;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pointers = 0;
    let changed = false;
    const spec = functionGraphSpec(plot, color);
    spec.signals = functionGraphNavigation(plot);
    spec.scales![0].domain = { signal: "xdom" };
    spec.scales![1].domain = { signal: "ydom" };
    const view = createInlineVegaView(spec).renderer("svg").initialize(node);
    live.current = view;
    setParameters({});
    const domain = (): Plot => {
      const x = view.signal("xdom") as number[];
      const y = view.signal("ydom") as number[];
      return {
        ...props.current.plot,
        ...parameterValues.current,
        view: { left: x[0], right: x[1], bottom: y[0], top: y[1] },
        range: Math.max(x[1] - x[0], y[1] - y[0]) / 2,
      };
    };
    let saved = JSON.stringify(functionView(plot));
    const persist = () => {
      if (!alive || pointers || !changed) {
        return;
      }
      const next = domain();
      const signature = JSON.stringify(next.view);
      if (signature !== saved) {
        saved = signature;
        props.current.onCommit(next);
      }
      changed = false;
    };
    const refresh = () => {
      if (!alive) {
        return;
      }
      changed = true;
      setPoint(undefined);
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (!alive) {
            return;
          }
          const next = domain();
          if (!Object.values(next.view!).every(Number.isFinite)) {
            return;
          }
          void view
            .change(
              "curves",
              vega
                .changeset()
                .remove(() => true)
                .insert(functionGraphData(next, color)),
            )
            .runAsync()
            .catch((failure) => {
              if (alive) {
                setError(String(failure));
              }
            });
        });
      }
      clearTimeout(timer);
      timer = setTimeout(persist, 180);
    };
    view.addSignalListener("xdom", refresh);
    view.addSignalListener("ydom", refresh);
    view.addSignalListener("clicked", (_name, location: number[] | null) => {
      if (!location || !alive) {
        return;
      }
      const current = domain();
      const target =
        current.view!.bottom +
        location[1] * (current.view!.top - current.view!.bottom);
      const points = [current.expression, ...(current.compare || [])].flatMap(
        (expression) => {
          const found = pickFunctionPoint(
            { ...current, expression },
            { x: location[0], y: location[1] },
            plotSize,
          );
          return found ? [{ ...found, expression }] : [];
        },
      );
      setPoint(
        points.sort(
          (a, b) => Math.abs(a.y - target) - Math.abs(b.y - target),
        )[0],
      );
    });
    const down = () => {
      pointers++;
    };
    const up = () => {
      pointers = Math.max(0, pointers - 1);
      if (!pointers) {
        clearTimeout(timer);
        timer = setTimeout(persist, 0);
      }
    };
    const cancel = () => {
      pointers = 0;
      changed = false;
      const box = functionView(props.current.plot);
      void view
        .signal("xdom", [box.left, box.right])
        .signal("ydom", [box.bottom, box.top])
        .runAsync();
    };
    node.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    const reset = () => {
      const box = functionView({ ...props.current.plot, view: undefined });
      void view
        .signal("xdom", [box.left, box.right])
        .signal("ydom", [box.bottom, box.top])
        .runAsync();
      refresh();
    };
    node.addEventListener("dblclick", reset);
    void view
      .runAsync()
      .then(() => {
        if (!alive) {
          return;
        }
        const svg = node.querySelector("svg");
        svg?.setAttribute(
          "viewBox",
          `0 0 ${plotSize.width} ${plotSize.height}`,
        );
        node.id = `fc-inline-function-${id}`;
        onReady?.();
      })
      .catch((failure) => {
        if (alive) {
          setError(String(failure));
        }
      });
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      node.removeAttribute("id");
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("dblclick", reset);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      live.current = undefined;
      view.finalize();
      node.replaceChildren();
    };
  }, [id, plot, color, onReady]);
  return (
    <>
      <div
        ref={root}
        className="fc-inline-function"
        data-native-resource-object-id={id}
        aria-label={`y = ${plot.expression}`}
      />
      {["a", "b", "c"].some((key) =>
        new RegExp(`\\b${key}\\b`).test(
          [plot.expression, ...(plot.compare || [])].join(" "),
        ),
      ) && (
        <nav
          className="fc-function-parameters"
          aria-label={t("fcboard.function_controls")}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {(["a", "b", "c"] as const)
            .filter((key) =>
              new RegExp(`\\b${key}\\b`).test(
                [plot.expression, ...(plot.compare || [])].join(" "),
              ),
            )
            .map((key) => (
              <label key={key}>
                {key}
                <input
                  type="range"
                  aria-label={t("fcboard.adjust_key", { key })}
                  min={Math.min(-10, plot[key])}
                  max={Math.max(10, plot[key])}
                  step="0.1"
                  value={parameters[key] ?? plot[key]}
                  onInput={(event) =>
                    changeParameter(key, Number(event.currentTarget.value))
                  }
                  onChange={(event) =>
                    changeParameter(key, Number(event.target.value))
                  }
                  onPointerUp={commitParameters}
                  onKeyUp={commitParameters}
                  onBlur={commitParameters}
                  onPointerCancel={() => {
                    parameterValues.current = {};
                    setParameters({});
                    const view = live.current;
                    if (view) {
                      void view
                        .change(
                          "curves",
                          vega
                            .changeset()
                            .remove(() => true)
                            .insert(
                              functionGraphData(props.current.plot, color),
                            ),
                        )
                        .runAsync();
                    }
                  }}
                />
              </label>
            ))}
        </nav>
      )}
      {point && (
        <output className="fc-function-point">
          y = {point.expression}
          <br />x = {Number(point.x.toPrecision(6))}, y ={" "}
          {Number(point.y.toPrecision(6))}
        </output>
      )}
      {error && (
        <p role="alert">
          {t("fcboard.function_controls")}: {error}
        </p>
      )}
    </>
  );
};
