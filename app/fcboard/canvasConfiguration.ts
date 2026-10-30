import { CaptureUpdateAction } from "@fcboard/fcboard";
import { t } from "@fcboard/fcboard/i18n";
import { canvasStrokeColor } from "@fcboard/common";
import {
  factoryBackgrounds,
  validWhiteboardBackground,
  validBackgroundImage,
} from "@fcboard/fcboard/whiteboardBackground";
import { switchWhiteboardTip } from "@fcboard/fcboard/whiteboardPen";

import type {
  AppState,
  FcboardImperativeAPI,
  UIOptions,
} from "@fcboard/fcboard/types";

import { classroomCommands } from "./commands";

const numeric = {
  thickThreshold: [0.01, 240, "whiteboardThickThreshold"],
  fineThreshold: [0.01, 240, "whiteboardFineThreshold"],
  brushVariation: [0, 50, "whiteboardBrushVariation"],
  palmThreshold: [1, 240, "palmEraserThreshold"],
  eraserSize: [12, 240, "eraserSize"],
} as const;
const booleans = {
  dualPen: "whiteboardDualPen",
  hardNib: "whiteboardHardNib",
  palmEraser: "palmEraser",
  multiStroke: "multiStroke",
  toolbarReversed: "toolbarReversed",
  toolbarText: "whiteboardToolbarText",
} as const;
const invalid = () => new Error(t("fcboard.invalid_style_parameters"));
const documentOnly = () =>
  new Error(
    t(
      "fcboard.this_action_is_for_the_board_in_a_document_turn_pages_annotate_circle_undo_or_describe_what_to",
    ),
  );

/** The same CSS-pixel calibration and defaults used by the original controls. */
export const canvasConfigurationSnapshot = (
  state: AppState,
  device?: UIOptions["inkProfile"],
  document = false,
) => {
  const threshold = state.whiteboardThickThreshold ?? device?.thickThreshold;
  return {
    units: "CSS pixels",
    background: document
      ? { available: false }
      : {
          available: true,
          color: state.viewBackgroundColor,
          pattern: state.whiteboardBackground?.pattern || 0,
          patterns: factoryBackgrounds.map((_, index) => index + 1),
          custom: state.whiteboardBackground?.pattern === 14,
        },
    pen: {
      tip: state.whiteboardPenTip || "fine",
      mode: state.currentItemInkAssist || state.currentItemPenMode || "hard",
      brushVariation: state.whiteboardBrushVariation ?? 45,
      hardNib:
        device?.hardNibAvailable !== false &&
        (state.whiteboardHardNib ?? device?.hardNib ?? false),
      hardNibAvailable: device?.hardNibAvailable !== false,
      dualPen: state.whiteboardDualPen ?? device?.dualPen ?? false,
      thickThreshold: threshold ?? null,
      fineThreshold:
        state.whiteboardFineThreshold ?? device?.fineThreshold ?? null,
      autoTipAvailable:
        !!threshold && Number.isFinite(threshold) && threshold > 0,
    },
    eraser: {
      mode: state.eraserMode || "stroke",
      modes: ["stroke", "object"],
      size: state.eraserSize ?? device?.eraserSize ?? 60,
      palm: state.palmEraser !== false,
      palmThreshold: state.palmEraserThreshold ?? device?.palmThreshold ?? 36,
    },
    touch: { multiStroke: document ? null : state.multiStroke !== false },
    toolbar: {
      reversed: !!state.toolbarReversed,
      text: state.whiteboardToolbarText !== false,
      visible: !state.toolbarHidden,
    },
  };
};
export const readCanvasConfiguration = (
  api: FcboardImperativeAPI,
  device?: UIOptions["inkProfile"],
) =>
  canvasConfigurationSnapshot(
    api.getAppState(),
    device,
    !!classroomCommands.read("document"),
  );

