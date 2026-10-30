import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { t, useI18n } from "@fcboard/fcboard/i18n";

import type { TranslationKeys } from "@fcboard/fcboard/i18n";

import { MaterialPanel } from "./MaterialPanel";
import { TransientMessage } from "./TransientMessage";
import { chartSvg, chartValue } from "./chartData";
import barIcon from "./factory-resource-icons/chart-bar.svg?url";
import lineIcon from "./factory-resource-icons/chart-line.svg?url";
import pieIcon from "./factory-resource-icons/chart-pie.svg?url";

import "./OriginalResourceTools.scss";

import type { ChartData } from "./chartData";

/** ChartEditDialogFragment / dialog_chart_edit. Insert the actual live preview. */
export const ChartEditor = ({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (chart: ChartData) => Promise<unknown>;
}) => {
  useI18n();
  const [rows, setRows] = useState(() =>
    [33, 55, 88].map((value, index) => ({
      id: index,
      title: `${t("fcboard.chart.defaultTitle")}${index}`,
      value: String(value),
    })),
  );
  const nextIndex = useRef(3);
  const [type, setType] = useState<ChartData["type"]>("bar");
  const [size, setSize] = useState({ width: 507, height: 328 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preview = useRef<HTMLDivElement>(null);
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
  const chart = useMemo<ChartData>(
    () => ({
      ...size,
      type,
      rows: rows.map((row) => ({
        title: row.title,
        value: chartValue(row.value),
      })),
    }),
    [rows, size, type],
  );
  const image = useMemo(
    () =>
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(chartSvg(chart))}`,
    [chart],
  );
  const change = (id: number, key: "title" | "value", value: string) => {
    if (key === "value" && !/^[\d.]*$/.test(value)) {
      return;
    }
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
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
      await onInsert(chart);
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
  return (
    <MaterialPanel
      centered
      className="fc-original-resource-tool fc-chart-editor"
      role="dialog"
      aria-label={t("fcboard.chart.title")}
      onDismiss={onClose}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          onClose();
        }
      }}
    >
      <header>
        <strong>{t("fcboard.chart.title")}</strong>
        <button aria-label={t("buttons.close")} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="fc-chart-body">
        <div className="fc-chart-data">
          <div className="fc-chart-row fc-chart-headings" aria-hidden="true">
            <span>{t("fcboard.chart.legend")}</span>
            <span>{t("fcboard.chart.data")}</span>
            <span>{t("fcboard.chart.delete")}</span>
          </div>
          <fieldset disabled={busy}>
            {rows.map((row, index) => (
              <div className="fc-chart-row" key={row.id}>
                <input
                  aria-label={`${t("fcboard.chart.legend")} ${index + 1}`}
                  value={row.title}
                  onChange={(event) =>
                    change(row.id, "title", event.target.value)
                  }
                />
                <input
                  aria-label={`${t("fcboard.chart.data")} ${index + 1}`}
                  inputMode="decimal"
                  value={row.value}
                  onChange={(event) =>
                    change(row.id, "value", event.target.value)
                  }
                />
                <button
                  aria-label={`${t("fcboard.chart.delete")} ${index + 1}`}
                  onClick={() =>
                    setRows((current) =>
                      current.filter((item) => item.id !== row.id),
                    )
                  }
                >
                  {t("fcboard.chart.delete")}
                </button>
              </div>
            ))}
          </fieldset>
          <button
            className="fc-resource-primary fc-chart-add"
            disabled={busy}
            aria-label={t("fcboard.chart.addRow")}
            onClick={() => {
              const id = nextIndex.current++;
              setRows((current) => [
                ...current,
                {
                  id,
                  title: `${t("fcboard.chart.defaultTitle")}${id}`,
                  value: "0",
                },
              ]);
            }}
          >
            +
          </button>
        </div>
        <div className="fc-chart-preview">
          <strong>{t("fcboard.chart.preview")}</strong>
          <div ref={preview}>
            <img src={image} alt={t("fcboard.chart.preview")} />
          </div>
        </div>
      </div>
      <TransientMessage message={error} role="alert" />
      <footer>
        <div role="group" aria-label={t("fcboard.chart.type")}>
          {(["bar", "line", "pie"] as const).map((kind, index) => (
            <button
              key={kind}
              disabled={busy}
              aria-label={t(`fcboard.chart.${kind}` as TranslationKeys)}
              aria-pressed={type === kind}
              onClick={() => setType(kind)}
            >
              <img src={[barIcon, lineIcon, pieIcon][index]} alt="" />
            </button>
          ))}
        </div>
        <button
          className="fc-resource-primary fc-chart-insert"
          disabled={busy}
          onClick={() => void insert()}
        >
          {busy ? t("fcboard.opening_resource") : t("fcboard.chart.insert")}
        </button>
      </footer>
    </MaterialPanel>
  );
};
