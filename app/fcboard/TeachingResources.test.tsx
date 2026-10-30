import { readFileSync } from "node:fs";

import { t, languages, setLanguage } from "@fcboard/fcboard/i18n";
import { factoryResources as sourceResourceNames } from "@fcboard/fcboard/locales/zh-CN.json";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Fcboard } from "@fcboard/fcboard";

import { Capacitor } from "@capacitor/core";

import { Keyboard } from "@fcboard/fcboard/tests/helpers/ui";
import { render as renderEditor } from "@fcboard/fcboard/tests/test-utils";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { render } from "./test/render";
import { classroomCommands } from "./commands";
import { TeachingResources, teachingResources } from "./TeachingResources";
import * as ai from "./ai";
import { deleteGeneratedResource } from "./generatedResources";
import * as resourceStorage from "./generatedResources";
import { interactiveResource } from "./test/interactiveResource";
import { Classroom } from "./native";
import { factoryResourceSubjects, resourceMenuTitle } from "./resourceMenus";

vi.mock("./native", () => ({
  Classroom: {
    openWebResource: vi.fn(),
    webResourceAction: vi.fn(),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  },
}));

const api = {} as FcboardImperativeAPI;
beforeEach(() => {
  vi.mocked(Classroom.addListener).mockResolvedValue({ remove: vi.fn() });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  await setLanguage(languages.find((lang) => lang.code === "en")!);
});

it("navigates every original subject submenu, tab and biological group through visible controls", async () => {
  const view = render(<TeachingResources api={api} />);
  await act(async () => {
    await classroomCommands.execute({ name: "resources.open" });
  });
  const nav = within(
    screen.getByRole("navigation", { name: t("fcboard.subject") }),
  );
  const gridCount = () =>
    document.querySelectorAll(".fc-resource-grid > button").length;
  for (const subject of factoryResourceSubjects.filter(
    (subject) => subject.sections,
  )) {
    fireEvent.click(
      nav.getByRole("button", { name: resourceMenuTitle(subject.titleKey) }),
    );
    for (const section of subject.sections!) {
      fireEvent.click(
        nav.getByRole("button", { name: resourceMenuTitle(section.titleKey) }),
      );
      expect(
        nav.getByRole("button", { name: resourceMenuTitle(section.titleKey) }),
      ).toHaveAttribute("aria-current", "page");
      if (section.tabs) {
        for (const tab of section.tabs) {
          fireEvent.click(
            screen.getByRole("tab", { name: resourceMenuTitle(tab.titleKey) }),
          );
          expect(gridCount()).toBe(tab.items!.length);
          expect(
            screen.getByRole("tab", { name: resourceMenuTitle(tab.titleKey) }),
          ).toHaveAttribute("aria-selected", "true");
        }
      } else if (section.groups) {
        expect(screen.queryByRole("tablist")).toBeNull();
        for (const group of section.groups) {
          const region = screen.getByRole("region", {
            name: resourceMenuTitle(group.titleKey),
          });
          expect(within(region).getAllByRole("button")).toHaveLength(
            group.items.length,
          );
        }
      } else {
        expect(gridCount()).toBe(section.items!.length);
        expect(screen.queryByRole("tablist")).toBeNull();
      }
    }
  }
  // Parent selection always returns to the first experiment and its first tab.
  fireEvent.click(
    nav.getByRole("button", { name: resourceMenuTitle("str_physics") }),
  );
  expect(gridCount()).toBe(10);
  const first = screen.getByRole("tab", {
    name: resourceMenuTitle("teach_res_tab_physics_electric_circuit"),
  });
  expect(first).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(first, { key: "End" });
  expect(gridCount()).toBe(12);
  expect(
    screen.getByRole("tab", {
      name: resourceMenuTitle("teach_res_tab_physics_motion"),
    }),
  ).toHaveFocus();
  expect(classroomCommands.read("resources")).toMatchObject({
    navigation: { category: "physics", section: "experiment", tab: "7" },
  });
  view.unmount();
});

