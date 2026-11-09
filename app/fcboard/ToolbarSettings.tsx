import { useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";
import { FactoryIcon } from "@fcboard/fcboard/components/FactoryIcon";
import {
  FIXED_TOOL_COUNT,
  TOOLBAR_LIMIT,
  saveToolbarItems,
  toolbarItems,
  useToolbarItems,
} from "@fcboard/fcboard/toolbarPreferences";

import type { ToolbarItem } from "@fcboard/fcboard/toolbarPreferences";

import { TransientMessage } from "./TransientMessage";
import "./ToolbarSettings.scss";

import type { PointerEvent } from "react";

const fixed = [
  ["pen", "pen"],
  ["eraser", "eraser"],
  ["select", "select"],
  ["multi", "multi"],
  ["undo", "undo"],
  ["redo", "redo"],
] as const;

/** SettingsToolsFragment: two six-column grids, instant add/remove persistence.
 * Pointer capture adds the requested touch drag without HTML5 drag limitations. */
export const ToolbarSettings = () => {
  const selected = useToolbarItems();
  const [error, setError] = useState("");
  const [dragged, setDragged] = useState<ToolbarItem>();
  const [over, setOver] = useState<string>();
  const drag = useRef<
    | { id: ToolbarItem; pointer: number; x: number; y: number; moved: boolean }
    | undefined
  >(undefined);
  const commit = (next: readonly ToolbarItem[]) => {
    try {
      saveToolbarItems(next);
      setError("");
    } catch (failure) {
      setError(String(failure));
    }
  };
  const add = (id: ToolbarItem, before?: ToolbarItem) => {
    if (
      !selected.includes(id) &&
      selected.length + FIXED_TOOL_COUNT >= TOOLBAR_LIMIT
    ) {
      setError(t("fcboard.toolbar_limit"));
      return;
    }
    const next = selected.filter((item) => item !== id);
    const index = before ? next.indexOf(before) : -1;
    next.splice(index < 0 ? next.length : index, 0, id);
    commit(next);
  };
  const toggle = (id: ToolbarItem) =>
    selected.includes(id)
      ? commit(selected.filter((item) => item !== id))
      : add(id);
  const target = (event: PointerEvent) =>
    document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-toolbar-zone]");
  const finish = (event: PointerEvent) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) {
      return;
    }
    drag.current = undefined;
    setDragged(undefined);
    setOver(undefined);
    if (!active.moved) {
      return;
    }
    const zone = target(event);
    if (!zone) {
      return;
    }
    if (zone.dataset.toolbarZone === "available") {
      commit(selected.filter((id) => id !== active.id));
    } else {
      const before = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-tool-id]")?.dataset.toolId as
        | ToolbarItem
        | undefined;
      if (before !== active.id) {
        add(active.id, before);
      }
    }
  };
  const tile = (id: ToolbarItem) => {
    const item = toolbarItems[id];
    const added = selected.includes(id);
    const label = t(`fcboard.${item.label}`);
    return (
      <div
        key={id}
        role="button"
        tabIndex={0}
        data-tool-id={id}
        aria-label={label}
        aria-pressed={added}
        className={`fc-toolbar-setting-tile${
          dragged === id ? " is-dragging" : ""
        }`}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle(id);
          }
          if (
            added &&
            event.altKey &&
            ["ArrowLeft", "ArrowRight"].includes(event.key)
          ) {
            event.preventDefault();
            const next = [...selected];
            const index = next.indexOf(id);
            const destination = index + (event.key === "ArrowLeft" ? -1 : 1);
            if (destination >= 0 && destination < next.length) {
              [next[index], next[destination]] = [
                next[destination],
                next[index],
              ];
              commit(next);
            }
          }
        }}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            (event.target as Element).closest("button")
          ) {
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            id,
            pointer: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (!active || active.pointer !== event.pointerId) {
            return;
          }
          if (
            Math.hypot(event.clientX - active.x, event.clientY - active.y) > 6
          ) {
            active.moved = true;
            setDragged(active.id);
            setOver(target(event)?.dataset.toolbarZone);
          }
        }}
        onPointerUp={finish}
        onPointerCancel={() => {
          drag.current = undefined;
          setDragged(undefined);
          setOver(undefined);
        }}
      >
        <FactoryIcon name={item.icon} />
        <span>{label}</span>
        <button
          type="button"
          className={added ? "fc-toolbar-remove" : "fc-toolbar-add"}
          disabled={
            !added && selected.length + FIXED_TOOL_COUNT >= TOOLBAR_LIMIT
          }
          aria-label={t(
            added ? "fcboard.toolbar_remove" : "fcboard.toolbar_add",
            { name: label },
          )}
          onClick={() => toggle(id)}
        >
          <FactoryIcon name={added ? "toolbarRemove" : "toolbarAdd"} />
        </button>
      </div>
    );
  };
  return (
    <div className="fc-toolbar-settings">
      <div
        className="fc-toolbar-setting-grid"
        data-toolbar-zone="selected"
        data-drag-over={over === "selected"}
        role="group"
        aria-label={t("fcboard.toolbar_added")}
      >
        {fixed.map(([id, icon]) => (
          <div
            key={id}
            className="fc-toolbar-setting-tile is-fixed"
            aria-label={t("fcboard.toolbar_fixed")}
          >
            <FactoryIcon name={icon} />
            <span>{t(`fcboard.${id}`)}</span>
          </div>
        ))}
        {selected.map(tile)}
      </div>
      <p aria-live="polite">
        {t("fcboard.toolbar_hint", {
          count: selected.length + FIXED_TOOL_COUNT,
          max: TOOLBAR_LIMIT,
        })}
      </p>
      <div
        className="fc-toolbar-setting-grid"
        data-toolbar-zone="available"
        data-drag-over={over === "available"}
        role="group"
        aria-label={t("fcboard.toolbar_available")}
      >
        {(Object.keys(toolbarItems) as ToolbarItem[])
          .filter((id) => !selected.includes(id))
          .map(tile)}
      </div>
      <TransientMessage message={error} role="alert" />
    </div>
  );
};
