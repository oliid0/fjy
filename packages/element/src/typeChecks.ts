import { ROUNDNESS, assertNever } from "@fcboard/common";

import { pointsEqual } from "@fcboard/math";

import type { ElementOrToolType } from "@fcboard/fcboard/types";

import type { MarkNonNullable } from "@fcboard/common/utility-types";

import type {
  FcboardElement,
  FcboardTextElement,
  FcboardEmbeddableElement,
  FcboardLinearElement,
  FcboardBindableElement,
  FcboardFreeDrawElement,
  InitializedFcboardImageElement,
  FcboardImageElement,
  FcboardTextElementWithContainer,
  FcboardTextContainer,
  FcboardFrameElement,
  RoundnessType,
  FcboardFrameLikeElement,
  FcboardElementType,
  FcboardIframeElement,
  FcboardIframeLikeElement,
  FcboardMagicFrameElement,
  FcboardArrowElement,
  FcboardElbowArrowElement,
  FcboardLineElement,
  FcboardFlowchartNodeElement,
  FcboardLinearElementSubType,
} from "./types";

export const isInitializedImageElement = (
  element: FcboardElement | null,
): element is InitializedFcboardImageElement => {
  return !!element && element.type === "image" && !!element.fileId;
};

export const isImageElement = (
  element: FcboardElement | null,
): element is FcboardImageElement => {
  return !!element && element.type === "image";
};

export const isEmbeddableElement = (
  element: FcboardElement | null | undefined,
): element is FcboardEmbeddableElement => {
  return !!element && element.type === "embeddable";
};

export const isIframeElement = (
  element: FcboardElement | null,
): element is FcboardIframeElement => {
  return !!element && element.type === "iframe";
};

export const isIframeLikeElement = (
  element: FcboardElement | null,
): element is FcboardIframeLikeElement => {
  return (
    !!element && (element.type === "iframe" || element.type === "embeddable")
  );
};

export const isTextElement = (
  element: FcboardElement | null,
): element is FcboardTextElement => {
  return element != null && element.type === "text";
};

export const isFrameElement = (
  element: FcboardElement | null,
): element is FcboardFrameElement => {
  return element != null && element.type === "frame";
};

export const isMagicFrameElement = (
  element: FcboardElement | null,
): element is FcboardMagicFrameElement => {
  return element != null && element.type === "magicframe";
};

export const isFrameLikeElement = (
  element: FcboardElement | null,
): element is FcboardFrameLikeElement => {
  return (
    element != null &&
    (element.type === "frame" || element.type === "magicframe")
  );
};

export const isFreeDrawElement = (
  element?: FcboardElement | null,
): element is FcboardFreeDrawElement => {
  return element != null && isFreeDrawElementType(element.type);
};

export const isFreeDrawElementType = (
  elementType: FcboardElementType,
): boolean => {
  return elementType === "freedraw";
};

export const isLinearElement = (
  element?: FcboardElement | null,
): element is FcboardLinearElement => {
  return element != null && isLinearElementType(element.type);
};

export const isLineElement = (
  element?: FcboardElement | null,
): element is FcboardLineElement => {
  return element != null && element.type === "line";
};

export const isArrowElement = (
  element?: FcboardElement | null,
): element is FcboardArrowElement => {
  return element != null && element.type === "arrow";
};

export const isElbowArrow = (
  element?: FcboardElement,
): element is FcboardElbowArrowElement => {
  return isArrowElement(element) && element.elbowed;
};

/**
 * sharp or curved arrow, but not elbow
 */
export const isSimpleArrow = (
  element?: FcboardElement,
): element is FcboardArrowElement => {
  return isArrowElement(element) && !element.elbowed;
};

export const isSharpArrow = (
  element?: FcboardElement,
): element is FcboardArrowElement => {
  return isArrowElement(element) && !element.elbowed && !element.roundness;
};

export const isCurvedArrow = (
  element?: FcboardElement,
): element is FcboardArrowElement => {
  return (
    isArrowElement(element) && !element.elbowed && element.roundness !== null
  );
};

export const isLinearElementType = (
  elementType: ElementOrToolType,
): boolean => {
  return (
    elementType === "arrow" || elementType === "line" // || elementType === "freedraw"
  );
};

export const isBindingElement = (
  element?: FcboardElement | null,
  includeLocked = true,
): element is FcboardArrowElement => {
  return (
    element != null &&
    (!element.locked || includeLocked === true) &&
    isBindingElementType(element.type)
  );
};

export const isBindingElementType = (
  elementType: ElementOrToolType,
): boolean => {
  return elementType === "arrow";
};

export const isBindableElement = (
  element: FcboardElement | null | undefined,
  includeLocked = true,
): element is FcboardBindableElement => {
  return (
    element != null &&
    (!element.locked || includeLocked === true) &&
    (element.type === "rectangle" ||
      element.type === "diamond" ||
      element.type === "ellipse" ||
      element.type === "image" ||
      element.type === "iframe" ||
      element.type === "embeddable" ||
      element.type === "frame" ||
      element.type === "magicframe" ||
      (element.type === "text" && !element.containerId))
  );
};