it("opens the chemistry quantum experiment at the actual native URL and rejects nonexistent menu IDs", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.mocked(Classroom.openWebResource).mockResolvedValue(undefined);
  const view = render(<TeachingResources api={api} />);
  await act(async () => {
    await expect(
      classroomCommands.execute({
        name: "resources.open",
        args: { category: "chemistry", section: "missing" },
      }),
    ).rejects.toThrow("Unknown teaching resource menu");
    await classroomCommands.execute({
      name: "resources.open",
      args: { category: "chemistry", section: "experiment", tab: "2" },
    });
  });
  const card = document.querySelector<HTMLButtonElement>(
    ".fc-resource-grid > button",
  )!;
  expect(card).toHaveTextContent(
    t("factoryResources.teach_res_item_blackbody_radiation"),
  );
  fireEvent.click(card);
  await waitFor(() =>
    expect(Classroom.openWebResource).toHaveBeenCalledWith({
      url: "https://phet.colorado.edu/sims/html/blackbody-spectrum/latest/blackbody-spectrum_all.html?locale=en",
      language: "en",
    }),
  );
  expect(
    screen.queryByRole("dialog", { name: t("fcboard.teaching_resources") }),
  ).toBeNull();
  view.unmount();
});

it("keeps the source network PhET home button and standalone function entry operational", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  const view = render(<TeachingResources api={api} />);
  await act(async () => {
    await classroomCommands.execute({
      name: "resources.open",
      args: { category: "web" },
    });
  });
  expect(document.querySelectorAll(".fc-resource-grid > button")).toHaveLength(
    6,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(t("factoryResources.str_geogebra_phet")),
    }),
  );
  await waitFor(() =>
    expect(Classroom.openWebResource).toHaveBeenCalledWith({
      url: "https://phet.colorado.edu/",
      language: "en",
    }),
  );
  await act(async () => {
    await classroomCommands.execute({ name: "resources.open" });
  });
  const nav = screen.getByRole("navigation", { name: t("fcboard.subject") });
  fireEvent.click(
    within(nav).getByRole("button", {
      name: resourceMenuTitle("str_function"),
    }),
  );
  expect(
    await screen.findByRole("dialog", {
      name: t("fcboard.functionGraph.title"),
    }),
  ).toBeVisible();
  view.unmount();
});

it("inserts the chosen biological stage's actual PNG as one saved, undoable board object", async () => {
  const bytes = readFileSync(
    "public/factory-resources/cell_division_meiosis2_prophase.png",
  );
  const fetchImage = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    blob: async () => new Blob([new Uint8Array(bytes)], { type: "image/png" }),
  } as Response);
  vi.stubGlobal(
    "Image",
    vi.fn(() => {
      const image = document.createElement("img");
      Object.defineProperties(image, {
        naturalWidth: { value: bytes.readUInt32BE(16) },
        naturalHeight: { value: bytes.readUInt32BE(20) },
      });
      Object.defineProperty(image, "src", {
        set: (value: string) => {
          image.setAttribute("src", value);
          queueMicrotask(() => image.dispatchEvent(new Event("load")));
        },
        get: () => image.getAttribute("src") || "",
      });
      return image;
    }),
  );
  let boardApi!: FcboardImperativeAPI;
  const editor = await renderEditor(
    <Fcboard
      handleKeyboardGlobally
      onMount={({ excalidrawAPI }) => {
        boardApi = excalidrawAPI;
      }}
    />,
  );
  const panel = render(<TeachingResources api={boardApi} />);
  try {
    await act(async () => {
      await classroomCommands.execute({
        name: "resources.open",
        args: { category: "biology", section: "division" },
      });
    });
    const group = screen.getByRole("region", {
      name: resourceMenuTitle("teach_res_group_meiosis_second_division"),
    });
    fireEvent.click(
      within(group).getByRole("button", {
        name: new RegExp(t("factoryResources.teach_res_item_prophase")),
      }),
    );
    await waitFor(() => expect(boardApi.getSceneElements()).toHaveLength(1));
    expect(fetchImage).toHaveBeenCalledWith(
      "/factory-resources/cell_division_meiosis2_prophase.png",
    );
    const image = boardApi.getSceneElements()[0];
    if (image.type !== "image" || !image.fileId) {
      throw new Error("Missing biological diagram");
    }
    const file = boardApi.getFiles()[image.fileId];
    expect(file.mimeType).toBe("image/png");
    expect(file.dataURL.split(",")[1]).toBe(bytes.toString("base64"));
    Keyboard.undo();
    expect(boardApi.getSceneElements()).toHaveLength(0);
    Keyboard.redo();
    expect(boardApi.getSceneElements()[0].id).toBe(image.id);
  } finally {
    panel.unmount();
    editor.unmount();
  }
});

