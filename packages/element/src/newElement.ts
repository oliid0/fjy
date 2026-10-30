import {
  DEFAULT_ELEMENT_PROPS,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  DEFAULT_TEXT_ALIGN,
  DEFAULT_VERTICAL_ALIGN,
  VERTICAL_ALIGN,
  randomInteger,
  randomId,
  getFontString,
  getUpdatedTimestamp,
  getLineHeight,
} from "@fcboard/common";

import type { Radians } from "@fcboard/math";

import type { MarkOptional, Merge } from "@fcboard/common/utility-types";

import {
  getElementAbsoluteCoords,
  getResizedElementAbsoluteCoords,
} from "./bounds";
import { newElementWith } from "./mutateElement";
import { getBoundTextMaxWidth } from "./textElement";
import { normalizeText, measureText } from "./textMeasurements";
import { wrapText } from "./textWrapping";

import { isLineElement } from "./typeChecks";

import type {
  FcboardElement,
  FcboardImageElement,
  FcboardTextElement,
  FcboardLinearElement,
  FcboardGenericElement,
  NonDeleted,
  TextAlign,
  VerticalAlign,
  Arrowhead,
  FcboardFreeDrawElement,
  FontFamilyValues,
  FcboardTextContainer,
  FcboardFrameElement,
  FcboardEmbeddableElement,
  FcboardMagicFrameElement,
  FcboardIframeElement,
  ElementsMap,
  FcboardArrowElement,
  FcboardElbowArrowElement,
  FcboardLineElement,
} from "./types";

export type ElementConstructorOpts = MarkOptional<
  Omit<FcboardGenericElement, "id" | "type" | "isDeleted" | "updated">,
  | "width"
  | "height"
  | "angle"
  | "groupIds"
  | "frameId"
  | "index"
  | "boundElements"
  | "seed"
  | "version"
  | "versionNonce"
  | "link"
  | "strokeStyle"
  | "fillStyle"
  | "strokeColor"
  | "backgroundColor"
  | "roughness"
  | "strokeWidth"
  | "roundness"
  | "locked"
  | "opacity"
  | "customData"
>;

const _newElementBase = <T extends FcboardElement>(
  type: T["type"],
  {
    x,
    y,
    strokeColor = DEFAULT_ELEMENT_PROPS.strokeColor,
    backgroundColor = DEFAULT_ELEMENT_PROPS.backgroundColor,
    fillStyle = DEFAULT_ELEMENT_PROPS.fillStyle,
    strokeWidth = DEFAULT_ELEMENT_PROPS.strokeWidth,
    strokeStyle = DEFAULT_ELEMENT_PROPS.strokeStyle,
    roughness = DEFAULT_ELEMENT_PROPS.roughness,
    opacity = DEFAULT_ELEMENT_PROPS.opacity,
    width = 0,
    height = 0,
    angle = 0 as Radians,
    groupIds = [],
    frameId = null,
    index = null,
    roundness = null,
    boundElements = null,
    link = null,
    locked = DEFAULT_ELEMENT_PROPS.locked,
    ...rest
  }: ElementConstructorOpts & Omit<Partial<FcboardGenericElement>, "type">,
) => {
  // NOTE (mtolmacs): This is a temporary check to detect extremely large
  // element position or sizing
  if (
    x < -1e6 ||
    x > 1e6 ||
    y < -1e6 ||
    y > 1e6 ||
    width < -1e6 ||
    width > 1e6 ||
    height < -1e6 ||
    height > 1e6
  ) {
    console.error("New element size or position is too large", {
      x,
      y,
      width,
      height,
      // @ts-ignore
      points: rest.points,
    });
  }

  // assign type to guard against excess properties
  const element: Merge<FcboardGenericElement, { type: T["type"] }> = {
    id: rest.id || randomId(),
    type,
    x,
    y,
    width,
    height,
    angle,
    strokeColor,
    backgroundColor,
    fillStyle,
    strokeWidth,
    strokeStyle,
    roughness,
    opacity,
    groupIds,
    frameId,
    index,
    roundness,
    seed: rest.seed ?? randomInteger(),
    version: rest.version || 1,
    versionNonce: rest.versionNonce ?? 0,
    isDeleted: false as false,
    boundElements,
    updated: getUpdatedTimestamp(),
    link,
    locked,
    customData: rest.customData,
  };
  return element;
};

export const newElement = (
  opts: {
    type: FcboardGenericElement["type"];
  } & ElementConstructorOpts,
): NonDeleted<FcboardGenericElement> =>
  _newElementBase<FcboardGenericElement>(opts.type, opts);

export const newEmbeddableElement = (
  opts: {
    type: "embeddable";
  } & ElementConstructorOpts,
): NonDeleted<FcboardEmbeddableElement> => {
  return _newElementBase<FcboardEmbeddableElement>("embeddable", opts);
};

export const newIframeElement = (
  opts: {
    type: "iframe";
  } & ElementConstructorOpts,
): NonDeleted<FcboardIframeElement> => {
  return {
    ..._newElementBase<FcboardIframeElement>("iframe", opts),
  };
};

