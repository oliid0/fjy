import { useRef } from "react";
import { t } from "@fcboard/fcboard/i18n";

/** HTableSettingWindow / WhiteTableSquareView: a 10 × 7 rectangle of cells. */
export const TableSizePicker = ({
  rows,
  columns,
  onChange,
  onSelect,
  disabled = false,
}: {
  rows: number;
  columns: number;
  onChange: (rows: number, columns: number) => void;
  onSelect?: (rows: number, columns: number) => void;
  disabled?: boolean;
}) => {
  const pointer = useRef<number | undefined>(undefined);
  const update = (element: HTMLElement, x: number, y: number) => {
    const rect = element.getBoundingClientRect();
    if (
      !rect.width ||
      !rect.height ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return;
    }
    const next = [
      Math.max(1, Math.min(7, Math.ceil(((y - rect.top) * 7) / rect.height))),
      Math.max(1, Math.min(10, Math.ceil(((x - rect.left) * 10) / rect.width))),
    ] as const;
    onChange(...next);
    return next;
  };
  return (
    <div className="fc-table-picker">
      <output aria-live="polite">
        {t("fcboard.rows_rows_columns_columns", { rows, columns })}
      </output>
      <div
        className="fc-table-picker-grid"
        onPointerDown={(event) => {
          if (disabled || event.button !== 0 || pointer.current !== undefined) {
            return;
          }
          pointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          update(event.currentTarget, event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (
            !disabled &&
            (pointer.current === event.pointerId ||
              (event.pointerType === "mouse" && !event.buttons))
          ) {
            update(event.currentTarget, event.clientX, event.clientY);
          }
        }}
        onPointerUp={(event) => {
          if (pointer.current === event.pointerId) {
            const next = update(
              event.currentTarget,
              event.clientX,
              event.clientY,
            );
            pointer.current = undefined;
            event.currentTarget.releasePointerCapture(event.pointerId);
            if (next && !disabled) {
              onSelect?.(...next);
            }
          }
        }}
        onLostPointerCapture={() => {
          pointer.current = undefined;
        }}
        onPointerCancel={() => {
          pointer.current = undefined;
        }}
      >
        {Array.from({ length: 70 }, (_, index) => {
          const row = Math.floor(index / 10) + 1;
          const column = (index % 10) + 1;
          return (
            <button
              type="button"
              disabled={disabled}
              key={index}
              aria-label={t("fcboard.rows_rows_columns_columns", {
                rows: row,
                columns: column,
              })}
              aria-pressed={row <= rows && column <= columns}
              onClick={(event) => {
                if (event.detail === 0) {
                  onChange(row, column);
                  onSelect?.(row, column);
                }
              }}
            />
          );
        })}
      </div>
    </div>
  );
};
