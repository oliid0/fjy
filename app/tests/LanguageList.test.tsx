import { t, defaultLang, languages } from "@excalidraw/excalidraw/i18n";
import { within } from "@testing-library/react";
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
    const englishFountain = t("fcboard.fountain");
    expect(screen.getByRole("button", { name: englishFountain })).toBeVisible();
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
    await waitFor(() => expect(t("fcboard.pen")).toBe("Stift"));
    fireEvent.keyDown(
      screen.getByRole("dialog", { name: t("fcboard.whiteboard_settings") }),
      { key: "Escape" },
    );
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Stift" })[0]).toBeVisible(),
    );
    if (!document.querySelector(".fc-editor-properties")) {
      fireEvent.click(
        within(document.querySelector(".fc-drawing-tools")!).getByRole(
          "button",
          {
            name: "Stift",
          },
        ),
      );
    }
    expect(
      screen.getByRole("button", { name: t("fcboard.fountain") }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: englishFountain })).toBeNull();
    fireEvent.click(
      within(document.querySelector(".fc-drawing-tools")!).getByRole("button", {
        name: "Stift",
      }),
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
    const pen = () =>
      within(document.querySelector(".fc-drawing-tools")!).getByRole("button", {
        name: "Pen",
      });
    await waitFor(() => expect(pen()).toBeVisible());
    if (!document.querySelector(".fc-editor-properties")) {
      fireEvent.click(pen());
    }
    expect(screen.getByRole("button", { name: englishFountain })).toBeVisible();
  });
});
