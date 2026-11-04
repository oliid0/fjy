import { t } from "@fcboard/fcboard/i18n";

import type { DataURL } from "@fcboard/fcboard/types";

import type { ContentRect } from "./placement";

export type SubjectLayer = {
  image: HTMLImageElement;
  bounds: ContentRect;
  zIndex: number;
};

/** Compose only the provider's foreground PNG layers, never its z_index=0 base. */
export const transparentInkImage = (layers: SubjectLayer[]) => {
  if (
    !layers.length ||
    layers.length > 16 ||
    new Set(layers.map((layer) => layer.zIndex)).size !== layers.length ||
    layers.some(
      ({ bounds, zIndex }) =>
        !Number.isInteger(zIndex) ||
        zIndex <= 0 ||
        !Object.values(bounds).every(Number.isFinite) ||
        bounds.left < 0 ||
        bounds.top < 0 ||
        bounds.right <= bounds.left ||
        bounds.bottom <= bounds.top,
    )
  ) {
    throw new Error(t("fcboard.no_subject_layers_returned"));
  }
  const left = Math.min(...layers.map((layer) => layer.bounds.left));
  const top = Math.min(...layers.map((layer) => layer.bounds.top));
  const width = Math.max(...layers.map((layer) => layer.bounds.right)) - left;
  const height = Math.max(...layers.map((layer) => layer.bounds.bottom)) - top;
  const scale = Math.min(1, 2048 / Math.max(width, height));
  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.round(width * scale));
  output.height = Math.max(1, Math.round(height * scale));
  const context = output.getContext("2d");
  const sample = document.createElement("canvas");
  const sampleContext = sample.getContext("2d", { willReadFrequently: true });
  if (!context || !sampleContext) {
    throw new Error(t("fcboard.the_image_service_returned_no_valid_image"));
  }
  for (const layer of [...layers].sort((a, b) => a.zIndex - b.zIndex)) {
    // Check decoded alpha at bounded cost; white parts of the subject stay intact.
    const sampleScale = Math.min(
      1,
      256 / Math.max(layer.image.naturalWidth, layer.image.naturalHeight),
    );
    sample.width = Math.max(
      1,
      Math.round(layer.image.naturalWidth * sampleScale),
    );
    sample.height = Math.max(
      1,
      Math.round(layer.image.naturalHeight * sampleScale),
    );
    sampleContext.drawImage(layer.image, 0, 0, sample.width, sample.height);
    const pixels = sampleContext.getImageData(
      0,
      0,
      sample.width,
      sample.height,
    ).data;
    let visible = false;
    let transparent = false;
    for (let i = 3; i < pixels.length; i += 4) {
      visible ||= pixels[i] > 0;
      transparent ||= pixels[i] < 255;
    }
    if (!visible || !transparent) {
      throw new Error(t("fcboard.subject_layer_requires_transparency"));
    }
    context.drawImage(
      layer.image,
      (layer.bounds.left - left) * scale,
      (layer.bounds.top - top) * scale,
      (layer.bounds.right - layer.bounds.left) * scale,
      (layer.bounds.bottom - layer.bounds.top) * scale,
    );
  }
  return {
    dataURL: output.toDataURL("image/png") as DataURL,
    width: output.width,
    height: output.height,
  };
};
