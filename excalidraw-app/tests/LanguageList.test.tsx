import { t, defaultLang } from "@excalidraw/excalidraw/i18n";
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
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.画笔") }));
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.画笔") }));
    // english lang should display `thin` label
    expect(screen.queryByTitle(/thin/i)).not.toBeNull();
    fireEvent.click(document.querySelector(".dropdown-menu-button")!);
    expect(screen.getAllByRole("menuitem")).toHaveLength(6);
    fireEvent.click(screen.getByRole("menuitem", { name: t("fcboard.设置") }));
    for (const label of [
      "课堂录制",
      "课件 / 局域网快传",
      "总结白板",
      "提问与讲解",
    ] as const) {
      expect(
        screen.queryByRole("menuitem", { name: t(`fcboard.${label}`) }),
      ).toBeNull();
    }

    fireEvent.change(document.querySelector(".dropdown-select__language")!, {
      target: { value: "de-DE" },
    });
    // switching to german, `thin` label should no longer exist
    await waitFor(() => expect(screen.queryByTitle(/thin/i)).toBeNull());
    expect(screen.getAllByRole("button", { name: "Stift" })[0]).toBeVisible();
    expect(screen.getByText("Werkzeugkasten", { exact: true })).toBeVisible();
    // reset language
    fireEvent.change(document.querySelector(".dropdown-select__language")!, {
      target: { value: defaultLang.code },
    });
    // switching back to English
    await waitFor(() => expect(screen.queryByTitle(/thin/i)).not.toBeNull());
  });
});
