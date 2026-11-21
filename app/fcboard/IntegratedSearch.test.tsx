import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { CapacitorHttp } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";

import { render } from "./test/render";
import { sceneAPI } from "./test/scene";
import { classroomCommands } from "./commands";
import { registerCanvasCommands } from "./canvasCommands";
import { IntegratedSearch } from "./IntegratedSearch";
import * as search from "./searchService";

import type { SearchKind, SearchMedia, SearchPage } from "./searchService";
vi.mock("@capacitor/core", async (original) => ({
  ...(await original<typeof import("@capacitor/core")>()),
  CapacitorHttp: { get: vi.fn() },
}));
const photo = (index = 1): SearchMedia => ({
  url: `https://images.example.test/${index}.png`,
  pictureUrl: `https://images.example.test/thumb/${index}.png`,
  desc: `Photo ${index}`,
  from: "Bing",
  duration: 0,
  width: 200,
  height: 100,
});
const result = (kind: SearchKind): SearchPage =>
  kind === "word"
    ? { text: "Sun definition", items: [] }
    : {
        text: "",
        items: Array.from({ length: 20 }, (_, index) =>
          kind === "photo"
            ? photo(index + 1)
            : {
                ...photo(index + 1),
                desc: index ? `Sun video ${index + 1}` : "Sun video",
                url: `https://www.bilibili.com/video/test/${
                  index ? index + 1 : ""
                }`,
                duration: 91,
              },
        ),
      };
