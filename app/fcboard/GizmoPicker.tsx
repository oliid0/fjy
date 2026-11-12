import { useState } from "react";
import ButtonBase from "@mui/material/ButtonBase";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import Paper from "@mui/material/Paper";
import Popper from "@mui/material/Popper";
import { FactoryIcon } from "@fcboard/fcboard/components/FactoryIcon";
import { t } from "@fcboard/fcboard/i18n";

import ruler from "./factory-gizmo-icons/pick-ruler.svg";
import protractor from "./factory-gizmo-icons/pick-protractor.svg";
import triangle from "./factory-gizmo-icons/pick-triangle.svg";
import compass from "./factory-gizmo-icons/pick-compass.svg";
import "./GizmoPicker.scss";
export type GizmoKind = "ruler" | "protractor" | "setSquare" | "compass";
const choices = [
  { kind: "ruler", label: "ruler", icon: ruler },
  { kind: "protractor", label: "protractor", icon: protractor },
  { kind: "setSquare", label: "set_square", icon: triangle },
  { kind: "compass", label: "compass", icon: compass },
] as const;
/** popupwindow_insert_ruler: anchored icon picker; the existing gizmo owns all drawing/undo. */
export const GizmoPicker = ({
  onInsert,
}: {
  onInsert: (kind: GizmoKind) => void;
}) => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <ClickAwayListener onClickAway={() => setAnchor(null)}>
      <div className="fc-gizmo-launcher">
        <ButtonBase
          type="button"
          data-native-tool="ruler"
          data-menu-toggle
          aria-label={t("fcboard.geometry_tools")}
          aria-haspopup="dialog"
          aria-expanded={!!anchor}
          onClick={(event) => {
            const target = event.currentTarget;
            setAnchor((old) => (old ? null : target));
          }}
        >
          <FactoryIcon name="ruler" />
          <span>{t("fcboard.geometry_tools")}</span>
        </ButtonBase>
        <Popper
          open={!!anchor}
          anchorEl={anchor}
          placement="top-start"
          modifiers={[
            { name: "offset", options: { offset: [0, 8] } },
            { name: "flip" },
            { name: "preventOverflow", options: { padding: 8 } },
          ]}
          style={{ zIndex: 1301 }}
        >
          <Paper
            className="fc-gizmo-picker"
            role="dialog"
            aria-label={t("fcboard.geometry_tools")}
            elevation={0}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                setAnchor(null);
                anchor?.focus();
              }
            }}
          >
            {choices.map((choice) => (
              <ButtonBase
                key={choice.kind}
                type="button"
                aria-label={t("fcboard.insert_name", {
                  name: t(`fcboard.${choice.label}`),
                })}
                onClick={() => {
                  setAnchor(null);
                  onInsert(choice.kind);
                }}
              >
                <img src={choice.icon} alt="" draggable={false} />
              </ButtonBase>
            ))}
          </Paper>
        </Popper>
      </div>
    </ClickAwayListener>
  );
};
