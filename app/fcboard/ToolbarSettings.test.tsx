import { fireEvent, screen, within } from "@testing-library/react";
import { t } from "@fcboard/fcboard/i18n";
import {
  DEFAULT_TOOLBAR_ITEMS,
  NATIVE_TOOLBAR_ITEMS,
  normalizeToolbarItems,
  readToolbarItems,
  saveToolbarItems,
  TOOLBAR_STORAGE,
} from "@fcboard/fcboard/toolbarPreferences";

import { render } from "./test/render";
import { ToolbarSettings } from "./ToolbarSettings";
import { SettingsNavigation } from "./SettingsNavigation";

afterEach(() => {
  localStorage.removeItem(TOOLBAR_STORAGE);
  localStorage.removeItem("fcboard-toolbar-tools-v1");
  vi.restoreAllMocks();
});
const badge = (name: string, added = false) =>
  screen.getByRole("button", {
    name: t(added ? "fcboard.toolbar_remove" : "fcboard.toolbar_add", { name }),
  });
it("places toolbar settings before AI and opens its own page", () => {
  render(
    <SettingsNavigation>
      <span />
    </SettingsNavigation>,
  );
  const buttons = screen.getAllByRole("button");
  expect(
    buttons.findIndex(
      (button) => button.textContent === t("fcboard.toolbar_settings"),
    ),
  ).toBeLessThan(
    buttons.findIndex(
      (button) => button.textContent === t("fcboard.ai_and_speech_settings"),
    ),
  );
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.toolbar_settings") }),
  );
  expect(
    screen.getByRole("heading", { name: t("fcboard.toolbar_settings") }),
  ).toBeVisible();
});

it("preserves native defaults and adds the user-requested optional multipoint item to the original catalogue", () => {
  const view = render(<ToolbarSettings />);
  expect(readToolbarItems()).toEqual(DEFAULT_TOOLBAR_ITEMS);
  expect(NATIVE_TOOLBAR_ITEMS.length + 3).toBe(26);
  expect(view.container.querySelectorAll(".is-fixed")).toHaveLength(3);
  expect(
    screen.getByText(t("fcboard.toolbar_hint", { count: 8, max: 26 })),
  ).toBeVisible();
  fireEvent.click(badge(t("fcboard.mind_map")));
  expect(readToolbarItems()).toEqual([...DEFAULT_TOOLBAR_ITEMS, "mindmap"]);
  fireEvent.click(badge(t("fcboard.toolbox"), true));
  fireEvent.click(badge(t("fcboard.toolbox")));
  expect(readToolbarItems()).toEqual([...DEFAULT_TOOLBAR_ITEMS, "mindmap"]);
  view.unmount();
  render(<ToolbarSettings />);
  expect(badge(t("fcboard.mind_map"), true)).toBeEnabled();
});

it("leaves card taps and long drags inert; only the original badge changes membership", () => {
  const { container } = render(<ToolbarSettings />);
  const tile = container.querySelector('[data-tool-id="mindmap"]')!;
  fireEvent.click(tile);
  fireEvent.pointerDown(tile, { pointerId: 1, clientX: 20, clientY: 20 });
  fireEvent.pointerMove(tile, { pointerId: 1, clientX: 300, clientY: 40 });
  fireEvent.pointerUp(tile, { pointerId: 1, clientX: 300, clientY: 40 });
  fireEvent.contextMenu(tile);
  expect(readToolbarItems()).toEqual(DEFAULT_TOOLBAR_ITEMS);
  fireEvent.click(within(tile as HTMLElement).getByRole("button"));
  expect(readToolbarItems()).toContain("mindmap");
});

it("enforces the original total limit of 13 and reports the original message on an add attempt", () => {
  saveToolbarItems(NATIVE_TOOLBAR_ITEMS.slice(0, 10));
  render(<ToolbarSettings />);
  fireEvent.click(badge(t("fcboard.document")));
  expect(readToolbarItems()).toHaveLength(10);
  expect(screen.getByRole("alert")).toHaveTextContent(
    t("fcboard.toolbar_limit"),
  );
  fireEvent.click(badge(t("fcboard.toolbox"), true));
  fireEvent.click(badge(t("fcboard.document")));
  expect(readToolbarItems()).toContain("document");
  expect(readToolbarItems()).toHaveLength(10);
});

it("migrates the old default and restores original-order membership without rewriting old storage", () => {
  localStorage.setItem("fcboard-toolbar-tools-v1", '["toolbox"]');
  expect(readToolbarItems()).toEqual(DEFAULT_TOOLBAR_ITEMS);
  expect(localStorage.getItem(TOOLBAR_STORAGE)).toBeNull();
  expect(
    normalizeToolbarItems(["mindmap", "undo", "shape", "undo", "unknown"]),
  ).toEqual(["shape", "undo", "mindmap"]);
});

it("reports a real persistence failure and preserves the previous toolbar", () => {
  render(<ToolbarSettings />);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  fireEvent.click(badge(t("fcboard.mind_map")));
  expect(screen.getByRole("alert")).toHaveTextContent("quota");
  expect(readToolbarItems()).toEqual(DEFAULT_TOOLBAR_ITEMS);
});

it("adds and removes the optional multipoint switch through the real settings badge", () => {
  render(<ToolbarSettings />);
  fireEvent.click(badge(t("fcboard.multi_point_switch")));
  expect(readToolbarItems()).toContain("multi");
  expect(JSON.parse(localStorage.getItem(TOOLBAR_STORAGE)!)).toContain("multi");
  fireEvent.click(badge(t("fcboard.multi_point_switch"), true));
  expect(readToolbarItems()).not.toContain("multi");
});
