import { type GlobalPoint, type LineSegment, pointFrom } from "@fcboard/math";

import { getElementLineSegments, getCommonBounds } from "@fcboard/element";
import { LinearElementEditor } from "@fcboard/element";
import {
  isFrameLikeElement,
  isLinearElement,
  isTextElement,
} from "@fcboard/element";

import { getFrameChildren } from "@fcboard/element";
import { selectGroupsForSelectedElements } from "@fcboard/element";

import { getContainerElement } from "@fcboard/element";

import { arrayToMap, easeOut, isShallowEqual } from "@fcboard/common";

import type {
  FcboardElement,
  FcboardLinearElement,
  NonDeleted,
} from "@fcboard/element/types";

import { type AnimationFrameHandler } from "../animation-frame-handler";

import { AnimatedTrail } from "../animated-trail";

import { getLassoBounds, getLassoSelectedElementIds } from "./utils";
import { circleRegion, hasRegionArea } from "./region";

import type { RegionBounds } from "./region";

import type App from "../components/App";
import type { AppState } from "../types";

type CanvasTranslate = {
  scrollX: number;
  scrollY: number;
  zoom: number;
};

export class LassoTrail extends AnimatedTrail {
  private intersectedElements: Set<FcboardElement["id"]> = new Set();
  private enclosedElements: Set<FcboardElement["id"]> = new Set();
  private elementsSegments: Map<string, LineSegment<GlobalPoint>[]> | null =
    null;
  private canvasTranslate: CanvasTranslate | null = null;
  private keepPreviousSelection: boolean = false;

  constructor(animationFrameHandler: AnimationFrameHandler, app: App) {
    super(animationFrameHandler, app, {
      animateTrail: true,
      centerline: app.props.UIOptions.unifiedToolbar,
      streamline: 0.4,
      sizeMapping: (c) => {
        const DECAY_TIME = Infinity;
        const DECAY_LENGTH = 5000;
        const t = Math.max(
          0,
          1 - (performance.now() - c.pressure) / DECAY_TIME,
        );
        const l =
          (DECAY_LENGTH -
            Math.min(DECAY_LENGTH, c.totalLength - c.currentIndex)) /
          DECAY_LENGTH;

        return Math.min(easeOut(l), easeOut(t));
      },
      fill: () =>
        app.props.UIOptions.unifiedToolbar ? "none" : "rgba(105,101,219,0.05)",
      stroke: () =>
        app.props.UIOptions.unifiedToolbar ? "#16b6f1" : "rgba(105,101,219)",
    });
  }

  startPath(x: number, y: number, keepPreviousSelection = false) {
    // clear any existing trails just in case
    this.endPath();

    super.startPath(x, y);
    this.intersectedElements.clear();
    this.enclosedElements.clear();

    this.keepPreviousSelection =
      !this.app.props.UIOptions.unifiedToolbar && keepPreviousSelection;
    if (!this.keepPreviousSelection) {
      this.app.setState({
        whiteboardSelection: undefined,
        selectedElementIds: {},
        selectedGroupIds: {},
        selectedLinearElement: null,
      });
    }
  }

  selectElementsFromIds = (
    ids: string[],
    bounds?: NonNullable<AppState["whiteboardSelection"]>["bounds"],
    path?: NonNullable<AppState["whiteboardSelection"]>["path"],
  ) => {
    this.app.setState((prevState) => {
      const nextSelectedElementIds = ids.reduce((acc, id) => {
        acc[id] = true;
        return acc;
      }, {} as Record<FcboardElement["id"], true>);

      if (this.keepPreviousSelection) {
        for (const id of Object.keys(prevState.selectedElementIds)) {
          nextSelectedElementIds[id] = true;
        }
      }

      if (this.app.props.UIOptions.unifiedToolbar) {
        const composite = (element: FcboardElement) => {
          const data = element.customData;
          return data?.fcWidget
            ? `widget:${data.fcWidget.id}`
            : data?.fcInsertion
            ? `insertion:${data.fcInsertion.id}`
            : data?.fcPlot
            ? `plot:${data.fcPlot.id}`
            : data?.fcLanguage
            ? `language:${data.fcLanguage.group}`
            : undefined;
        };
        const groups = new Set(
          this.app.scene
            .getNonDeletedElements()
            .filter((element) => nextSelectedElementIds[element.id])
            .map(composite)
            .filter(Boolean),
        );
        for (const element of this.app.scene.getNonDeletedElements()) {
          if (!element.locked && groups.has(composite(element))) {
            nextSelectedElementIds[element.id] = true;
          }
        }
      }

      for (const [id] of Object.entries(nextSelectedElementIds)) {
        const element = this.app.scene.getNonDeletedElement(id);

        if (element && isTextElement(element)) {
          const container = getContainerElement(
            element,
            this.app.scene.getNonDeletedElementsMap(),
          );
          if (container) {
            nextSelectedElementIds[container.id] = true;
            delete nextSelectedElementIds[element.id];
          }
        }
      }

      // remove all children of selected frames
      for (const [id] of Object.entries(nextSelectedElementIds)) {
        const element = this.app.scene.getNonDeletedElement(id);

        if (element && isFrameLikeElement(element)) {
          const elementsInFrame = getFrameChildren(
            this.app.scene.getNonDeletedElementsMap(),
            element.id,
          );
          for (const child of elementsInFrame) {
            delete nextSelectedElementIds[child.id];
          }
        }
      }

      const nextSelection =
        bounds && this.app.props.UIOptions.unifiedToolbar
          ? { selectedElementIds: nextSelectedElementIds, selectedGroupIds: {} }
          : selectGroupsForSelectedElements(
              {
                editingGroupId: prevState.editingGroupId,
                selectedElementIds: nextSelectedElementIds,
              },
              this.app.scene.getNonDeletedElements(),
              prevState,
              this.app,
            );

      const selectedIds = [...Object.keys(nextSelection.selectedElementIds)];
      const selectedGroupIds = [...Object.keys(nextSelection.selectedGroupIds)];
      const selected = this.app.scene
        .getNonDeletedElements()
        .filter((element) => nextSelection.selectedElementIds[element.id]);
      const padding = 20 / this.app.state.zoom.value;
      const [left, top, right, bottom] = getCommonBounds(selected);
      const operationBounds =
        selected.length && bounds
          ? {
              left: left - padding,
              top: top - padding,
              right: right + padding,
              bottom: bottom + padding,
            }
          : undefined;

      return {
        whiteboardSelection:
          operationBounds && !this.keepPreviousSelection
            ? { bounds: operationBounds, elementIds: selectedIds, path }
            : undefined,
        selectedElementIds: nextSelection.selectedElementIds,
        selectedGroupIds: nextSelection.selectedGroupIds,
        editingGroupId: bounds ? null : prevState.editingGroupId,
        selectedLinearElement:
          !bounds &&
          selectedIds.length === 1 &&
          !selectedGroupIds.length &&
          isLinearElement(this.app.scene.getNonDeletedElement(selectedIds[0]))
            ? new LinearElementEditor(
                this.app.scene.getNonDeletedElement(
                  selectedIds[0],
                ) as NonDeleted<FcboardLinearElement>,
                this.app.scene.getNonDeletedElementsMap(),
              )
            : null,
      };
    });
  };