export const newFrameElement = (
  opts: {
    name?: string;
  } & ElementConstructorOpts,
): NonDeleted<FcboardFrameElement> => {
  const frameElement = newElementWith(
    {
      ..._newElementBase<FcboardFrameElement>("frame", opts),
      type: "frame",
      name: opts?.name || null,
    },
    {},
  );

  return frameElement;
};

export const newMagicFrameElement = (
  opts: {
    name?: string;
  } & ElementConstructorOpts,
): NonDeleted<FcboardMagicFrameElement> => {
  const frameElement = newElementWith(
    {
      ..._newElementBase<FcboardMagicFrameElement>("magicframe", opts),
      type: "magicframe",
      name: opts?.name || null,
    },
    {},
  );

  return frameElement;
};

/** computes element x/y offset based on textAlign/verticalAlign */
const getTextElementPositionOffsets = (
  opts: {
    textAlign: FcboardTextElement["textAlign"];
    verticalAlign: FcboardTextElement["verticalAlign"];
  },
  metrics: {
    width: number;
    height: number;
  },
) => {
  return {
    x:
      opts.textAlign === "center"
        ? metrics.width / 2
        : opts.textAlign === "right"
        ? metrics.width
        : 0,
    y: opts.verticalAlign === "middle" ? metrics.height / 2 : 0,
  };
};

export const newTextElement = (
  opts: {
    text: string;
    originalText?: string;
    fontSize?: number;
    fontFamily?: FontFamilyValues;
    textAlign?: TextAlign;
    verticalAlign?: VerticalAlign;
    containerId?: FcboardTextContainer["id"] | null;
    lineHeight?: FcboardTextElement["lineHeight"];
    autoResize?: FcboardTextElement["autoResize"];
  } & ElementConstructorOpts,
): NonDeleted<FcboardTextElement> => {
  const fontFamily = opts.fontFamily || DEFAULT_FONT_FAMILY;
  const fontSize = opts.fontSize || DEFAULT_FONT_SIZE;
  const lineHeight = opts.lineHeight || getLineHeight(fontFamily);
  const text = normalizeText(opts.text);
  const metrics = measureText(
    text,
    getFontString({ fontFamily, fontSize }),
    lineHeight,
  );
  const textAlign = opts.textAlign || DEFAULT_TEXT_ALIGN;
  const verticalAlign = opts.verticalAlign || DEFAULT_VERTICAL_ALIGN;
  const offsets = getTextElementPositionOffsets(
    { textAlign, verticalAlign },
    metrics,
  );

  const textElementProps: FcboardTextElement = {
    ..._newElementBase<FcboardTextElement>("text", opts),
    text,
    fontSize,
    fontFamily,
    textAlign,
    verticalAlign,
    x: opts.x - offsets.x,
    y: opts.y - offsets.y,
    width: metrics.width,
    height: metrics.height,
    containerId: opts.containerId || null,
    originalText: opts.originalText ?? text,
    autoResize: opts.autoResize ?? true,
    lineHeight,
  };

  const textElement: FcboardTextElement = newElementWith(textElementProps, {});

  return textElement;
};

const getAdjustedDimensions = (
  element: FcboardTextElement,
  elementsMap: ElementsMap,
  nextText: string,
): {
  x: number;
  y: number;
  width: number;
  height: number;
} => {
  let { width: nextWidth, height: nextHeight } = measureText(
    nextText,
    getFontString(element),
    element.lineHeight,
  );

  // wrapped text
  if (!element.autoResize) {
    nextWidth = element.width;
  }

  const { textAlign, verticalAlign } = element;
  let x: number;
  let y: number;
  if (
    textAlign === "center" &&
    verticalAlign === VERTICAL_ALIGN.MIDDLE &&
    !element.containerId &&
    element.autoResize
  ) {
    const prevMetrics = measureText(
      element.text,
      getFontString(element),
      element.lineHeight,
    );
    const offsets = getTextElementPositionOffsets(element, {
      width: nextWidth - prevMetrics.width,
      height: nextHeight - prevMetrics.height,
    });

    x = element.x - offsets.x;
    y = element.y - offsets.y;
  } else {
    const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);

    const [nextX1, nextY1, nextX2, nextY2] = getResizedElementAbsoluteCoords(
      element,
      nextWidth,
      nextHeight,
      false,
    );
    const deltaX1 = (x1 - nextX1) / 2;
    const deltaY1 = (y1 - nextY1) / 2;
    const deltaX2 = (x2 - nextX2) / 2;
    const deltaY2 = (y2 - nextY2) / 2;

    [x, y] = adjustXYWithRotation(
      {
        s: true,
        e: textAlign === "center" || textAlign === "left",
        w: textAlign === "center" || textAlign === "right",
      },
      element.x,
      element.y,
      element.angle,
      deltaX1,
      deltaY1,
      deltaX2,
      deltaY2,
    );
  }

  return {
    width: nextWidth,
    height: nextHeight,
    x: Number.isFinite(x) ? x : element.x,
    y: Number.isFinite(y) ? y : element.y,
  };
};

