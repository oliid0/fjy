import { useLayoutEffect, useRef, useState } from "react";
import { t, useI18n } from "@fcboard/fcboard/i18n";

import type { TranslationKeys } from "@fcboard/fcboard/i18n";

import { MaterialPanel } from "./MaterialPanel";
import {
  periodicElements,
  periodicColors,
  periodicName,
  periodicCategory,
  periodicPosition,
  periodicMetrics,
} from "./periodicTableData";
import { TransientMessage } from "./TransientMessage";

import type { PeriodicElement } from "./periodicTableData";

/** dialog_periodic_table / PeriodicTableView / PeriodicTableDialogFragment. */
export const PeriodicTable = ({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (element: PeriodicElement) => Promise<unknown>;
}) => {
  useI18n();
  const [selected, setSelected] = useState(periodicElements[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [size, setSize] = useState({ width: 850, height: 559 });
  const table = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const pending = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    const measure = () => {
      const rect = table.current?.getBoundingClientRect();
      if (rect?.width && rect.height) {
        setSize({
          width: Math.max(594, rect.width),
          height: Math.max(400, rect.height),
        });
      }
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    if (table.current) {
      observer?.observe(table.current);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => {
      alive.current = false;
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const metrics = periodicMetrics(size.width, size.height);
  const rect = (column: number, row: number) => ({
    x: metrics.x + (column - 1) * (metrics.cellWidth + 2),
    y: metrics.y + (row - 1) * (metrics.cellHeight + 2),
  });
  const details = [
    ["atomic_number", String(selected.atomicNumber)],
    ["symbol", selected.symbol],
    ["name", periodicName(selected)],
    ["atomic_weight", selected.atomicWeight],
    ["category", periodicCategory(selected.category)],
    [
      "group_period_block",
      `${selected.group}, ${selected.period}, ${selected.block}`,
    ],
    ["electron_configuration", selected.electronConfiguration],
    ["shell_electrons", selected.shellElectrons],
    ["density", selected.density],
    ["melting_point", selected.meltingPoint],
    ["boiling_point", selected.boilingPoint],
    ["specific_heat", selected.specificHeat],
    ["electronegativity", selected.electronegativity],
    ["abundance", selected.abundance],
  ];
  return (
    <MaterialPanel
      centered
      className="fc-periodic-table-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={t("fcboard.periodic.title")}
      onDismiss={onClose}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          onClose();
        }
      }}
    >
      <header>
        <h2>{t("fcboard.periodic.title")}</h2>
        <button type="button" aria-label={t("fcboard.close")} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="fc-periodic-body">
        <div className="fc-periodic-board" ref={table}>
          <svg
            viewBox={`0 0 ${size.width} ${size.height}`}
            width={size.width}
            height={size.height}
          >
            {Object.keys(periodicColors).map((category, index) => {
              const width = Math.max(72, (size.width - 40) / 5);
              const x = (size.width - 5 * width) / 2 + (index % 5) * width;
              const y = 12 + Math.floor(index / 5) * 22;
              return (
                <g key={category}>
                  <rect
                    x={x}
                    y={y + 4}
                    width={10}
                    height={10}
                    rx={2}
                    fill={periodicColors[category]}
                  />
                  <text x={x + 15} y={y + 14} fontSize={11} fill="#334155">
                    {periodicCategory(category)}
                  </text>
                </g>
              );
            })}
            {[
              [6, "57-71", "lanthanide"],
              [7, "89-103", "actinide"],
            ].map(([row, label, category]) => {
              const { x, y } = rect(3, Number(row));
              return (
                <g key={row}>
                  <rect
                    x={x}
                    y={y}
                    width={metrics.cellWidth}
                    height={metrics.cellHeight}
                    rx={5}
                    fill={periodicColors[category]}
                    fillOpacity={130 / 255}
                  />
                  <text
                    x={x + metrics.cellWidth / 2}
                    y={y + metrics.cellHeight / 2 + 4}
                    textAnchor="middle"
                    fontSize={Math.max(8, metrics.cellHeight * 0.24)}
                  >
                    {label}
                  </text>
                </g>
              );
            })}
            {periodicElements.map((element) => {
              const position = periodicPosition(element);
              const { x, y } = rect(position.column, position.row);
              return (
                <g
                  role="button"
                  tabIndex={0}
                  key={element.atomicNumber}
                  aria-pressed={selected.atomicNumber === element.atomicNumber}
                  aria-label={`${element.atomicNumber} ${
                    element.symbol
                  } ${periodicName(element)}`}
                  onClick={() => setSelected(element)}
                  onKeyDown={(event) => {
                    if (["Enter", " "].includes(event.key)) {
                      event.preventDefault();
                      setSelected(element);
                    }
                  }}
                >
                  <rect
                    x={x}
                    y={y}
                    width={metrics.cellWidth}
                    height={metrics.cellHeight}
                    rx={5}
                    fill={periodicColors[element.category]}
                    fillOpacity={230 / 255}
                    stroke={
                      selected.atomicNumber === element.atomicNumber
                        ? "#2563eb"
                        : "#fff"
                    }
                    strokeWidth={
                      selected.atomicNumber === element.atomicNumber ? 2 : 1
                    }
                  />
                  <text
                    x={x + 4}
                    y={y + metrics.cellHeight * 0.25}
                    fontSize={Math.max(8, metrics.cellHeight * 0.22)}
                    fill="#374151"
                  >
                    {element.atomicNumber}
                  </text>
                  <text
                    x={x + metrics.cellWidth / 2}
                    y={y + metrics.cellHeight * 0.62}
                    textAnchor="middle"
                    fontWeight="bold"
                    fontSize={Math.max(14, metrics.cellHeight * 0.42)}
                    fill="#111827"
                  >
                    {element.symbol}
                  </text>
                  <text
                    x={x + metrics.cellWidth / 2}
                    y={y + metrics.cellHeight * 0.86}
                    textAnchor="middle"
                    fontSize={Math.max(7, metrics.cellHeight * 0.16)}
                    fill="#374151"
                  >
                    {element.atomicWeight}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <aside className="fc-periodic-details">
          <h3>{periodicName(selected)}</h3>
          <div className="fc-periodic-preview">
            <small>{selected.atomicNumber}</small>
            <strong>{selected.symbol}</strong>
            <span>{selected.atomicWeight}</span>
          </div>
          <dl>
            {details.map(([key, value]) => (
              <div key={key}>
                <dt>
                  {t(`fcboard.periodic.details.${key}` as TranslationKeys)}
                </dt>
                <dd>{value || "--"}</dd>
              </div>
            ))}
          </dl>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (pending.current) {
                return;
              }
              pending.current = true;
              setBusy(true);
              setError("");
              try {
                await onInsert(selected);
                if (alive.current) {
                  onClose();
                }
              } catch (failure) {
                if (alive.current) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : String(failure),
                  );
                }
              } finally {
                pending.current = false;
                if (alive.current) {
                  setBusy(false);
                }
              }
            }}
          >
            {t("fcboard.periodic.insert")}
          </button>
          {error && (
            <TransientMessage
              role="alert"
              message={error}
              className="fc-error"
            />
          )}
        </aside>
      </div>
    </MaterialPanel>
  );
};
