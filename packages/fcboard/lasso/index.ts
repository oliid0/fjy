import {
  type GlobalPoint,
  type LineSegment,
  pointFrom,
} from "@excalidraw/math";

import { getElementLineSegments } from "@excalidraw/element";
import { LinearElementEditor } from "@excalidraw/element";
import {
  isFrameLikeElement,
  isLinearElement,
  isTextElement,
} from "@excalidraw/element";

import { getFrameChildren } from "@excalidraw/element";
import { selectGroupsForSelectedElements } from "@excalidraw/element";

import { getContainerElement } from "@excalidraw/element";

import {
  arrayToMap,
  easeOut,
  isShallowEqual,
  DRAGGING_THRESHOLD,
} from "@excalidraw/common";

import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { type AnimationFrameHandler } from "../animation-frame-handler";

import { AnimatedTrail } from "../animated-trail";

import { getLassoBounds, getLassoSelectedElementIds } from "./utils";
import { circleRegion, regionPath } from "./region";

import type { RegionBounds } from "./region";

import type App from "../components/App";
import type { AppState } from "../types";

type CanvasTranslate = {
  scrollX: number;
  scrollY: number;
  zoom: number;
};

export class LassoTrail extends AnimatedTrail {
  private intersectedElements: Set<ExcalidrawElement["id"]> = new Set();
  private enclosedElements: Set<ExcalidrawElement["id"]> = new Set();
  private elementsSegments: Map<string, LineSegment<GlobalPoint>[]> | null =
    null;
  private canvasTranslate: CanvasTranslate | null = null;
  private keepPreviousSelection: boolean = false;
  private regionExtent?: RegionBounds;
  private regionStarted = false;

  constructor(animationFrameHandler: AnimationFrameHandler, app: App) {
    super(animationFrameHandler, app, {
      animateTrail: true,
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
      fill: () => "rgba(105,101,219,0.05)",
      stroke: () => "rgba(105,101,219)",
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
    this.regionExtent = { left: x, right: x, top: y, bottom: y };
    this.regionStarted = false;

    if (
      !this.keepPreviousSelection &&
      !this.app.props.UIOptions.unifiedToolbar
    ) {
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
      }, {} as Record<ExcalidrawElement["id"], true>);

      if (this.keepPreviousSelection) {
        for (const id of Object.keys(prevState.selectedElementIds)) {
          nextSelectedElementIds[id] = true;
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

      return {
        whiteboardSelection:
          bounds && !this.keepPreviousSelection
            ? { bounds, elementIds: selectedIds, path }
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
                ) as NonDeleted<ExcalidrawLinearElement>,
                this.app.scene.getNonDeletedElementsMap(),
              )
            : null,
      };
    });
  };

  addPointToPath = (x: number, y: number, keepPreviousSelection = false) => {
    super.addPointToPath(x, y);

    if (
      this.app.props.UIOptions.unifiedToolbar &&
      this.regionExtent &&
      !this.regionStarted
    ) {
      const bounds = this.regionExtent;
      bounds.left = Math.min(bounds.left, x);
      bounds.right = Math.max(bounds.right, x);
      bounds.top = Math.min(bounds.top, y);
      bounds.bottom = Math.max(bounds.bottom, y);
      if (
        Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top) *
          this.app.state.zoom.value >=
        DRAGGING_THRESHOLD
      ) {
        this.regionStarted = true;
        this.app.setState({
          whiteboardSelection: undefined,
          selectedElementIds: {},
          selectedGroupIds: {},
          selectedLinearElement: null,
        });
      }
    } else if (!this.app.props.UIOptions.unifiedToolbar) {
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

  selectRegion = (bounds: RegionBounds) => {
    const path = regionPath(bounds);
    const elementsMap = this.app.scene.getNonDeletedElementsMap();
    const { selectedElementIds } = getLassoSelectedElementIds({
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
        this.selectRegion(bounds);
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
