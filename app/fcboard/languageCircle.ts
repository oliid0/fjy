import { fitInkShape } from "./shapeRecognition";

import type { InkInput } from "./digitalInk";
import type { ContentRect } from "./placement";

/** A language-pen circle is a study gesture, not text to translate. */
export const circledLanguage = (
  ink: InkInput,
  targets: { id: string; bounds: ContentRect }[],
) => {
  if (fitInkShape(ink)?.shape !== "ellipse") {
    return;
  }
  const points = ink.flat();
  const region = {
    left: Math.min(...points.map(([x]) => x)),
    top: Math.min(...points.map(([, y]) => y)),
    right: Math.max(...points.map(([x]) => x)),
    bottom: Math.max(...points.map(([, y]) => y)),
  };
  const ids = targets
    .filter(
      ({ bounds }) =>
        bounds.right > region.left &&
        bounds.left < region.right &&
        bounds.bottom > region.top &&
        bounds.top < region.bottom,
    )
    .map(({ id }) => id);
  return ids.length ? { sourceIds: ids, region } : undefined;
};
