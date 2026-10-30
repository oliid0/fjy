import { CaptureUpdateAction } from "@fcboard/fcboard";
import { newElementWith, orderByFractionalIndex } from "@fcboard/element";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import type {
  FcboardElement,
  FcboardFreeDrawElement,
  OrderedFcboardElement,
} from "@fcboard/element/types";

import { boardWritingParts } from "./insertionWriting";

import {
  growBoardTableWriting,
  tableWritingContact,
  tableWritingNeedsGrowth,
} from "./insertionWritingTables";

import type { TableWritingTarget } from "./insertionWritingTables";

type Contact = {
  target: TableWritingTarget;
  points: number;
  x: number;
  y: number;
  groups: readonly string[];
};
type Table = {
  elements: readonly FcboardElement[];
  last: Map<string, { element: FcboardElement; version: number }>;
  parts: ReturnType<typeof boardWritingParts>;
};
const owner = (element: FcboardElement) =>
  element.customData?.fcInsertion?.id as string | undefined;

/** HTool MOVE composition. Live geometry stays ephemeral until the owning pen's undo capture. */
export class LiveTableWriting {
  private contacts = new Map<string, Contact>();
  private tables = new Map<string, Table>();
  constructor(private api: FcboardImperativeAPI) {}

  private members(scene: readonly FcboardElement[], id: string) {
    return scene.filter(
      (element) => owner(element) === id && !this.contacts.has(element.id),
    );
  }
  private stamp(table: Table, elements: readonly FcboardElement[]) {
    table.parts = boardWritingParts(elements);
    table.last = new Map(
      elements.map((element) => [
        element.id,
        { element, version: element.version },
      ]),
    );
  }
  private raw(element: FcboardElement) {
    const contact = this.contacts.get(element.id);
    if (!contact || !element.customData?.fcInsertion) {
      return element;
    }
    const { fcInsertion, ...data } = element.customData;
    return newElementWith(element, {
      groupIds: [...contact.groups],
      customData: data,
    });
  }
  private restore(scene: readonly FcboardElement[]) {
    // A page replacement, deletion or explicit table edit owns its new state.
    // Never resurrect a table merely because an old pointer is still alive.
    for (const [id, table] of this.tables) {
      const current = this.members(scene, id);
      if (
        current.length !== table.last.size ||
        current.some((element) => {
          const known = table.last.get(element.id);
          return (
            !known ||
            known.element !== element ||
            known.version !== element.version
          );
        })
      ) {
        this.tables.delete(id);
        for (const [stroke, contact] of this.contacts) {
          if (contact.target.tableId === id) {
            this.contacts.delete(stroke);
          }
        }
      }
    }
    if (!this.tables.size) {
      return scene;
    }
    const originals = new Map(
      [...this.tables.values()].flatMap((table) =>
        table.elements.map((element) => [element.id, element] as const),
      ),
    );
    const restored = scene.flatMap((element) => {
      if (this.contacts.has(element.id)) {
        return [this.raw(element)];
      }
      const id = owner(element);
      const table = id && this.tables.get(id);
      if (!table) {
        return [element];
      }
      const original = originals.get(element.id);
      originals.delete(element.id);
      return original ? [original] : [];
    });
    return originals.size
      ? // Published scene entries and saved baselines have editor-assigned indices.
        orderByFractionalIndex([
          ...restored,
          ...originals.values(),
        ] as OrderedFcboardElement[])
      : restored;
  }
  private publish(scene: readonly FcboardElement[]) {
    const current = this.api.getSceneElements();
    if (
      scene.length !== current.length ||
      scene.some((element, index) => element !== current[index])
    ) {
      this.api.updateScene({
        elements: scene,
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      });
    }
    for (const [id, table] of this.tables) {
      this.stamp(table, this.members(scene, id));
    }
  }
  private targets() {
    return new Map(
      [...this.contacts].map(([id, contact]) => [id, contact.target]),
    );
  }
  private read(element: FcboardFreeDrawElement, contact: Contact) {
    const reset =
      contact.points > element.points.length ||
      contact.x !== element.x ||
      contact.y !== element.y;
    if (reset) {
      contact.points = 0;
      contact.target.bounds = {
        left: Infinity,
        right: -Infinity,
        top: Infinity,
        bottom: -Infinity,
      };
    }
    let changed = false;
    for (let index = contact.points; index < element.points.length; index++) {
      const point = element.points[index];
      const x = element.x + point[0];
      const y = element.y + point[1];
      if (!Number.isFinite(x + y)) {
        continue;
      }
      const bounds = contact.target.bounds;
      if (
        x < bounds.left ||
        x > bounds.right ||
        y < bounds.top ||
        y > bounds.bottom
      ) {
        changed = true;
      }
      bounds.left = Math.min(bounds.left, x);
      bounds.right = Math.max(bounds.right, x);
      bounds.top = Math.min(bounds.top, y);
      bounds.bottom = Math.max(bounds.bottom, y);
    }
    contact.points = element.points.length;
    contact.x = element.x;
    contact.y = element.y;
    return changed;
  }
  private render() {
    const scene = this.restore(this.api.getSceneElements());
    if (!this.contacts.size) {
      this.publish(scene);
      this.tables.clear();
      return;
    }
    const active = new Set(this.contacts.keys());
    this.publish(
      growBoardTableWriting(scene, active, { targets: this.targets(), active }),
    );
  }
  progress = (
    element: FcboardFreeDrawElement,
    phase: "start" | "update" | "cancel" | "settled",
  ) => {
    if (phase === "settled") {
      if (this.contacts.size) {
        this.render();
      }
      return;
    }
    if (phase === "cancel") {
      const scene = this.restore(this.api.getSceneElements());
      this.contacts.delete(element.id);
      // Restore before dropping the last table baseline, then reapply other contacts.
      this.publish(scene);
      this.render();
      return;
    }
    if (phase === "start") {
      if (
        element.customData?.fcGenerated ||
        element.customData?.fcQuestionInput ||
        element.customData?.fcInsertion
      ) {
        return;
      }
      const scene = this.restore(this.api.getSceneElements());
      const start = element.points[0];
      const target =
        start &&
        tableWritingContact(boardWritingParts(this.api.getSceneElements()), [
          element.x + start[0],
          element.y + start[1],
        ]);
      if (!target) {
        return;
      }
      if (!this.tables.has(target.tableId)) {
        const elements = this.members(scene, target.tableId);
        const table: Table = { elements, last: new Map(), parts: [] };
        // The baseline is restored, while validation follows currently displayed geometry.
        this.stamp(
          table,
          this.members(this.api.getSceneElements(), target.tableId),
        );
        this.tables.set(target.tableId, table);
      }
      const contact: Contact = {
        target: {
          ...target,
          bounds: {
            left: Infinity,
            right: -Infinity,
            top: Infinity,
            bottom: -Infinity,
          },
        },
        points: 0,
        x: element.x,
        y: element.y,
        groups: element.groupIds,
      };
      this.read(element, contact);
      this.contacts.set(element.id, contact);
      return;
    }
    const contact = this.contacts.get(element.id);
    const table = contact && this.tables.get(contact.target.tableId);
    if (
      contact &&
      table &&
      this.read(element, contact) &&
      contact.target.bounds.right - contact.target.bounds.left > 1 &&
      tableWritingNeedsGrowth(table.parts, contact.target)
    ) {
      this.render();
    }
  };
  commit = (element: FcboardFreeDrawElement) => {
    const restored = this.restore(this.api.getSceneElements());
    const contact = this.contacts.get(element.id);
    if (contact) {
      this.read(element, contact);
    }
    const active = new Set(this.contacts.keys());
    const next = growBoardTableWriting(restored, new Set([element.id]), {
      targets: this.targets(),
      active,
    });
    this.contacts.delete(element.id);
    for (const [id, table] of this.tables) {
      table.elements = this.members(next, id);
    }
    this.publish(next);
    // Other contacts are reapplied only by settled, after the core records this one.
    for (const [id] of this.tables) {
      if (
        ![...this.contacts.values()].some((item) => item.target.tableId === id)
      ) {
        this.tables.delete(id);
      }
    }
  };
  clear = () => {
    const scene = this.restore(this.api.getSceneElements());
    this.publish(scene);
    this.contacts.clear();
    this.tables.clear();
  };
}
