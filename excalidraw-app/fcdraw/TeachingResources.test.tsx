import { t, languages, setLanguage } from "@excalidraw/excalidraw/i18n";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { render } from "./test/render";
import { classroomCommands } from "./commands";
import { TeachingResources, teachingResources } from "./TeachingResources";

const api = {} as ExcalidrawImperativeAPI;

afterEach(async () => {
  await setLanguage(languages.find((lang) => lang.code === "en")!);
});

it("uses original translated resource names for searching, display and the experiment language", async () => {
  await setLanguage(languages.find((lang) => lang.code === "de-DE")!);
  render(<TeachingResources api={api} />);
  await act(async () => {
    await classroomCommands.execute({ name: "resources.open" });
  });
  fireEvent.change(
    screen.getByRole("textbox", { name: t("fcboard.搜索资源") }),
    { target: { value: "Zahlenvergleich" } },
  );
  const resource = screen.getByRole("button", { name: /Zahlenvergleich/ });
  fireEvent.click(resource);
  await waitFor(() =>
    expect(screen.getByTitle("Zahlenvergleich")).toBeVisible(),
  );
  expect(
    new URL(
      screen.getByTitle("Zahlenvergleich").getAttribute("src")!,
    ).searchParams.get("locale"),
  ).toBe("de");
});

it("retains the selected subject when the query is empty and keeps source IDs stable", async () => {
  await setLanguage(languages.find((lang) => lang.code === "en")!);
  render(<TeachingResources api={api} />);
  await act(async () => {
    await classroomCommands.execute({ name: "resources.open" });
  });
  fireEvent.change(screen.getByRole("combobox", { name: t("fcboard.学科") }), {
    target: { value: "数学" },
  });
  expect(document.querySelectorAll(".fc-resource-grid > button")).toHaveLength(
    teachingResources.filter((item) => item.category === "数学").length,
  );
  expect(screen.getByRole("button", { name: /Number Compare/ })).toBeVisible();
});
