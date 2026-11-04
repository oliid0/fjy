import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { t } from "@fcboard/fcboard/i18n";

import { SiriSheet } from "./voiceorbs/SiriSheet";

export const VoiceOrb = ({
  state,
  onStop,
  caption,
  status,
}: {
  state: "listening" | "thinking" | "speaking" | "paused";
  onStop: () => void;
  caption?: string;
  status?: string;
}) => (
  <>
    {(caption || status) && (
      <div className="fc-voice-caption" role="status">
        <span title={caption}>{caption}</span>
        <small>{status}</small>
      </div>
    )}
    <Tooltip
      title={t(
        state === "paused" ? "fcboard.listening" : "fcboard.stop_listening",
      )}
    >
      <IconButton
        className="fc-voice-orb"
        data-state={state}
        aria-label={t(
          state === "paused" ? "fcboard.listening" : "fcboard.stop_listening",
        )}
        aria-pressed={state !== "paused"}
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
        <SiriSheet state={state === "paused" ? "disabled" : state} size={64} />
      </IconButton>
    </Tooltip>
  </>
);