let stop: () => void;
beforeEach(() => {
  vi.spyOn(search, "searchPage").mockImplementation(async (kind) =>
    result(kind),
  );
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 200;
      naturalHeight = 100;
      src = "";
      decode = async () => {};
    },
  );
  vi.mocked(CapacitorHttp.get).mockResolvedValue({
    status: 200,
    headers: { "Content-Type": "image/png" },
    data: "aW1hZ2U=",
    url: "",
  });
  localStorage.removeItem("fcboard.search.side");
});
afterEach(() => {
  stop?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const setup = async (keyword = "Sun") => {
  const api = sceneAPI();
  const state = api.getAppState;
  api.getAppState = () => ({ ...state(), offsetLeft: 0, offsetTop: 0 });
  stop = registerCanvasCommands(api);
  render(<IntegratedSearch api={api} />);
  await act(async () => {
    await classroomCommands.execute({ name: "search.open", args: { keyword } });
  });
  return api;
};
const dialog = () => screen.getByRole("dialog", { name: t("fcboard.search") });
const media = (kind: "photo" | "video") =>
  within(dialog()).getByRole("region", {
    name: t(
      kind === "photo" ? "fcboard.search_images" : "fcboard.search_videos",
    ),
  });
it("loads all three channels, inserts real editable text and opens the selected video in the app", async () => {
  const api = await setup();
  const before = [...api.getSceneElements()];
  expect(search.searchPage).toHaveBeenCalledTimes(3);
  for (const kind of ["word", "photo", "video"]) {
    expect(search.searchPage).toHaveBeenCalledWith(
      kind,
      "Sun",
      1,
      expect.any(AbortSignal),
    );
  }
  expect(within(dialog()).getByText("Sun definition")).toBeVisible();
  fireEvent.click(
    within(dialog()).getByRole("button", { name: t("fcboard.search_insert") }),
  );
  await waitFor(() =>
    expect(
      api
        .getSceneElements()
        .some(
          (item) =>
            item.type === "text" && item.text.includes("Sun definition"),
        ),
    ).toBe(true),
  );
  expect(
    api
      .getSceneElements()
      .filter((item) => before.some((old) => old.id === item.id)),
  ).toEqual(before);
  const open = vi.fn();
  const release = classroomCommands.register("web.open", "@internal", open);
  try {
    fireEvent.click(
      within(media("video")).getByRole("button", { name: "Sun video" }),
    );
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith({
        url: "https://www.bilibili.com/video/test/",
      }),
    );
    expect(screen.getAllByText("01:31")[0]).toBeVisible();
  } finally {
    release();
  }
});
it("paginates each media channel independently and retries the same failed page", async () => {
  vi.mocked(search.searchPage).mockImplementation(
    async (kind, _query, page) => {
      if (kind === "photo" && page === 2) {
        throw Error("Photo service unavailable");
      }
      return result(kind);
    },
  );
  await setup();
  fireEvent.click(
    within(media("photo")).getByRole("button", {
      name: t("fcboard.search_more"),
    }),
  );
  await waitFor(() =>
    expect(
      within(media("photo")).getByRole("button", { name: t("chat.retry") }),
    ).toBeVisible(),
  );
  fireEvent.click(
    within(media("photo")).getByRole("button", { name: t("chat.retry") }),
  );
  await waitFor(() =>
    expect(
      vi
        .mocked(search.searchPage)
        .mock.calls.filter(([kind, , page]) => kind === "photo" && page === 2),
    ).toHaveLength(2),
  );
  expect(
    vi
      .mocked(search.searchPage)
      .mock.calls.filter(([kind]) => kind === "video"),
  ).toHaveLength(1);
  expect(screen.getByText("Sun definition")).toBeVisible();
});
it("cancels old query/clear/close requests and refuses their late results", async () => {
  let resolveOld!: (value: SearchPage) => void;
  vi.mocked(search.searchPage).mockImplementation((kind, query) =>
    query === "Old" && kind === "word"
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve(result(kind)),
  );
  await setup("Old");
  const oldSignal = vi.mocked(search.searchPage).mock.calls[0][3];
  fireEvent.change(
    within(dialog()).getByRole("textbox", { name: t("fcboard.search") }),
    { target: { value: "New" } },
  );
  fireEvent.submit(dialog().querySelector("form")!);
  expect(oldSignal.aborted).toBe(true);
  await act(async () => resolveOld({ text: "Stale definition", items: [] }));
  expect(screen.queryByText("Stale definition")).toBeNull();
  fireEvent.click(
    within(dialog()).getByRole("button", { name: t("buttons.clear") }),
  );
  expect(within(dialog()).getByRole("textbox")).toHaveValue("");
  expect(screen.queryByText("Sun definition")).toBeNull();
  const latest = vi.mocked(search.searchPage).mock.calls.at(-1)![3];
  fireEvent.click(
    within(dialog()).getByRole("button", { name: t("buttons.close") }),
  );
  expect(latest.aborted).toBe(true);
  expect(
    screen.queryByRole("dialog", { name: t("fcboard.search") }),
  ).toBeNull();
});
it("keeps results when hidden and restores them, while persisting the original side switch", async () => {
  await setup();
  fireEvent.click(
    within(dialog()).getByRole("button", {
      name: t("fcboard.search_switch_side"),
    }),
  );
  expect(dialog()).toHaveClass("fc-search-on-left");
  fireEvent.click(
    within(dialog()).getByRole("button", { name: t("fcboard.search_hide") }),
  );
  expect(
    screen.queryByRole("dialog", { name: t("fcboard.search") }),
  ).toBeNull();
  await act(async () => {
    await classroomCommands.execute({ name: "search.open" });
  });
  expect(dialog()).toHaveClass("fc-search-on-left");
  expect(screen.getByText("Sun definition")).toBeVisible();
  expect(search.searchPage).toHaveBeenCalledTimes(3);
});
it("inserts a held image at the real board drop without removing the source or requiring a provider URL", async () => {
  const api = await setup();
  const before = [...api.getSceneElements()];
  const tile = within(media("photo")).getByRole("button", { name: "Photo 1" });
  Object.defineProperties(tile, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: () => true },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
  vi.spyOn(dialog(), "getBoundingClientRect").mockReturnValue({
    left: 1200,
    right: 1600,
    top: 100,
    bottom: 800,
    width: 400,
    height: 700,
    x: 1200,
    y: 100,
    toJSON: () => ({}),
  });
  const pointer = (type: string, x: number, y: number) =>
    fireEvent(
      tile,
      Object.assign(new Event(type, { bubbles: true }), {
        pointerId: 1,
        button: 0,
        clientX: x,
        clientY: y,
      }),
    );
  vi.useFakeTimers();
  pointer("pointerdown", 1300, 400);
  act(() => vi.advanceTimersByTime(500));
  pointer("pointermove", 600, 400);
  pointer("pointerup", 600, 400);
  vi.useRealTimers();
  await waitFor(() =>
    expect(api.getSceneElements().some((item) => item.type === "image")).toBe(
      true,
    ),
  );
  const image = api.getSceneElements().find((item) => item.type === "image")!;
  expect(image.x + image.width / 2).toBeCloseTo(600);
  expect(image.y + image.height / 2).toBeCloseTo(400);
  expect(api.addFiles).toHaveBeenCalledWith([
    expect.objectContaining({ dataURL: "data:image/png;base64,aW1hZ2U=" }),
  ]);
  expect(
    api
      .getSceneElements()
      .filter((item) => before.some((old) => old.id === item.id)),
  ).toEqual(before);
});
it("does not insert an image that finishes downloading after closing the window", async () => {
  let finish!: () => void;
  vi.mocked(CapacitorHttp.get).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            status: 200,
            headers: { "Content-Type": "image/png" },
            data: "aW1hZ2U=",
            url: "",
          });
      }),
  );
  const api = await setup();
  const before = [...api.getSceneElements()];
  fireEvent.click(
    within(media("photo")).getByRole("button", { name: "Photo 1" }),
  );
  fireEvent.click(
    within(dialog()).getByRole("button", { name: t("buttons.close") }),
  );
  await act(async () => finish());
  expect(api.getSceneElements()).toEqual(before);
  expect(api.addFiles).not.toHaveBeenCalled();
});
it("bounds decoded thumbnails to visible columns even after hundreds of results", async () => {
  vi.mocked(search.searchPage).mockImplementation(async (kind) =>
    kind === "photo"
      ? { text: "", items: Array.from({ length: 600 }, (_, i) => photo(i + 1)) }
      : result(kind),
  );
  await setup();
  expect(
    media("photo").querySelectorAll(".fc-search-image-tile").length,
  ).toBeLessThan(20);
});