/** Validate the whole request before any state changes. No arbitrary AppState writes. */
export const canvasConfigurationPatch = (
  api: FcboardImperativeAPI,
  input: Record<string, unknown>,
  device?: UIOptions["inkProfile"],
): Partial<AppState> => {
  const keys = Object.keys(input);
  if (
    !keys.length ||
    keys.some(
      (key) =>
        ![
          ...Object.keys(numeric),
          ...Object.keys(booleans),
          "tip",
          "backgroundColor",
          "backgroundPattern",
          "backgroundImage",
          "eraserMode",
        ].includes(key),
    )
  ) {
    throw invalid();
  }
  const state = api.getAppState();
  const patch: Partial<AppState> = {};
  for (const [key, [min, max, field]] of Object.entries(numeric)) {
    if (key in input) {
      const value = input[key];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < min ||
        value > max
      ) {
        throw new Error(t("fcboard.style_key_is_out_of_range", { key }));
      }
      patch[field] = value;
    }
  }
  for (const [key, field] of Object.entries(booleans)) {
    if (key in input) {
      if (typeof input[key] !== "boolean") {
        throw invalid();
      }
      patch[field] = input[key];
    }
  }
  const threshold =
    patch.whiteboardThickThreshold ??
    state.whiteboardThickThreshold ??
    device?.thickThreshold;
  if (patch.whiteboardHardNib && device?.hardNibAvailable === false) {
    throw invalid();
  }
  if (
    patch.whiteboardDualPen &&
    (!threshold || !Number.isFinite(threshold) || threshold <= 0)
  ) {
    throw invalid();
  }
  if ("tip" in input) {
    if (input.tip !== "fine" && input.tip !== "thick") {
      throw invalid();
    }
    Object.assign(patch, switchWhiteboardTip(state, input.tip));
  }
  if ("eraserMode" in input) {
    if (input.eraserMode !== "stroke" && input.eraserMode !== "object") {
      throw invalid();
    }
    patch.eraserMode = input.eraserMode;
  }
  if (
    classroomCommands.read("document") &&
    ("backgroundColor" in input ||
      "backgroundPattern" in input ||
      "backgroundImage" in input ||
      "multiStroke" in input)
  ) {
    throw documentOnly();
  }
  if ("backgroundColor" in input) {
    if (
      typeof input.backgroundColor !== "string" ||
      !/^#[\da-f]{6}$/i.test(input.backgroundColor)
    ) {
      throw invalid();
    }
    patch.viewBackgroundColor = input.backgroundColor;
    patch.currentItemStrokeColor = canvasStrokeColor(
      input.backgroundColor,
      patch.currentItemStrokeColor ?? state.currentItemStrokeColor,
      state.viewBackgroundColor,
    );
  }
  if ("backgroundPattern" in input) {
    const pattern = input.backgroundPattern;
    if (
      typeof pattern !== "number" ||
      !Number.isInteger(pattern) ||
      pattern < 0 ||
      pattern > factoryBackgrounds.length
    ) {
      throw invalid();
    }
    const background = {
      pattern,
      width: state.width / state.zoom.value,
      height: state.height / state.zoom.value,
    };
    if (pattern && !validWhiteboardBackground(background)) {
      throw invalid();
    }
    patch.whiteboardBackground = pattern ? background : undefined;
    patch.gridModeEnabled = false;
  }
  if ("backgroundImage" in input) {
    if (
      "backgroundPattern" in input ||
      !validBackgroundImage(input.backgroundImage)
    ) {
      throw invalid();
    }
    patch.whiteboardBackground = {
      pattern: 14,
      image: input.backgroundImage,
      width: state.width / state.zoom.value,
      height: state.height / state.zoom.value,
    };
    if (!validWhiteboardBackground(patch.whiteboardBackground)) {
      throw invalid();
    }
    patch.whiteboardCustomBackground = input.backgroundImage;
    patch.gridModeEnabled = false;
  }
  return patch;
};

export const applyCanvasConfiguration = (
  api: FcboardImperativeAPI,
  patch: Partial<AppState>,
) =>
  api.updateScene({
    appState: patch,
    captureUpdate:
      "whiteboardBackground" in patch || "viewBackgroundColor" in patch
        ? CaptureUpdateAction.IMMEDIATELY
        : CaptureUpdateAction.EVENTUALLY,
  });

/** A tool result is read from the committed editor, including asynchronous React state. */
export const configureCanvas = async (
  api: FcboardImperativeAPI,
  input: Record<string, unknown>,
  device?: UIOptions["inkProfile"],
  signal?: AbortSignal,
) => {
  signal?.throwIfAborted();
  const patch = canvasConfigurationPatch(api, input, device);
  const matches = () =>
    Object.entries(patch).every(
      ([key, value]) =>
        JSON.stringify(api.getAppState()[key as keyof AppState]) ===
        JSON.stringify(value),
    );
  if (!matches()) {
    await new Promise<void>((resolve, reject) => {
      let stop = () => {};
      const finish = (failure?: Error) => {
        clearTimeout(timer);
        stop();
        signal?.removeEventListener("abort", abort);
        failure ? reject(failure) : resolve();
      };
      const abort = () =>
        finish(new DOMException("Configuration cancelled", "AbortError"));
      const timer = setTimeout(
        () => finish(new Error(t("fcboard.this_board_action_is_unavailable"))),
        5000,
      );
      signal?.addEventListener("abort", abort, { once: true });
      stop = api.onChange(() => {
        if (matches()) {
          finish();
        }
      });
      try {
        applyCanvasConfiguration(api, patch);
        if (matches()) {
          finish();
        }
      } catch (failure) {
        finish(failure instanceof Error ? failure : invalid());
      }
    });
  }
  signal?.throwIfAborted();
  return readCanvasConfiguration(api, device);
};