const adjustXYWithRotation = (
  sides: {
    n?: boolean;
    e?: boolean;
    s?: boolean;
    w?: boolean;
  },
  x: number,
  y: number,
  angle: number,
  deltaX1: number,
  deltaY1: number,
  deltaX2: number,
  deltaY2: number,
): [number, number] => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  if (sides.e && sides.w) {
    x += deltaX1 + deltaX2;
  } else if (sides.e) {
    x += deltaX1 * (1 + cos);
    y += deltaX1 * sin;
    x += deltaX2 * (1 - cos);
    y += deltaX2 * -sin;
  } else if (sides.w) {
    x += deltaX1 * (1 - cos);
    y += deltaX1 * -sin;
    x += deltaX2 * (1 + cos);
    y += deltaX2 * sin;
  }

  if (sides.n && sides.s) {
    y += deltaY1 + deltaY2;
  } else if (sides.n) {
    x += deltaY1 * sin;
    y += deltaY1 * (1 - cos);
    x += deltaY2 * -sin;
    y += deltaY2 * (1 + cos);
  } else if (sides.s) {
    x += deltaY1 * -sin;
    y += deltaY1 * (1 + cos);
    x += deltaY2 * sin;
    y += deltaY2 * (1 - cos);
  }
  return [x, y];
};

export const refreshTextDimensions = (
  textElement: FcboardTextElement,
  container: FcboardTextContainer | null,
  elementsMap: ElementsMap,
  text = textElement.text,
) => {
  if (textElement.isDeleted) {
    return;
  }
  if (container || !textElement.autoResize) {
    text = wrapText(
      text,
      getFontString(textElement),
      container
        ? getBoundTextMaxWidth(container, textElement)
        : textElement.width,
    );
  }
  const dimensions = getAdjustedDimensions(textElement, elementsMap, text);
  return { text, ...dimensions };
};

export const newFreeDrawElement = (
  opts: {
    type: "freedraw";
    points?: FcboardFreeDrawElement["points"];
    simulatePressure: boolean;
    pressures?: FcboardFreeDrawElement["pressures"];
  } & ElementConstructorOpts,
): NonDeleted<FcboardFreeDrawElement> => {
  return {
    ..._newElementBase<FcboardFreeDrawElement>(opts.type, opts),
    points: opts.points || [],
    pressures: opts.pressures || [],
    simulatePressure: opts.simulatePressure,
  };
};

export const newLinearElement = (
  opts: {
    type: FcboardLinearElement["type"];
    points?: FcboardLinearElement["points"];
    polygon?: FcboardLineElement["polygon"];
  } & ElementConstructorOpts,
): NonDeleted<FcboardLinearElement> => {
  const element = {
    ..._newElementBase<FcboardLinearElement>(opts.type, opts),
    points: opts.points || [],

    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: null,
  };

  if (isLineElement(element)) {
    const lineElement: NonDeleted<FcboardLineElement> = {
      ...element,
      polygon: opts.polygon ?? false,
    };

    return lineElement;
  }

  return element;
};

export const newArrowElement = <T extends boolean>(
  opts: {
    type: FcboardArrowElement["type"];
    startArrowhead?: Arrowhead | null;
    endArrowhead?: Arrowhead | null;
    points?: FcboardArrowElement["points"];
    elbowed?: T;
    fixedSegments?: FcboardElbowArrowElement["fixedSegments"] | null;
  } & ElementConstructorOpts,
): T extends true
  ? NonDeleted<FcboardElbowArrowElement>
  : NonDeleted<FcboardArrowElement> => {
  if (opts.elbowed) {
    return {
      ..._newElementBase<FcboardElbowArrowElement>(opts.type, opts),
      points: opts.points || [],
      startBinding: null,
      endBinding: null,
      startArrowhead: opts.startArrowhead || null,
      endArrowhead: opts.endArrowhead || null,
      elbowed: true,
      fixedSegments: opts.fixedSegments || [],
      startIsSpecial: false,
      endIsSpecial: false,
    } as NonDeleted<FcboardElbowArrowElement>;
  }

  return {
    ..._newElementBase<FcboardArrowElement>(opts.type, opts),
    points: opts.points || [],
    startBinding: null,
    endBinding: null,
    startArrowhead: opts.startArrowhead || null,
    endArrowhead: opts.endArrowhead || null,
    elbowed: false,
  } as T extends true
    ? NonDeleted<FcboardElbowArrowElement>
    : NonDeleted<FcboardArrowElement>;
};

export const newImageElement = (
  opts: {
    type: FcboardImageElement["type"];
    status?: FcboardImageElement["status"];
    fileId?: FcboardImageElement["fileId"];
    scale?: FcboardImageElement["scale"];
    crop?: FcboardImageElement["crop"];
  } & ElementConstructorOpts,
): NonDeleted<FcboardImageElement> => {
  return {
    ..._newElementBase<FcboardImageElement>("image", opts),
    // in the future we'll support changing stroke color for some SVG elements,
    // and `transparent` will likely mean "use original colors of the image"
    strokeColor: "transparent",
    status: opts.status ?? "pending",
    fileId: opts.fileId ?? null,
    scale: opts.scale ?? [1, 1],
    crop: opts.crop ?? null,
  };
};
