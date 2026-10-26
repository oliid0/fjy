import { t, languages, setLanguage } from "@excalidraw/excalidraw/i18n";
import { factoryResources as sourceResourceNames } from "@excalidraw/excalidraw/locales/zh-CN.json";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { render } from "./test/render";
import { classroomCommands } from "./commands";
import { TeachingResources, teachingResources } from "./TeachingResources";
import * as ai from "./ai";
import { deleteGeneratedResource } from "./generatedResources";
import * as resourceStorage from "./generatedResources";
import { interactiveResource } from "./test/interactiveResource";

const api = {} as ExcalidrawImperativeAPI;

afterEach(async () => {
  await setLanguage(languages.find((lang) => lang.code === "en")!);
});

it("keeps the factory resource searchable by its original name when the interface is English", async () => {
  render(<TeachingResources api={api} />);
  const query = sourceResourceNames.teach_res_math_concept_number_compare;
  await act(async () => {
    await classroomCommands.execute({
      name: "resources.open",
      args: { query },
    });
  });
  expect(
    screen.getByRole("button", {
      name: (name) =>
        name.startsWith(
          t("factoryResources.teach_res_math_concept_number_compare"),
        ),
    }),
  ).toBeVisible();
  let result: unknown;
  await act(async () => {
    result = await classroomCommands.execute({
      name: "resources.list",
      args: { query },
    });
  });
  expect(result).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: teachingResources.find(
          (item) => item.titleKey === "teach_res_math_concept_number_compare",
        )!.id,
        category: "math",
      }),
    ]),
  );
});

it("discards a resource if the visible courseware closes while its catalogue is loading", async () => {
  let finish!: (items: []) => void;
  const loading = new Promise<[]>((resolve) => {
    finish = resolve;
  });
  const storage = vi
    .spyOn(resourceStorage, "generatedResources")
    .mockReturnValue(loading);
  let visible: { id: string; page: number; ink: [] } | undefined = {
    id: "document-one",
    page: 1,
    ink: [],
  };
  const context = classroomCommands.context("document", () => visible);
  const view = render(<TeachingResources api={api} />);
  const pending = classroomCommands.execute({
    name: "resources.use",
    args: { id: teachingResources.find((item) => item.asset)!.id },
  });
  try {
    await act(async () => {
      visible = undefined;
      finish([]);
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    });
  } finally {
    view.unmount();
    context();
    storage.mockRestore();
  }
});

it("uses original translated resource names for searching, display and the experiment language", async () => {
  await setLanguage(languages.find((lang) => lang.code === "de-DE")!);
  render(<TeachingResources api={api} />);
  await act(async () => {
    await classroomCommands.execute({ name: "resources.open" });
  });
  fireEvent.change(
    screen.getByRole("textbox", { name: t("fcboard.search_resources") }),
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
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.mathematics") }),
  );
  expect(document.querySelectorAll(".fc-resource-grid > button")).toHaveLength(
    teachingResources.filter((item) => item.category === "math").length,
  );
  expect(screen.getByRole("button", { name: /Number Compare/ })).toBeVisible();
});

it("generates, discovers and reuses an interactive lesson through the same canvas insertion command", async () => {
  const chat = vi
    .spyOn(ai, "chat")
    .mockResolvedValue(JSON.stringify(interactiveResource));
  const insert = vi.fn().mockReturnValue({ ids: ["actual-lesson-object"] });
  const release = classroomCommands.register(
    "canvas.resource",
    "@internal",
    insert,
  );
  const view = render(<TeachingResources api={api} />);
  let id = "";
  try {
    await act(async () => {
      const result = (await classroomCommands.execute({
        name: "resources.generate",
        args: { prompt: "force" },
      })) as { id: string; ids: string[] };
      id = result.id;
      expect(result.ids).toEqual(["actual-lesson-object"]);
    });
    const listed = (await classroomCommands.execute({
      name: "resources.list",
      args: { query: "Force" },
    })) as { id: string; kind: string }[];
    expect(listed).toContainEqual(
      expect.objectContaining({ id, kind: "interactive" }),
    );
    await act(async () => {
      await expect(
        classroomCommands.execute({ name: "resources.use", args: { id } }),
      ).resolves.toMatchObject({ ids: ["actual-lesson-object"] });
    });
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[0][0].resource).toEqual(
      insert.mock.calls[1][0].resource,
    );
  } finally {
    view.unmount();
    release();
    chat.mockRestore();
    if (id) {
      await deleteGeneratedResource(id);
    }
  }
});
