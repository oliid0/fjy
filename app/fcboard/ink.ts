import { Capacitor } from "@capacitor/core";
import { useEffect, useState } from "react";

import type { UIOptions } from "@fcboard/fcboard/types";

const displayInkProfile = (): UIOptions["inkProfile"] => {
  if (!Capacitor.isNativePlatform()) {
    return undefined;
  }
  const dpr = window.devicePixelRatio;
  const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return {
    hardPenWidth: 4 / scale,
    brushPenWidth: 15 / scale,
    eraserSize: 150 / scale,
    palmThreshold: 36,
    penWidthMax: 40,
  };
};

export const useDeviceInkProfile = () => {
  const [profile, setProfile] = useState(displayInkProfile);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    let dpr = window.devicePixelRatio;
    let media = window.matchMedia?.(`(resolution: ${dpr}dppx)`);
    const updateDensity = () => {
      const next = window.devicePixelRatio;
      if (next === dpr) {
        return;
      }
      media?.removeEventListener?.("change", updateDensity);
      dpr = next;
      media = window.matchMedia?.(`(resolution: ${dpr}dppx)`);
      media?.addEventListener?.("change", updateDensity);
      setProfile(displayInkProfile());
    };
    media?.addEventListener?.("change", updateDensity);
    window.addEventListener("resize", updateDensity);
    return () => {
      media?.removeEventListener?.("change", updateDensity);
      window.removeEventListener("resize", updateDensity);
    };
  }, []);
  return profile;
};
