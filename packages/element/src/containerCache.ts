import type { FcboardTextContainer } from "./types";

export const originalContainerCache: {
  [id: FcboardTextContainer["id"]]:
    | {
        height: FcboardTextContainer["height"];
      }
    | undefined;
} = {};

export const updateOriginalContainerCache = (
  id: FcboardTextContainer["id"],
  height: FcboardTextContainer["height"],
) => {
  const data =
    originalContainerCache[id] || (originalContainerCache[id] = { height });
  data.height = height;
  return data;
};

export const resetOriginalContainerCache = (id: FcboardTextContainer["id"]) => {
  if (originalContainerCache[id]) {
    delete originalContainerCache[id];
  }
};

export const getOriginalContainerHeightFromCache = (
  id: FcboardTextContainer["id"],
) => {
  return originalContainerCache[id]?.height ?? null;
};
