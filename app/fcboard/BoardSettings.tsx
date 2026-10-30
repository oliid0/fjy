import { useEffect, useState } from "react";
import Slider from "@mui/material/Slider";
import Switch from "@mui/material/Switch";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { t, useI18n } from "@fcboard/fcboard/i18n";

import type { FcboardImperativeAPI, UIOptions } from "@fcboard/fcboard/types";

import { SettingsSection } from "./SettingsNavigation";
import {
  applyCanvasConfiguration,
  canvasConfigurationPatch,
} from "./canvasConfiguration";
import { classroomCommands } from "./commands";
import { TransientMessage } from "./TransientMessage";
import { ThresholdSettings } from "./ThresholdSettings";
import { BackgroundSettings } from "./BackgroundSettings";

export const BoardSettings = ({
  api,
  device,
}: {
  api: FcboardImperativeAPI;
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
      setError("");
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
          <BackgroundSettings state={state} onChange={update} />
        )}
      </SettingsSection>
      <SettingsSection id="home">
        <>
          <label>
            {t("fcboard.factorySettings.dual_pen")}
            <Switch
              checked={state.whiteboardDualPen ?? device?.dualPen ?? false}
              disabled={
                !(state.whiteboardThickThreshold ?? device?.thickThreshold)
              }
              onChange={(_, value) => update({ dualPen: value })}
            />
          </label>
          <label>
            {t("fcboard.toolbar_text")}
            <Switch
              checked={state.whiteboardToolbarText !== false}
              onChange={(_, checked) => update({ toolbarText: checked })}
            />
          </label>
          <label>
            {t("fcboard.factorySettings.nib")}
            <Switch
              checked={
                device?.hardNibAvailable !== false &&
                (state.whiteboardHardNib ?? device?.hardNib ?? false)
              }
              disabled={device?.hardNibAvailable === false}
              onChange={(_, checked) => update({ hardNib: checked })}
            />
          </label>
          <label>
            {t("fcboard.factorySettings.variation")}
            <Slider
              aria-label={t("fcboard.factorySettings.variation")}
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
        <ThresholdSettings
          state={state}
          device={device}
          onChange={update}
          onReset={() => {
            const scale = window.devicePixelRatio || 1;
            const defaults = device?.factoryThresholds;
            applyCanvasConfiguration(api, {
              palmEraserThreshold: defaults?.palm
                ? ((defaults.palm / scale) * 2) / 3
                : undefined,
              whiteboardFineThreshold: defaults?.fine
                ? ((defaults.fine / scale) * 4) / 5
                : undefined,
              whiteboardThickThreshold: defaults?.thick
                ? ((defaults.thick / scale) * 4) / 5
                : undefined,
            });
          }}
        />
      </SettingsSection>
      <SettingsSection id="recognition">
        <>
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
