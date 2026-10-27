import { useEffect, useState } from "react";
import Slider from "@mui/material/Slider";
import Switch from "@mui/material/Switch";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import { factoryBackgrounds } from "@excalidraw/excalidraw/whiteboardBackground";

import type {
  ExcalidrawImperativeAPI,
  UIOptions,
} from "@excalidraw/excalidraw/types";

import { SettingsSection } from "./SettingsNavigation";
import {
  applyCanvasConfiguration,
  canvasConfigurationPatch,
} from "./canvasConfiguration";
import { classroomCommands } from "./commands";
import { TransientMessage } from "./TransientMessage";

// HDataSet.patternColorList, preserving the original five backgrounds.
const backgroundColors = [
  "#212121",
  "#576269",
  "#000000",
  "#253a35",
  "#60a96c",
];

export const BoardSettings = ({
  api,
  device,
}: {
  api: ExcalidrawImperativeAPI;
  device?: UIOptions["inkProfile"];
}) => {
  useI18n();
  const [state, setState] = useState(() => api.getAppState());
  const [document, setDocument] = useState(
    () => !!classroomCommands.read("document"),
  );
  const [error, setError] = useState("");
  useEffect(() => {
    const stops = [
      api.onChange(() => setState(api.getAppState())),
      classroomCommands.watch("document", () =>
        setDocument(!!classroomCommands.read("document")),
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [api]);
  const update = (input: Record<string, unknown>) => {
    try {
      applyCanvasConfiguration(
        api,
        canvasConfigurationPatch(api, input, device),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <>
      <SettingsSection id="background">
        {document ? (
          <p>
            {t(
              "fcboard.this_action_is_for_the_board_in_a_document_turn_pages_annotate_circle_undo_or_describe_what_to",
            )}
          </p>
        ) : (
          <>
            <label>
              {t("fcboard.background")}
              <input
                type="color"
                value={
                  /^#[\da-f]{6}$/i.test(state.viewBackgroundColor)
                    ? state.viewBackgroundColor
                    : "#ffffff"
                }
                onChange={(event) =>
                  update({ backgroundColor: event.target.value })
                }
              />
            </label>
            <div
              className="fc-background-colors"
              role="group"
              aria-label={t("fcboard.background")}
            >
              {backgroundColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`${t("fcboard.background")} ${color}`}
                  aria-pressed={
                    state.viewBackgroundColor?.toLowerCase() === color
                  }
                  style={{ backgroundColor: color }}
                  onClick={() => update({ backgroundColor: color })}
                />
              ))}
            </div>
            <div
              className="fc-background-picker"
              role="group"
              aria-label={t("fcboard.background")}
            >
              <button
                type="button"
                aria-label={t("fcboard.no_background_pattern")}
                aria-pressed={!state.whiteboardBackground}
                onClick={() => update({ backgroundPattern: 0 })}
              >
                <span aria-hidden="true">∅</span>
              </button>
              {factoryBackgrounds.map((url, index) => (
                <button
                  type="button"
                  key={url}
                  aria-label={t("fcboard.background_pattern_number", {
                    number: index + 1,
                  })}
                  aria-pressed={
                    state.whiteboardBackground?.pattern === index + 1
                  }
                  onClick={() => update({ backgroundPattern: index + 1 })}
                >
                  <img src={url} alt="" />
                </button>
              ))}
            </div>
          </>
        )}
      </SettingsSection>
      <SettingsSection id="pen">
        <>
          <label>
            {t("fcboard.hard_pen_nib")}
            <Switch
              checked={
                device?.hardNibAvailable !== false &&
                (state.whiteboardHardNib ?? device?.hardNib ?? false)
              }
              disabled={device?.hardNibAvailable === false}
              onChange={(_, checked) => update({ hardNib: checked })}
            />
          </label>
          <div className="fc-settings-choice">
            <span>{t("fcboard.pen_tip")}</span>
            <ToggleButtonGroup
              sx={{
                flexWrap: "wrap",
                maxWidth: "100%",
                "& .MuiToggleButton-root": {
                  minWidth: 0,
                  textTransform: "none",
                  overflowWrap: "anywhere",
                },
              }}
              size="small"
              exclusive
              value={state.whiteboardPenTip || "fine"}
              aria-label={t("fcboard.pen_tip")}
              onChange={(_, tip) => {
                if (tip) {
                  update({ tip });
                }
              }}
            >
              <ToggleButton value="fine">{t("fcboard.fine_pen")}</ToggleButton>
              <ToggleButton value="thick">
                {t("fcboard.thick_pen")}
              </ToggleButton>
            </ToggleButtonGroup>
          </div>
          <label>
            {t("fcboard.thick_pen_contact_threshold_px")}
            <input
              type="number"
              min="1"
              max="240"
              value={
                state.whiteboardThickThreshold ?? device?.thickThreshold ?? ""
              }
              onChange={(event) => {
                const value = event.target.valueAsNumber;
                if (Number.isFinite(value) && value >= 1 && value <= 240) {
                  update({ thickThreshold: value });
                }
              }}
            />
          </label>
          <label>
            {t("fcboard.detect_pen_tip_automatically")}
            <Switch
              checked={state.whiteboardDualPen ?? device?.dualPen ?? false}
              disabled={
                !(state.whiteboardThickThreshold ?? device?.thickThreshold)
              }
              onChange={(_, value) => update({ dualPen: value })}
            />
          </label>
          <label>
            {t("fcboard.stroke_width_variation")}
            <Slider
              aria-label={t("fcboard.stroke_width_variation")}
              min={0}
              max={50}
              valueLabelDisplay="auto"
              value={state.whiteboardBrushVariation ?? 45}
              onChange={(_, value) => update({ brushVariation: value })}
            />
            <output>{state.whiteboardBrushVariation ?? 45}</output>
          </label>
        </>
      </SettingsSection>
      <SettingsSection id="touch">
        <>
          <label>
            {t("fcboard.palm_erasing")}
            <Switch
              checked={state.palmEraser !== false}
              onChange={(_, checked) => update({ palmEraser: checked })}
            />
          </label>
          <label>
            {t("fcboard.palm_eraser_threshold")}
            <Slider
              aria-label={t("fcboard.palm_eraser_threshold")}
              min={16}
              max={120}
              valueLabelDisplay="auto"
              value={state.palmEraserThreshold ?? device?.palmThreshold ?? 36}
              onChange={(_, value) => update({ palmThreshold: value })}
            />
            <output>
              {state.palmEraserThreshold ?? device?.palmThreshold ?? 36}px
            </output>
          </label>
        </>
      </SettingsSection>
      {error && (
        <TransientMessage role="alert" className="fc-error" message={error} />
      )}
    </>
  );
};
