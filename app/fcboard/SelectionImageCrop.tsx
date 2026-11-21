import { useEffect, useRef, useState } from "react";
import ButtonBase from "@mui/material/ButtonBase";
import { loadHTMLImageElement } from "@fcboard/element/image";
import { t } from "@fcboard/fcboard/i18n";

import type { DataURL } from "@fcboard/fcboard/types";

import { SelectionIcon } from "./SelectionProperties";
import { fullCrop, moveCropRegion, cropImageFrame } from "./imageCropGeometry";
import "./SelectionImageCrop.scss";

import type { CropFrame, CropRegion } from "./imageCropGeometry";

export const SelectionImageCrop = ({
  image,
  frame,
  viewport,
  toolbar,
  onApply,
  onCancel,
}: {
  image: DataURL;
  frame: CropFrame;
  viewport: { left: number; top: number; width: number; height: number };
  toolbar: { left: number; top: number };
  onApply: (updates: ReturnType<typeof cropImageFrame>) => void;
  onCancel: () => void;
}) => {
  const [region, setRegion] = useState<CropRegion>(fullCrop);
  const [natural, setNatural] = useState(
    frame.crop
      ? { width: frame.crop.naturalWidth, height: frame.crop.naturalHeight }
      : undefined,
  );
  const [error, setError] = useState(false);
  const drag = useRef<
    | {
        id: number;
        handle: string;
        x: number;
        y: number;
        before: CropRegion;
      }
    | undefined
  >(undefined);
  useEffect(() => {
    if (frame.crop) {
      return;
    }
    let active = true;
    void loadHTMLImageElement(image).then(
      (image) => {
        if (active) {
          setNatural({
            width: image.naturalWidth,
            height: image.naturalHeight,
          });
        }
      },
      () => {
        if (active) {
          setError(true);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [image, frame.crop]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [onCancel]);
  const position = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left - bounds.width / 2;
    const y = event.clientY - bounds.top - bounds.height / 2;
    const cos = Math.cos(frame.angle);
    const sin = Math.sin(frame.angle);
    return {
      x: (x * cos + y * sin) / viewport.width + 0.5,
      y: (y * cos - x * sin) / viewport.height + 0.5,
    };
  };
  const left = region.left * viewport.width;
  const top = region.top * viewport.height;
  const width = (region.right - region.left) * viewport.width;
  const height = (region.bottom - region.top) * viewport.height;
  const handles = [
    ["nw", left, top],
    ["n", left + width / 2, top],
    ["ne", left + width, top],
    ["e", left + width, top + height / 2],
    ["se", left + width, top + height],
    ["s", left + width / 2, top + height],
    ["sw", left, top + height],
    ["w", left, top + height / 2],
  ] as const;
  return (
    <>
      <svg
        className="fc-selection-crop"
        role="group"
        aria-label={t("helpDialog.cropStart")}
        width={viewport.width}
        height={viewport.height}
        style={{
          left: viewport.left,
          top: viewport.top,
          transform: `rotate(${frame.angle}rad)`,
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || drag.current) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          const handle = (event.target as Element).getAttribute(
            "data-crop-handle",
          );
          if (!handle) {
            return;
          }
          const at = position(event);
          drag.current = { id: event.pointerId, handle, ...at, before: region };
          try {
            event.currentTarget.setPointerCapture?.(event.pointerId);
          } catch {
            drag.current = undefined;
          }
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (!active || active.id !== event.pointerId) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          const at = position(event);
          setRegion(
            moveCropRegion(
              active.before,
              active.handle,
              at.x - active.x,
              at.y - active.y,
              Math.min(1, (20 * 0.67) / viewport.width),
              Math.min(1, (20 * 0.67) / viewport.height),
            ),
          );
        }}
        onPointerUp={(event) => {
          if (drag.current?.id === event.pointerId) {
            drag.current = undefined;
            if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }
        }}
        onPointerCancel={(event) => {
          if (drag.current?.id === event.pointerId) {
            setRegion(drag.current.before);
            drag.current = undefined;
          }
        }}
      >
        <rect
          data-crop-handle="move"
          x={left}
          y={top}
          width={width}
          height={height}
          fill="transparent"
          stroke="#0368ff"
          strokeWidth={2}
        />
        {handles.map(([name, x, y]) => (
          <g key={name}>
            <rect
              data-crop-handle={name}
              x={x - 8 * 0.67}
              y={y - 8 * 0.67}
              width={16 * 0.67}
              height={16 * 0.67}
              fill="transparent"
            />
            <rect
              data-crop-handle={name}
              x={x - 3 * 0.67}
              y={y - 3 * 0.67}
              width={6 * 0.67}
              height={6 * 0.67}
              fill="#0368ff"
            />
          </g>
        ))}
      </svg>
      <div
        className="fc-selection-actions"
        style={{
          left: toolbar.left,
          top: toolbar.top,
          width: (2 * 56 + 12) * 0.67,
        }}
      >
        <div role="toolbar" aria-label={t("helpDialog.cropStart")}>
          <ButtonBase onClick={onCancel} aria-label={t("buttons.cancel")}>
            <SelectionIcon name="cancel" />
            <span>{t("buttons.cancel")}</span>
          </ButtonBase>
          <ButtonBase
            disabled={!natural || error}
            onClick={() => {
              if (
                region.left === 0 &&
                region.top === 0 &&
                region.right === 1 &&
                region.bottom === 1
              ) {
                onCancel();
                return;
              }
              if (natural) {
                onApply(
                  cropImageFrame(frame, region, natural.width, natural.height),
                );
              }
            }}
            aria-label={t("buttons.confirm")}
          >
            <SelectionIcon name="confirm" />
            <span>{t("buttons.confirm")}</span>
          </ButtonBase>
        </div>
        {error && (
          <p role="alert">{t("fcboard.could_not_read_document_image")}</p>
        )}
      </div>
    </>
  );
};
