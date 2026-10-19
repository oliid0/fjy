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
    Classroom.getInkProfile()
      .then((native) => {
        if (!disposed) {
          setProfile(cssInkProfile(native, window.devicePixelRatio));
        }
      })
      .catch(() => {
        if (!disposed) {
          setProfile(
            cssInkProfile(
              { hardPenWidth: 4, brushPenWidth: 15, eraserSize: 150 },
              window.devicePixelRatio,
            ),
          );
        }
      });
    return () => {
      disposed = true;
    };
  }, []);
  return profile;
};
