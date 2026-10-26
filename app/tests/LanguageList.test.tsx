import { t, defaultLang, languages } from "@excalidraw/excalidraw/i18n";
import {
  screen,
  fireEvent,
  waitFor,
  render,
} from "@excalidraw/excalidraw/tests/test-utils";

import ExcalidrawApp from "../App";

describe("Test LanguageList", () => {
  it("rerenders UI on language change", async () => {
    await render(<ExcalidrawApp />);
    expect(screen.getByRole("button", { name: "Pen" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Eraser" })).toBeVisible();

    // Properties are explicitly opened from the shared bottom toolbar.
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.pen") }));
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.pen") }));
    // english lang should display `thin` label
    expect(screen.queryByTitle(/thin/i)).not.toBeNull();
    fireEvent.click(document.querySelector(".dropdown-menu-button")!);
    expect(screen.getAllByRole("menuitem")).toHaveLength(6);
    fireEvent.click(
      screen.getByRole("menuitem", { name: t("fcboard.settings") }),
    );
    await screen.findByRole("dialog", {
      name: t("fcboard.whiteboard_settings"),
    });
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.toolbox") }));
    for (const label of [
      "recording",
      "files_transfer",
      "summarize_board",
      "question_and_explanation",
    ] as const) {
      expect(
        screen.queryByRole("menuitem", { name: t(`fcboard.${label}`) }),
      ).toBeNull();
    }

    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: t("buttons.selectLanguage") }),
    );
    fireEvent.click(
      screen.getByRole("option", {
        name: languages.find((lang) => lang.code === "de-DE")!.label,
      }),
    );
    // switching to german, `thin` label should no longer exist
    await waitFor(() => expect(screen.queryByTitle(/thin/i)).toBeNull());
    fireEvent.keyDown(
      screen.getByRole("dialog", { name: t("fcboard.whiteboard_settings") }),
      { key: "Escape" },
    );
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Stift" })[0]).toBeVisible(),
    );
    fireEvent.click(screen.getByTestId("main-menu-trigger"));
    fireEvent.click(
      screen.getByRole("menuitem", { name: t("fcboard.settings") }),
    );
    await screen.findByRole("dialog", {
      name: t("fcboard.whiteboard_settings"),
    });
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.toolbox") }));
    // reset language
    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: t("buttons.selectLanguage") }),
    );
    fireEvent.click(screen.getByRole("option", { name: defaultLang.label }));
    fireEvent.keyDown(
      screen.getByRole("dialog", { name: t("fcboard.whiteboard_settings") }),
      { key: "Escape" },
    );
    // switching back to English
    await waitFor(() => expect(screen.queryByTitle(/thin/i)).not.toBeNull());
  });
});
