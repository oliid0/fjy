import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { t } from "@excalidraw/excalidraw/i18n";

import shadow from "./voice-orb-assets/shadow.png?url";
import background from "./voice-orb-assets/icon-bg.png?url";
import pinkTop from "./voice-orb-assets/pink-top.png?url";
import pinkLeft from "./voice-orb-assets/pink-left.png?url";
import blueMiddle from "./voice-orb-assets/blue-middle.png?url";
import blueRight from "./voice-orb-assets/blue-right.png?url";
import intersect from "./voice-orb-assets/Intersect.png?url";
import greenLeft from "./voice-orb-assets/green-left.png?url";
import greenRight from "./voice-orb-assets/green-left-2.png?url";
import bottomPink from "./voice-orb-assets/bottom-pink.png?url";
import highlight from "./voice-orb-assets/highlight.png?url";

const layers = [
  shadow,
  background,
  pinkTop,
  pinkLeft,
  blueMiddle,
  blueRight,
  intersect,
  greenRight,
  greenLeft,
  bottomPink,
  highlight,
];

export const VoiceOrb = ({
  state,
  onStop,
}: {
  state: "listening" | "thinking" | "speaking" | "paused";
  onStop: () => void;
}) => (
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
      <span className="fc-voice-orb-layers" aria-hidden="true">
        {layers.map((src, index) => (
          <img
            key={src}
            src={src}
            alt=""
            draggable={false}
            data-layer={index}
          />
        ))}
      </span>
    </IconButton>
  </Tooltip>
);
