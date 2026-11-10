import { act, screen, waitFor } from "@testing-library/react";
import { exportToBlob } from "@fcboard/fcboard";

import { BoardThumbnail } from "./BoardThumbnail";
import { render } from "./test/render";

import type { Board } from "./boards";

vi.mock("@fcboard/fcboard", async (original) => ({
  ...(await original<typeof import("@fcboard/fcboard")>()),
  exportToBlob: vi.fn(),
}));
const page = (): Board => ({
  id: "one",
  name: "空白图案页",
  elements: [],
  files: {},
  view: {
    scrollX: 0,
    scrollY: 0,
    zoom: { value: 1 as Board["view"]["zoom"]["value"] },
    viewBackgroundColor: "#253a35",
    whiteboardBackground: { pattern: 3, width: 1280, height: 720 },
  },
  updated: 1,
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("renders the full background of an empty page instead of leaving its thumbnail blank", async () => {
  vi.mocked(exportToBlob).mockResolvedValue(
    new Blob(["actual renderer result"], { type: "image/png" }),
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:empty-page");
  const release = vi.spyOn(URL, "revokeObjectURL");
  const board = page();
  const view = render(
    <BoardThumbnail
      board={board}
      canvasSize={{ width: 1280, height: 720, pixelRatio: 1 }}
    />,
  );
  expect(await screen.findByRole("img")).toHaveAttribute(
    "src",
    "blob:empty-page",
  );
  const options = vi.mocked(exportToBlob).mock.calls.at(-1)![0];
  expect(options.elements).toHaveLength(0);
  expect(options.appState?.whiteboardBackground).toEqual(
    board.view.whiteboardBackground,
  );
  expect(options.exportingFrame).toMatchObject({ width: 1280, height: 720 });
  view.unmount();
  expect(release).toHaveBeenCalledWith("blob:empty-page");
});

it("releases a stale render after changing page size and displays only the latest full-page preview", async () => {
  let old!: (blob: Blob) => void;
  let latest!: (blob: Blob) => void;
  vi.mocked(exportToBlob)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          old = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          latest = resolve;
        }),
    );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:latest");
  const release = vi.spyOn(URL, "revokeObjectURL");
  const board = page();
  const view = render(
    <BoardThumbnail
      board={board}
      canvasSize={{ width: 1280, height: 720, pixelRatio: 1 }}
    />,
  );
  await waitFor(() => expect(exportToBlob).toHaveBeenCalledTimes(1));
  view.rerender(
    <BoardThumbnail
      board={board}
      canvasSize={{ width: 720, height: 1280, pixelRatio: 1 }}
    />,
  );
  expect(exportToBlob).toHaveBeenCalledTimes(1);
  act(() => old(new Blob(["old"], { type: "image/png" })));
  await waitFor(() => expect(exportToBlob).toHaveBeenCalledTimes(2));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByRole("img")).toBeNull();
  act(() => latest(new Blob(["new"], { type: "image/png" })));
  expect(await screen.findByRole("img")).toHaveAttribute("src", "blob:latest");
  view.unmount();
  expect(release).toHaveBeenCalledWith("blob:latest");
});

it("uses actual portrait canvas proportion and never exports invisible pages or overlaps preview canvases", async () => {
  const observed = new Map<
    Element,
    (entries: IntersectionObserverEntry[]) => void
  >();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(
        private callback: (entries: IntersectionObserverEntry[]) => void,
      ) {}
      observe(element: Element) {
        observed.set(element, this.callback);
      }
      disconnect() {}
    },
  );
  let finish!: (blob: Blob) => void;
  vi.mocked(exportToBlob)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(new Blob(["next"], { type: "image/png" }));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:visible");
  const release = vi.spyOn(URL, "revokeObjectURL");
  const view = render(
    <div className="fc-board-list">
      <BoardThumbnail
        board={page()}
        canvasSize={{ width: 720, height: 1280, pixelRatio: 2 }}
      />
      <BoardThumbnail board={{ ...page(), id: "two" }} />
    </div>,
  );
  expect(exportToBlob).not.toHaveBeenCalled();
  const nodes = Array.from(observed.keys());
  expect(nodes[0]).toHaveStyle({ aspectRatio: "720 / 1280" });
  act(() =>
    observed.get(nodes[0])!([
      { isIntersecting: true } as IntersectionObserverEntry,
    ]),
  );
  await waitFor(() => expect(exportToBlob).toHaveBeenCalledTimes(1));
  act(() =>
    observed.get(nodes[1])!([
      { isIntersecting: true } as IntersectionObserverEntry,
    ]),
  );
  expect(exportToBlob).toHaveBeenCalledTimes(1);
  act(() => finish(new Blob(["first"], { type: "image/png" })));
  await waitFor(() => expect(exportToBlob).toHaveBeenCalledTimes(2));
  expect(await screen.findAllByRole("img")).toHaveLength(2);
  act(() =>
    observed.get(nodes[0])!([
      { isIntersecting: false } as IntersectionObserverEntry,
    ]),
  );
  expect(release).toHaveBeenCalledWith("blob:visible");
  expect(screen.getAllByRole("img")).toHaveLength(1);
  view.unmount();
});
