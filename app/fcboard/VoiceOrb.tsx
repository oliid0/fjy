import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { t } from "@excalidraw/excalidraw/i18n";

export const VoiceOrb = ({
  state,
  onStop,
}: {
  state: "listening" | "thinking" | "speaking";
  onStop: () => void;
}) => (
  <Tooltip title={t("fcboard.stop_listening")}>
    <IconButton
      className="fc-voice-orb"
      data-state={state}
      aria-label={t("fcboard.stop_listening")}
      aria-pressed="true"
      onClick={onStop}
      onPointerDown={(event) => event.stopPropagation()}
      sx={{
        position: "fixed",
        width: 64,
        height: 64,
        color: "#fff",
        zIndex: 36,
      }}
    >
      <span className="fc-voice-orb-water" aria-hidden="true" />
      <span className="fc-voice-orb-core" aria-hidden="true" />
    </IconButton>
  </Tooltip>
);