export const isRectanguloidElement = (
  element?: FcboardElement | null,
): element is FcboardBindableElement => {
  return (
    element != null &&
    (element.type === "rectangle" ||
      element.type === "diamond" ||
      element.type === "image" ||
      element.type === "iframe" ||
      element.type === "embeddable" ||
      element.type === "frame" ||
      element.type === "magicframe" ||
      (element.type === "text" && !element.containerId))
  );
};

// TODO: Remove this when proper distance calculation is introduced
// @see binding.ts:distanceToBindableElement()
export const isRectangularElement = (
  element?: FcboardElement | null,
): element is FcboardBindableElement => {
  return (
    element != null &&
    (element.type === "rectangle" ||
      element.type === "image" ||
      element.type === "text" ||
      element.type === "iframe" ||
      element.type === "embeddable" ||
      element.type === "frame" ||
      element.type === "magicframe" ||
      element.type === "freedraw")
  );
};

export const isTextBindableContainer = (
  element: FcboardElement | null,
  includeLocked = true,
): element is FcboardTextContainer => {
  return (
    element != null &&
    (!element.locked || includeLocked === true) &&
    (element.type === "rectangle" ||
      element.type === "diamond" ||
      element.type === "ellipse" ||
      isArrowElement(element))
  );
};

export const isFcboardElement = (element: any): element is FcboardElement => {
  const type: FcboardElementType | undefined = element?.type;
  if (!type) {
    return false;
  }
  switch (type) {
    case "text":
    case "diamond":
    case "rectangle":
    case "iframe":
    case "embeddable":
    case "ellipse":
    case "arrow":
    case "freedraw":
    case "line":
    case "frame":
    case "magicframe":
    case "image":
    case "selection": {
      return true;
    }
    default: {
      assertNever(type, null);
      return false;
    }
  }
};

export const isFlowchartNodeElement = (
  element: FcboardElement,
): element is FcboardFlowchartNodeElement => {
  return (
    element.type === "rectangle" ||
    element.type === "ellipse" ||
    element.type === "diamond"
  );
};

export const hasBoundTextElement = (
  element: FcboardElement | null,
): element is MarkNonNullable<FcboardBindableElement, "boundElements"> => {
  return (
    isTextBindableContainer(element) &&
    !!element.boundElements?.some(({ type }) => type === "text")
  );
};

export const isBoundToContainer = (
  element: FcboardElement | null,
): element is FcboardTextElementWithContainer => {
  return (
    element !== null &&
    "containerId" in element &&
    element.containerId !== null &&
    isTextElement(element)
  );
};

export const isArrowBoundToElement = (element: FcboardArrowElement) => {
  return !!element.startBinding || !!element.endBinding;
};

export const isUsingAdaptiveRadius = (type: string) =>
  type === "rectangle" ||
  type === "embeddable" ||
  type === "iframe" ||
  type === "image";

export const isUsingProportionalRadius = (type: string) =>
  type === "line" || type === "arrow" || type === "diamond";

export const canApplyRoundnessTypeToElement = (
  roundnessType: RoundnessType,
  element: FcboardElement,
) => {
  if (
    (roundnessType === ROUNDNESS.ADAPTIVE_RADIUS ||
      // if legacy roundness, it can be applied to elements that currently
      // use adaptive radius
      roundnessType === ROUNDNESS.LEGACY) &&
    isUsingAdaptiveRadius(element.type)
  ) {
    return true;
  }
  if (
    roundnessType === ROUNDNESS.PROPORTIONAL_RADIUS &&
    isUsingProportionalRadius(element.type)
  ) {
    return true;
  }

  return false;
};

export const getDefaultRoundnessTypeForElement = (element: FcboardElement) => {
  if (isUsingProportionalRadius(element.type)) {
    return {
      type: ROUNDNESS.PROPORTIONAL_RADIUS,
    };
  }

  if (isUsingAdaptiveRadius(element.type)) {
    return {
      type: ROUNDNESS.ADAPTIVE_RADIUS,
    };
  }

  return null;
};

export const getLinearElementSubType = (
  element: FcboardLinearElement,
): FcboardLinearElementSubType => {
  if (isSharpArrow(element)) {
    return "sharpArrow";
  }
  if (isCurvedArrow(element)) {
    return "curvedArrow";
  }
  if (isElbowArrow(element)) {
    return "elbowArrow";
  }
  return "line";
};

/**
 * Checks if current element points meet all the conditions for polygon=true
 * (this isn't a element type check, for that use isLineElement).
 *
 * If you want to check if points *can* be turned into a polygon, use
 *  canBecomePolygon(points).
 */
export const isValidPolygon = (
  points: FcboardLineElement["points"],
): boolean => {
  return points.length > 3 && pointsEqual(points[0], points[points.length - 1]);
};

export const canBecomePolygon = (
  points: FcboardLineElement["points"],
): boolean => {
  return (
    points.length > 3 ||
    // 3-point polygons can't have all points in a single line
    (points.length === 3 && !pointsEqual(points[0], points[points.length - 1]))
  );
};
