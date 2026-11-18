import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

import { comparisonVisualization } from "../../../app/fcboard/test/comparisonVisualization";
import { InteractiveResourceFrame } from "../components/InteractiveResourceFrame";
import * as source from "../resourceHtml";

import type { InteractiveResource } from "../interactiveHtml";

const resource: InteractiveResource = {
  id: "comparison",
  title: "Comparison",
  html: "<html><body><svg><text>Comparison</text></svg></body></html>",
  visualization: comparisonVisualization,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("reports the actual iframe after asynchronous runtime loading and clears it on removal", async () => {
  const ref = { current: null as HTMLIFrameElement | null };
  const view = render(
    <InteractiveResourceFrame
      resource={resource}
      objectId="comparison"
      surface="whiteboard"
      iframeRef={ref}
    />,
  );
  expect(ref.current).toBeInstanceOf(HTMLIFrameElement);
  expect(ref.current).toHaveAttribute("aria-busy", "true");
  expect(ref.current!.srcdoc).toContain("Comparison");
  await waitFor(() =>
    expect(ref.current).toHaveAttribute("aria-busy", "false"),
  );
  expect(ref.current).toHaveAttribute("sandbox", "allow-scripts");
  expect(ref.current!.srcdoc).toContain("ast:true");
  expect(ref.current!.srcdoc).toContain("structuredClone");
  view.unmount();
  expect(ref.current).toBeNull();
});

it("does not show a stale resource when the previous async load completes later", async () => {
  const pending: ((html: string) => void)[] = [];
  vi.spyOn(source, "resourceHtml").mockImplementation(
    () => new Promise((resolve) => pending.push(resolve)),
  );
  const view = render(
    <InteractiveResourceFrame
      resource={resource}
      objectId="comparison"
      surface="whiteboard"
    />,
  );
  await waitFor(() => expect(pending).toHaveLength(1));
  view.rerender(
    <InteractiveResourceFrame
      resource={{ ...resource, id: "new", title: "New" }}
      objectId="new"
      surface="whiteboard"
    />,
  );
  await waitFor(() => expect(pending).toHaveLength(2));
  await act(async () => pending[0]("<svg>Old</svg>"));
  expect(screen.getByTitle("New")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByTitle("New")).not.toHaveAttribute(
    "srcdoc",
    "<svg>Old</svg>",
  );
  await act(async () => pending[1]("<svg>New</svg>"));
  expect(screen.getByTitle("New")).toHaveAttribute("srcdoc", "<svg>New</svg>");
});

it("shows an async runtime failure as an actionable error instead of an empty window", async () => {
  vi.spyOn(source, "resourceHtml").mockRejectedValue(
    new Error("Cannot open this chart"),
  );
  render(
    <InteractiveResourceFrame
      resource={resource}
      objectId="comparison"
      surface="whiteboard"
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Cannot open this chart",
  );
  expect(document.querySelector("iframe")).toBeNull();
});

it("holds authored JSXGraph scripts and inline handlers until its declared package is ready", async () => {
  let finish!: (html: string) => void;
  vi.spyOn(source, "resourceHtml").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const geometry: InteractiveResource = {
    id: "geometry",
    title: "Geometry",
    libraries: ["jsxgraph"],
    html: '<html><body><h1>Geometry</h1><div id="b" data-fc-graphics onclick="JXG.JSXGraph.initBoard()"></div><script>JXG.JSXGraph.initBoard("b");</script></body></html>',
  };
  render(
    <InteractiveResourceFrame
      resource={geometry}
      objectId="geometry"
      surface="whiteboard"
    />,
  );
  const frame = screen.getByTitle("Geometry") as HTMLIFrameElement;
  expect(frame).toHaveAttribute("aria-busy", "true");
  const preview = new DOMParser().parseFromString(frame.srcdoc, "text/html");
  expect(preview.querySelector("script")).toBeNull();
  expect(preview.querySelector("[onclick]")).toBeNull();
  expect(preview.body.style.pointerEvents).toBe("none");
  expect(preview.querySelector('[role="status"]')).not.toBeNull();
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(async () => finish("<svg>Installed engine ready</svg>"));
  expect(frame).toHaveAttribute("aria-busy", "false");
  expect(frame.srcdoc).toBe("<svg>Installed engine ready</svg>");
});
