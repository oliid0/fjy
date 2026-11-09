import { fireEvent, screen, within } from "@testing-library/react";
import { t } from "@fcboard/fcboard/i18n";
import {
  readToolbarItems,
  saveToolbarItems,
  TOOLBAR_STORAGE,
} from "@fcboard/fcboard/toolbarPreferences";

import { render } from "./test/render";
import { ToolbarSettings } from "./ToolbarSettings";
import { SettingsNavigation } from "./SettingsNavigation";

const originalHitTest = document.elementFromPoint;
afterEach(() => {
  localStorage.removeItem(TOOLBAR_STORAGE);
  document.elementFromPoint = originalHitTest;
  vi.restoreAllMocks();
});
const pointer = (element: Element, type: string, x = 80) =>
  fireEvent(
    element,
    Object.assign(new Event(type, { bubbles: true }), {
      button: 0,
      pointerId: 12,
      clientX: x,
      clientY: 100,
      pointerType: "touch",
    }),
  );

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

it("persists add/remove, protects the six drawing buttons, and enforces the APK limit", () => {
  const view = render(<ToolbarSettings />);
  fireEvent.click(
    screen.getByRole("button", {
      name: t("fcboard.toolbar_add", { name: t("fcboard.mind_map") }),
    }),
  );
  expect(readToolbarItems()).toEqual(["toolbox", "mindmap"]);
  fireEvent.click(
    screen.getByRole("button", {
      name: t("fcboard.toolbar_remove", { name: t("fcboard.toolbox") }),
    }),
  );
  expect(readToolbarItems()).toEqual(["mindmap"]);
  expect(view.container.querySelectorAll(".is-fixed")).toHaveLength(6);
  view.unmount();
  saveToolbarItems([
    "shape",
    "toolbox",
    "ruler",
    "compass",
    "table",
    "mindmap",
    "media",
  ]);
  render(<ToolbarSettings />);
  expect(
    screen.getByRole("button", {
      name: t("fcboard.toolbar_add", { name: t("fcboard.signal") }),
    }),
  ).toBeDisabled();
  expect(readToolbarItems()).toHaveLength(7);
});

it("supports touch drag into and out of the toolbar, reorder, and cancellation", () => {
  const { container } = render(<ToolbarSettings />);
  const selected = screen.getByRole("group", {
    name: t("fcboard.toolbar_added"),
  });
  const available = screen.getByRole("group", {
    name: t("fcboard.toolbar_available"),
  });
  const tile = () => container.querySelector('[data-tool-id="mindmap"]')!;
  document.elementFromPoint = vi.fn(() => selected);
  pointer(tile(), "pointerdown");
  pointer(tile(), "pointermove", 160);
  pointer(tile(), "pointerup", 160);
  expect(readToolbarItems()).toEqual(["toolbox", "mindmap"]);
  document.elementFromPoint = vi.fn(() =>
    container.querySelector('[data-tool-id="toolbox"]'),
  );
  pointer(tile(), "pointerdown");
  pointer(tile(), "pointermove", 160);
  pointer(tile(), "pointerup", 160);
  expect(readToolbarItems()).toEqual(["mindmap", "toolbox"]);
  document.elementFromPoint = vi.fn(() => available);
  pointer(tile(), "pointerdown");
  pointer(tile(), "pointermove", 160);
  pointer(tile(), "pointercancel", 160);
  expect(readToolbarItems()).toEqual(["mindmap", "toolbox"]);
  pointer(tile(), "pointerdown");
  pointer(tile(), "pointermove", 160);
  pointer(tile(), "pointerup", 160);
  expect(readToolbarItems()).toEqual(["toolbox"]);
  expect(
    within(available).getByRole("button", {
      name: t("fcboard.toolbar_add", { name: t("fcboard.mind_map") }),
    }),
  ).toBeEnabled();
});

it("reports a real persistence failure and leaves the previous toolbar intact", () => {
  render(<ToolbarSettings />);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: t("fcboard.toolbar_add", { name: t("fcboard.mind_map") }),
    }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("quota");
  expect(readToolbarItems()).toEqual(["toolbox"]);
});
