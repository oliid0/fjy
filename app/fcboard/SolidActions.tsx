import { useState } from "react";
import { t } from "@fcboard/fcboard/i18n";
import ButtonBase from "@mui/material/ButtonBase";
import Popover from "@mui/material/Popover";
import Slider from "@mui/material/Slider";

import { classroomCommands } from "./commands";
import { cubeNets, cylinderNets } from "./solidGeometry";
import { solidFaces } from "./solids";

import type { Widget } from "./widgets";

const faceNames = {
  front: "front_face",
  back: "back_face",
  left: "left_face",
  right: "right_face",
  top: "top_face",
  bottom: "bottom_face",
  side: "side_surface",
} as const;
const colors = [
  "#245bd6",
  "#ef4444",
  "#facc15",
  "#22c55e",
  "#ffffff",
  "#17243c",
  "transparent",
];

/** Object controls join the existing copy/delete/search/AI row. */
export const SolidActions = ({
  widget,
  disabled,
  onError,
}: {
  widget: Widget;
  disabled: boolean;
  onError: (message: string) => void;
}) => {
  const [popup, setPopup] = useState<{
    mode: "nets" | "colors" | "rotation";
    anchor: HTMLElement;
  }>();
  const [face, setFace] = useState(widget.kind === "cube" ? "front" : "side");
  const [busy, setBusy] = useState(false);
  const settings = widget.params.solid;
  const foldable = widget.kind === "cube" || widget.kind === "cylinder";
  const colorLabel = t(
    foldable ? "fcboard.face_colors" : "fcboard.shape_color",
  );
  const apply = async (changes: Record<string, unknown>) => {
    setBusy(true);
    try {
      await classroomCommands.execute({
        name: "tools.configure",
        args: { ...changes, id: widget.id },
      });
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === "AbortError")) {
        onError(String(failure));
      }
    } finally {
      setBusy(false);
    }
  };
  const button = (
    label: string,
    icon: React.ReactNode,
    action: (event: React.MouseEvent<HTMLButtonElement>) => void,
    selected = false,
  ) => (
    <ButtonBase
      aria-label={label}
      title={label}
      aria-pressed={selected}
      disabled={disabled || busy}
      onClick={action}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        {icon}
      </svg>
    </ButtonBase>
  );
  const opening =
    (mode: "nets" | "colors" | "rotation") =>
    (event: React.MouseEvent<HTMLButtonElement>) =>
      setPopup({ mode, anchor: event.currentTarget });
  return (
    <>
      {button(
        t("fcboard.rotate_shape"),
        <>
          <path d="M5 8a8 8 0 1 1-1 8M5 3v5H0" />
          <path d="m10 9 6 3-6 3z" />
        </>,
        opening("rotation"),
      )}
      {foldable &&
        button(
          t(
            settings.unfold >= 0.5
              ? "fcboard.fold_shape"
              : "fcboard.unfold_shape",
          ),
          <>
            <path d="M3 9h6v6H3zM9 3h6v6H9zM9 9h6v6H9zM15 9h6v6h-6zM9 15h6v6H9z" />
          </>,
          () =>
            void apply({ solid: { unfold: settings.unfold >= 0.5 ? 0 : 1 } }),
          settings.unfold >= 0.5,
        )}
      {foldable &&
        button(
          t("fcboard.unfolding_nets"),
          <>
            <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
          </>,
          opening("nets"),
        )}
      {button(
        colorLabel,
        <>
          <path d="m4 13 9-9 7 7-9 9H4zM13 4l-2-2M4 13h16" />
          <path d="M20 17c-3 4-3 5 0 5s3-1 0-5" />
        </>,
        opening("colors"),
      )}
      {button(
        t("fcboard.show_edges"),
        <>
          <path d="M4 4h16v16H4z" />
          <path d="m4 4 16 16" strokeDasharray="2 2" />
        </>,
        () => void apply({ solid: { border: !settings.border } }),
        settings.border,
      )}
      {button(
        t("fcboard.close_tool_controls"),
        <path d="m6 6 12 12M18 6 6 18" />,
        () => {
          void classroomCommands
            .execute({ name: "canvas.select", args: { ids: [] } })
            .catch((error) => onError(String(error)));
        },
      )}
      <Popover
        open={!!popup}
        anchorEl={popup?.anchor}
        onClose={() => setPopup(undefined)}
        disablePortal
        disableScrollLock
        marginThreshold={12}
        anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
        transformOrigin={{ horizontal: "center", vertical: "top" }}
        slotProps={{
          paper: {
            role: "dialog",
            "aria-label":
              popup?.mode === "nets"
                ? t("fcboard.unfolding_nets")
                : popup?.mode === "colors"
                ? colorLabel
                : t("fcboard.rotate_shape"),
            sx: {
              p: 1.5,
              mt: 1,
              width: popup?.mode === "nets" ? 360 : 280,
              maxWidth: "calc(100vw - 24px)",
              maxHeight: "min(320px, calc(100dvh - 24px))",
              borderRadius: 1.5,
              backgroundImage: "none",
              color: "var(--fc-ink, #17243c)",
              backgroundColor: "var(--fc-surface, #fff)",
              fontFamily: "inherit",
              fontSize: 13,
            },
          },
        }}
      >
        {popup?.mode === "rotation" && (
          <Slider
            aria-label={t("fcboard.rotation")}
            min={-180}
            max={180}
            step={1}
            value={widget.params.rotation}
            valueLabelDisplay="auto"
            disabled={busy}
            onChange={(_, value) => {
              if (typeof value === "number") {
                void apply({ rotation: value });
              }
            }}
          />
        )}
        {popup?.mode === "nets" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 6,
            }}
          >
            {(widget.kind === "cube" ? cubeNets : cylinderNets).map(
              (_, index) => (
                <ButtonBase
                  key={index}
                  aria-label={t("fcboard.net_index", {
                    index: index + 1,
                  })}
                  aria-pressed={settings.net === index}
                  disabled={busy}
                  style={{
                    width: "100%",
                    height: 70,
                    border: "1px solid var(--fc-border, #dce3ec)",
                    borderRadius: 4,
                    backgroundColor:
                      settings.net === index ? "#e6efff" : "transparent",
                  }}
                  onClick={() => {
                    setPopup(undefined);
                    void apply({ solid: { net: index, unfold: 1 } });
                  }}
                >
                  {widget.kind === "cube" ? (
                    <svg
                      style={{ width: 72, height: 58 }}
                      viewBox={`${
                        Math.min(...cubeNets[index].cells.map(([x]) => x)) - 0.2
                      } ${
                        Math.min(...cubeNets[index].cells.map(([, y]) => y)) -
                        0.2
                      } ${
                        Math.max(...cubeNets[index].cells.map(([x]) => x)) + 1.4
                      } ${
                        Math.max(...cubeNets[index].cells.map(([, y]) => y)) +
                        1.4
                      }`}
                    >
                      {cubeNets[index].joints.map((joint, i) => (
                        <rect
                          key={i}
                          x={joint.cell[0]}
                          y={joint.cell[1]}
                          width={1}
                          height={1}
                          stroke="#67758c"
                          strokeWidth={0.05}
                          fill={
                            settings.colors[cubeNets[index].faceIds[i]] ||
                            "none"
                          }
                        />
                      ))}
                    </svg>
                  ) : (
                    <svg
                      style={{ width: 72, height: 58 }}
                      viewBox="-2 -1.25 4 3.5"
                    >
                      <rect
                        x={-Math.PI / 2}
                        y={0}
                        width={Math.PI}
                        height={1}
                        fill={settings.colors.side || "none"}
                        stroke="#67758c"
                        strokeWidth={0.05}
                      />
                      <circle
                        cx={(cylinderNets[index][0] * Math.PI) / 2}
                        cy={-0.5}
                        r={0.5}
                        fill={settings.colors.top || "none"}
                        stroke="#67758c"
                        strokeWidth={0.05}
                      />
                      <circle
                        cx={(cylinderNets[index][1] * Math.PI) / 2}
                        cy={1.5}
                        r={0.5}
                        fill={settings.colors.bottom || "none"}
                        stroke="#67758c"
                        strokeWidth={0.05}
                      />
                    </svg>
                  )}
                </ButtonBase>
              ),
            )}
          </div>
        )}
        {popup?.mode === "colors" && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 6,
                marginBottom: 12,
              }}
            >
              {(foldable
                ? solidFaces(widget.kind === "cube" ? "cube" : "cylinder")
                : []
              ).map((id) => (
                <ButtonBase
                  key={id}
                  aria-label={t(
                    `fcboard.${faceNames[id as keyof typeof faceNames]}`,
                  )}
                  aria-pressed={face === id}
                  style={{
                    width: "100%",
                    height: 36,
                    gap: 6,
                    borderRadius: 4,
                    backgroundColor: face === id ? "#e6efff" : "transparent",
                  }}
                  onClick={() => setFace(id)}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      border: "1px solid #9aa6b8",
                      backgroundColor: settings.colors[id] || "transparent",
                    }}
                  />
                  {t(`fcboard.${faceNames[id as keyof typeof faceNames]}`)}
                </ButtonBase>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {colors.map((color) => (
                <ButtonBase
                  key={color}
                  aria-label={
                    color === "transparent" ? t("fcboard.transparent") : color
                  }
                  aria-pressed={
                    (foldable ? settings.colors[face] : settings.stroke) ===
                    color
                  }
                  disabled={busy}
                  style={{
                    width: 28,
                    height: 28,
                    border: "1px solid #9aa6b8",
                    borderRadius: 14,
                    backgroundColor: color,
                  }}
                  onClick={() =>
                    void apply({
                      solid: foldable
                        ? { colors: { [face]: color } }
                        : { stroke: color },
                    })
                  }
                >
                  {color === "transparent" ? "∅" : ""}
                </ButtonBase>
              ))}
            </div>
          </>
        )}
      </Popover>
    </>
  );
};
