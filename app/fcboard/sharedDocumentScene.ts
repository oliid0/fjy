import { newFreeDrawElement, newElementWith } from "@fcboard/element";
import { syncInvalidIndices } from "@fcboard/element/fractionalIndex";

import type {
  OrderedFcboardElement,
  FcboardFreeDrawElement,
  NonDeleted,
} from "@fcboard/element/types";
import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { documentSharing } from "./documentSharing";

import type { InkStroke } from "./documents";
import type { SharedDocumentSource } from "./documentSharing";
import type { SceneSyncAPI } from "./sceneSync";

/** Transport records use the same version/nonce tombstones as board elements.
 * The payload remains the original InkStroke, so no text, table or resource is flattened.
 */
export class SharedDocumentScene {
  private elements = new Map<string, OrderedFcboardElement>();
  private strokes = new Map<string, InkStroke>();
  private reset = false;
  readonly api: SceneSyncAPI;

  constructor(
    board: FcboardImperativeAPI,
    private read: () => SharedDocumentSource | undefined,
  ) {
    this.api = {
      getAppState: () => ({
        ...board.getAppState(),
        viewBackgroundColor: "#ffffff",
        whiteboardBackground: undefined,
        newElement:
          (this.elements.get(this.read()?.draft || "") as
            | NonDeleted<FcboardFreeDrawElement>
            | undefined) || null,
        resizingElement: null,
        editingTextElement: null,
      }),
      getFiles: () => ({}),
      getSceneElementsIncludingDeleted: () => this.snapshot(),
      onChange: (listener) =>
        documentSharing.watch(() => {
          if (this.read()?.ready) {
            listener(this.snapshot(), this.api.getAppState(), {});
          }
        }),
      onPointerUp: () => () => {},
      addFiles: () => {},
      resetScene: () => {
        this.reset = true;
      },
      history: { clear: () => {} },
      updateScene: ({ elements }) => {
        if (!elements || !this.read()?.ready) {
          return;
        }
        const next: InkStroke[] = [];
        for (const element of elements) {
          const ink = element.customData?.fcSharedDocumentInk as
            | InkStroke
            | undefined;
          if (!ink || ink.id !== element.id || !Array.isArray(ink.points)) {
            throw new Error("Invalid shared document annotation");
          }
          if (!element.isDeleted) {
            next.push(ink);
          }
        }
        this.elements = new Map(
          (elements as readonly OrderedFcboardElement[]).map((element) => [
            element.id,
            element,
          ]),
        );
        this.strokes = new Map(next.map((ink) => [ink.id, ink]));
        const reset = this.reset;
        this.reset = false;
        this.read()!.apply(next, reset);
      },
    };
  }

  private snapshot() {
    const visible = new Set<string>();
    for (const ink of this.read()?.ink || []) {
      visible.add(ink.id);
      const old = this.elements.get(ink.id);
      if (this.strokes.get(ink.id) !== ink || old?.isDeleted) {
        // Geometry is rendered by FilePreview from the lossless payload. Stable
        // record IDs let the existing conflict resolver protect an active draft.
        const element = old
          ? newElementWith(old, {
              isDeleted: false,
              customData: { fcSharedDocumentInk: ink },
            })
          : {
              ...newFreeDrawElement({
                type: "freedraw",
                x: 0,
                y: 0,
                points: [],
                pressures: [],
                simulatePressure: false,
                customData: { fcSharedDocumentInk: ink },
              }),
              id: ink.id,
            };
        this.elements.set(ink.id, element as OrderedFcboardElement);
        this.strokes.set(ink.id, ink);
      }
    }
    for (const [id, element] of this.elements) {
      if (!visible.has(id) && !element.isDeleted) {
        this.elements.set(id, newElementWith(element, { isDeleted: true }));
        this.strokes.delete(id);
      }
    }
    return syncInvalidIndices([...this.elements.values()]);
  }
}