  addPointToPath = (x: number, y: number, keepPreviousSelection = false) => {
    if (this.app.props.UIOptions.unifiedToolbar && this.hasLastPoint(x, y)) {
      return;
    }
    super.addPointToPath(x, y);
    if (!this.app.props.UIOptions.unifiedToolbar) {
      this.keepPreviousSelection = keepPreviousSelection;
      this.updateSelection();
    }
  };

  getViewport = (): RegionBounds => {
    const { scrollX, scrollY, zoom, width, height } = this.app.state;
    return {
      left: -scrollX,
      top: -scrollY,
      right: width / zoom.value - scrollX,
      bottom: height / zoom.value - scrollY,
    };
  };

  private selectRegion = (bounds: RegionBounds, path: GlobalPoint[]) => {
    const elementsMap = this.app.scene.getNonDeletedElementsMap();
    const { selectedElementIds } = !hasRegionArea(path)
      ? { selectedElementIds: [] }
      : getLassoSelectedElementIds({
          lassoPath: path,
          elements: this.app.visibleElements,
          elementsMap,
          elementsSegments: new Map(
            this.app.visibleElements.map((element) => [
              element.id,
              getElementLineSegments(element, elementsMap),
            ]),
          ),
          intersectedElements: new Set(),
          enclosedElements: new Set(),
        });
    this.selectElementsFromIds(selectedElementIds, bounds, path);
  };

  finishPath = () => {
    const path = super.getCurrentTrail()?.originalPoints;
    if (path && this.app.props.UIOptions.unifiedToolbar) {
      const bounds = circleRegion(
        path,
        this.getViewport(),
        this.app.state.zoom.value,
      );
      if (bounds) {
        // SelectCacheLayer closes the actual gesture on lift. The padded
        // rectangle is the operation frame, never the selection geometry.
        this.selectRegion(
          bounds,
          path.map(([x, y]) => pointFrom<GlobalPoint>(x, y)),
        );
      }
    }
    this.endPath();
  };

  private updateSelection = () => {
    const lassoPath = super
      .getCurrentTrail()
      ?.originalPoints?.map((p) => pointFrom<GlobalPoint>(p[0], p[1]));

    const currentCanvasTranslate: CanvasTranslate = {
      scrollX: this.app.state.scrollX,
      scrollY: this.app.state.scrollY,
      zoom: this.app.state.zoom.value,
    };

    if (
      !this.elementsSegments ||
      !isShallowEqual(currentCanvasTranslate, this.canvasTranslate ?? {})
    ) {
      this.canvasTranslate = currentCanvasTranslate;
      this.elementsSegments = new Map();
      const visibleElementsMap = arrayToMap(this.app.visibleElements);
      for (const element of this.app.visibleElements) {
        const segments = getElementLineSegments(element, visibleElementsMap);
        this.elementsSegments.set(element.id, segments);
      }
    }

    if (lassoPath) {
      const { selectedElementIds } = getLassoSelectedElementIds({
        lassoPath,
        elements: this.app.visibleElements,
        elementsMap: this.app.scene.getNonDeletedElementsMap(),
        elementsSegments: this.elementsSegments,
        intersectedElements: this.intersectedElements,
        enclosedElements: this.enclosedElements,
        simplifyDistance: 5 / this.app.state.zoom.value,
      });

      const [left, top, right, bottom] = getLassoBounds(
        lassoPath,
        12 / this.app.state.zoom.value,
      );
      this.selectElementsFromIds(
        selectedElementIds,
        this.app.props.UIOptions.unifiedToolbar && lassoPath.length > 1
          ? { left, top, right, bottom }
          : undefined,
        this.app.props.UIOptions.unifiedToolbar ? lassoPath : undefined,
      );
    }
  };

  endPath(): void {
    super.endPath();
    super.clearTrails();
    this.intersectedElements.clear();
    this.enclosedElements.clear();
    this.elementsSegments = null;
  }
}
