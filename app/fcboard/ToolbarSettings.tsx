import { useState } from "react";
import { t } from "@fcboard/fcboard/i18n";
import { FactoryIcon } from "@fcboard/fcboard/components/FactoryIcon";
import {
  FIXED_TOOL_COUNT,
  NATIVE_TOOLBAR_ITEMS,
  TOOLBAR_LIMIT,
  saveToolbarItems,
  toolbarItems,
  useToolbarItems,
} from "@fcboard/fcboard/toolbarPreferences";

import type { ToolbarItem } from "@fcboard/fcboard/toolbarPreferences";

import { TransientMessage } from "./TransientMessage";
import "./ToolbarSettings.scss";

const fixed = [
  ["pen", "pen"],
  ["eraser", "eraser"],
  ["select", "select"],
] as const;

/** SettingsToolsFragment / ToolListAdapter: only the badge changes visibility. */
export const ToolbarSettings = () => {
  const selected = useToolbarItems();
  const [error, setError] = useState("");
  const commit = (next: readonly ToolbarItem[]) => {
    try {
      saveToolbarItems(next);
      setError("");
    } catch (failure) {
      setError(String(failure));
    }
  };
  const toggle = (id: ToolbarItem) => {
    if (selected.includes(id)) {
      commit(selected.filter((item) => item !== id));
    } else if (selected.length + FIXED_TOOL_COUNT >= TOOLBAR_LIMIT) {
      setError(t("fcboard.toolbar_limit"));
    } else {
      commit([...selected, id]);
    }
  };
  const tile = (id: ToolbarItem) => {
    const item = toolbarItems[id];
    const added = selected.includes(id);
    const label = t(`fcboard.${item.label}`);
    return (
      <div
        key={id}
        data-tool-id={id}
        aria-label={label}
        className="fc-toolbar-setting-tile"
      >
        <FactoryIcon name={item.icon} />
        <span>{label}</span>
        <button
          type="button"
          className={added ? "fc-toolbar-remove" : "fc-toolbar-add"}
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
          max: NATIVE_TOOLBAR_ITEMS.length + FIXED_TOOL_COUNT,
        })}
      </p>
      <div
        className="fc-toolbar-setting-grid"
        data-toolbar-zone="available"
        role="group"
        aria-label={t("fcboard.toolbar_available")}
      >
        {NATIVE_TOOLBAR_ITEMS.filter((id) => !selected.includes(id)).map(tile)}
      </div>
      <TransientMessage message={error} role="alert" />
    </div>
  );
};