it("routes native web actions through inspected control IDs and reports actual browser state", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  const state = {
    open: true,
    loading: false,
    version: "page-one:2",
    canGoBack: false,
    canGoForward: false,
    message: "",
    title: "Force and acceleration",
    text: "6 m/s²",
    controls: [
      {
        id: "w1",
        role: "input",
        label: "Force",
        value: "12",
        disabled: false,
        readonly: false,
        bounds: { x: 0, y: 0, width: 120, height: 30 },
      },
    ],
  };
  vi.mocked(Classroom.webResourceAction).mockResolvedValue(state);
  const view = render(<TeachingResources api={api} />);
  await act(async () => {
    expect(await classroomCommands.execute({ name: "web.action" })).toEqual(
      state,
    );
    expect(
      await classroomCommands.execute({
        name: "web.action",
        args: {
          action: "set",
          version: state.version,
          control: "w1",
          value: 12,
        },
      }),
    ).toEqual(state);
  });
  expect(Classroom.webResourceAction).toHaveBeenLastCalledWith({
    action: "set",
    version: state.version,
    control: "w1",
    value: 12,
  });
  expect(classroomCommands.read("resources")).toMatchObject({ web: state });
  view.unmount();
});

it("rejects native web selectors, scripts, stale requests and missing inspected IDs before dispatch", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  const view = render(<TeachingResources api={api} />);
  const request = new AbortController();
  request.abort();
  await act(async () => {
    for (const args of [
      { action: "click", selector: "#force", version: "v1", control: "w1" },
      { action: "read", script: "document.body.remove()" },
      { action: "click", version: "v1" },
      { action: "set", control: "w1", value: 12 },
      { action: "run" },
      { action: "move", version: "v1", x: "bad", y: 20 },
      { action: "resize", version: "v1", width: 400 },
      { action: "read", signal: request.signal },
    ]) {
      await expect(
        classroomCommands.execute({ name: "web.action", args }),
      ).rejects.toThrow();
    }
  });
  expect(Classroom.webResourceAction).not.toHaveBeenCalled();
  view.unmount();
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

it("opens the source math tools submenu and the other-category scoreboard through their visible controls", async () => {
  render(<TeachingResources api={api} />);
  await act(async () => {
    await classroomCommands.execute({
      name: "resources.open",
      args: { category: "math", section: "tool" },
    });
  });
  expect(
    screen.queryByRole("tab", {
      name: t("fcboard.resourceMenu.teach_res_tab_math_concept"),
    }),
  ).toBeNull();
  expect(
    screen.getByRole("button", {
      name: new RegExp(
        t("factoryResources.teach_res_math_tool_statistics_chart"),
      ),
    }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", {
      name: t("fcboard.resourceMenu.teach_res_sub_math_experiment"),
    }),
  );
  expect(
    screen.getByRole("tab", {
      name: t("fcboard.resourceMenu.teach_res_tab_math_concept"),
    }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.other_resources") }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(t("factoryResources.teach_res_other_scoreboard")),
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("dialog", { name: t("fcboard.scoreBoard.title") }),
    ).toBeVisible(),
  );
  fireEvent.click(screen.getByRole("button", { name: t("buttons.close") }));
  expect(
    screen.getByRole("dialog", { name: t("fcboard.teaching_resources") }),
  ).toBeVisible();
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
    screen.getByRole("button", {
      name: t("fcboard.resourceMenu.teach_res_menu_math"),
    }),
  );
  expect(document.querySelectorAll(".fc-resource-grid > button")).toHaveLength(
    teachingResources.filter(
      (item) =>
        item.category === "math" &&
        item.titleKey.startsWith("teach_res_math_concept_"),
    ).length,
  );
  expect(screen.getByRole("button", { name: /Number Compare/ })).toBeVisible();
  fireEvent.click(
    screen.getByRole("tab", {
      name: t("fcboard.resourceMenu.teach_res_tab_math_application"),
    }),
  );
  expect(screen.queryByRole("button", { name: /Number Compare/ })).toBeNull();
  expect(document.querySelectorAll(".fc-resource-grid > button")).toHaveLength(
    teachingResources.filter((item) =>
      item.titleKey.startsWith("teach_res_math_application_"),
    ).length,
  );
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
