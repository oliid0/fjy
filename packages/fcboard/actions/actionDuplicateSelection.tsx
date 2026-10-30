import {
  DEFAULT_GRID_SIZE,
  KEYS,
  MOBILE_ACTION_BUTTON_BG,
  arrayToMap,
} from "@fcboard/common";

import { getNonDeletedElements } from "@fcboard/element";

import { LinearElementEditor } from "@fcboard/element";

import {
  getSelectedElements,
  getSelectionStateForElements,
} from "@fcboard/element";

import { syncMovedIndices } from "@fcboard/element";

import { duplicateElements } from "@fcboard/element";

import { CaptureUpdateAction } from "@fcboard/element";

import { ToolButton } from "../components/ToolButton";
import { DuplicateIcon } from "../components/icons";

import { t } from "../i18n";
import { isSomeElementSelected } from "../scene";
import { getShortcutKey } from "../shortcut";

import { useStylesPanelMode } from "../components/App";

import { regionPath } from "../lasso/region";

import { register } from "./register";

export const actionDuplicateSelection = register({
  name: "duplicateSelection",
  label: "labels.duplicateSelection",
  icon: DuplicateIcon,
  trackEvent: { category: "element" },
  perform: (elements, appState, formData, app) => {
    if (appState.selectedElementsAreBeingDragged) {
      return false;
    }

    // duplicate selected point(s) if editing a line
    if (appState.selectedLinearElement?.isEditing) {
      // TODO: Invariants should be checked here instead of duplicateSelectedPoints()
      try {
        const newAppState = LinearElementEditor.duplicateSelectedPoints(
          appState,
          app.scene,
        );

        return {
          elements,
          appState: newAppState,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        };
      } catch {
        return false;
      }
    }

    let { duplicatedElements, elementsWithDuplicates } = duplicateElements({
      type: "in-place",
      elements,
      idsOfElementsToDuplicate: arrayToMap(
        getSelectedElements(elements, appState, {
          includeBoundTextElement: true,
          includeElementsInFrames: true,
        }),
      ),
      appState,
      randomizeSeed: true,
      overrides: ({ origElement, origIdToDuplicateId }) => {
        const duplicateFrameId =
          origElement.frameId && origIdToDuplicateId.get(origElement.frameId);
        return {
          x: origElement.x + DEFAULT_GRID_SIZE / 2,
          y: origElement.y + DEFAULT_GRID_SIZE / 2,
          frameId: duplicateFrameId ?? origElement.frameId,
        };
      },
    });

    if (app.props.onDuplicate && elementsWithDuplicates) {
      const mappedElements = app.props.onDuplicate(
        elementsWithDuplicates,
        elements,
      );
      if (mappedElements) {
        elementsWithDuplicates = mappedElements;
      }
    }

    const selectionState = getSelectionStateForElements(
      duplicatedElements,
      getNonDeletedElements(elementsWithDuplicates),
      appState,
    );
    const region =
      app.props.UIOptions.unifiedToolbar && appState.whiteboardSelection;
    const offset = DEFAULT_GRID_SIZE / 2;
    const bounds = region
      ? {
          left: region.bounds.left + offset,
          top: region.bounds.top + offset,
          right: region.bounds.right + offset,
          bottom: region.bounds.bottom + offset,
        }
      : undefined;

    return {
      elements: syncMovedIndices(
        elementsWithDuplicates,
        arrayToMap(duplicatedElements),
      ),
      appState: {
        ...appState,
        ...selectionState,
        ...(bounds
          ? {
              whiteboardSelection: {
                bounds,
                path: regionPath(bounds),
                elementIds: Object.keys(selectionState.selectedElementIds),
              },
            }
          : {}),
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  keyTest: (event) => event[KEYS.CTRL_OR_CMD] && event.key === KEYS.D,
  PanelComponent: ({ elements, appState, updateData, app }) => {
    const isMobile = useStylesPanelMode() === "mobile";

    return (
      <ToolButton
        type="button"
        icon={DuplicateIcon}
        title={`${t("labels.duplicateSelection")} — ${getShortcutKey(
          "CtrlOrCmd+D",
        )}`}
        aria-label={t("labels.duplicateSelection")}
        onClick={() => updateData(null)}
        disabled={
          !isSomeElementSelected(getNonDeletedElements(elements), appState)
        }
        style={{
          ...(isMobile && appState.openPopup !== "compactOtherProperties"
            ? MOBILE_ACTION_BUTTON_BG
            : {}),
        }}
      />
    );
  },
});