it("stops pagination on an empty page and does not skip or duplicate concurrent page requests", async () => {
  let finish!: (page: SearchPage) => void;
  vi.mocked(search.searchPage).mockImplementation((kind, _query, page) =>
    kind === "photo" && page === 2
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(result(kind)),
  );
  await setup();
  const button = within(media("photo")).getByRole("button", {
    name: t("fcboard.search_more"),
  });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(
    vi
      .mocked(search.searchPage)
      .mock.calls.filter(([kind, , page]) => kind === "photo" && page === 2),
  ).toHaveLength(1);
  await act(async () => finish({ text: "", items: [] }));
  expect(
    within(media("photo")).queryByRole("button", {
      name: t("fcboard.search_more"),
    }),
  ).toBeNull();
  expect(within(media("photo")).getByText("No more data")).toBeInTheDocument();
  expect(
    within(media("video")).getByRole("button", {
      name: t("fcboard.search_more"),
    }),
  ).toBeEnabled();
});
it("shows empty/offline states without an enabled insert button or unnecessary request", async () => {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
  await setup();
  expect(search.searchPage).not.toHaveBeenCalled();
  expect(screen.getAllByText(t("fcboard.search_offline"))).toHaveLength(3);
  expect(
    within(dialog()).getByRole("button", { name: t("fcboard.search_insert") }),
  ).toBeDisabled();
});
it("restarts the same query at its first result instead of retaining a virtual scroll offset", async () => {
  vi.mocked(search.searchPage).mockImplementation(async (kind) =>
    kind === "photo"
      ? { text: "", items: Array.from({ length: 600 }, (_, i) => photo(i + 1)) }
      : result(kind),
  );
  await setup();
  const strip = media("photo");
  Object.defineProperties(strip, {
    scrollWidth: { configurable: true, value: 60000 },
    clientWidth: { configurable: true, value: 320 },
  });
  fireEvent.scroll(strip, { target: { scrollLeft: 6000 } });
  expect(
    within(media("photo")).queryByRole("button", { name: "Photo 1" }),
  ).toBeNull();
  fireEvent.submit(dialog().querySelector("form")!);
  await waitFor(() =>
    expect(
      within(media("photo")).getByRole("button", { name: "Photo 1" }),
    ).toBeInTheDocument(),
  );
});

it("ends a repeated provider page without an endless four-column preload loop", async () => {
  await setup();
  fireEvent.click(
    within(media("photo")).getByRole("button", {
      name: t("fcboard.search_more"),
    }),
  );
  await waitFor(() =>
    expect(
      within(media("photo")).getByText("No more data"),
    ).toBeInTheDocument(),
  );
  expect(
    vi
      .mocked(search.searchPage)
      .mock.calls.filter(([kind]) => kind === "photo"),
  ).toHaveLength(2);
});
