import { Capacitor } from "@capacitor/core";
import { useEffect, useState } from "react";

import type { UIOptions } from "@excalidraw/excalidraw/types";

import { Classroom } from "./native";

export const cssInkProfile = (
  native: {
    hardPenWidth: number;
    brushPenWidth: number;
    eraserSize: number;
    palmThreshold?: number;
  },
  dpr: number,
): UIOptions["inkProfile"] => {
  const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const positive = (value: number | undefined, fallback: number) =>
    value && Number.isFinite(value) && value > 0 ? value / scale : fallback;
  return {
    hardPenWidth: positive(native.hardPenWidth, 4 / scale),
    brushPenWidth: positive(native.brushPenWidth, 15 / scale),
    eraserSize: positive(native.eraserSize, 150 / scale),
    palmThreshold: positive(native.palmThreshold, 36),
  };
};

export const useDeviceInkProfile = () => {
  const [profile, setProfile] = useState<UIOptions["inkProfile"]>();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    let disposed = false;
    let native: Awaited<ReturnType<typeof Classroom.getInkProfile>>;
    let dpr = window.devicePixelRatio;
    let media = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const updateDensity = () => {
      const next = window.devicePixelRatio;
      if (next === dpr) {
        return;
      }
      media.removeEventListener("change", updateDensity);
      dpr = next;
      media = window.matchMedia(`(resolution: ${dpr}dppx)`);
      media.addEventListener("change", updateDensity);
      if (native) {
        setProfile(cssInkProfile(native, dpr));
      }
    };
    media.addEventListener("change", updateDensity);
    window.addEventListener("resize", updateDensity);
    Classroom.getInkProfile()
      .then((value) => {
        if (!disposed) {
          native = value;
          setProfile(cssInkProfile(native, window.devicePixelRatio));
        }
      })
      .catch(() => {
        if (!disposed) {
          native = { hardPenWidth: 4, brushPenWidth: 15, eraserSize: 150 };
          setProfile(cssInkProfile(native, window.devicePixelRatio));
        }
      });
    return () => {
      disposed = true;
      media.removeEventListener("change", updateDensity);
      window.removeEventListener("resize", updateDensity);
    };
  }, []);
  return profile;
};
