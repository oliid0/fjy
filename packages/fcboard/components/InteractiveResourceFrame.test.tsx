import { MessageChannel } from "node:worker_threads";

import { render, screen } from "@testing-library/react";

import { interactiveResource } from "../../../app/fcboard/test/interactiveResource";

import { requestResourceControl } from "../interactiveResourceControls";

import { InteractiveResourceFrame } from "./InteractiveResourceFrame";

import type { ResourceControlState } from "../interactiveResourceControls";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps a loaded channel when the editor refreshes its callback ref, and cancels it on unmount", async () => {
  vi.stubGlobal("MessageChannel", MessageChannel);
  const ref = vi.fn();
  const nextRef = vi.fn();
  const props = {
    resource: interactiveResource,
    objectId: "lesson",
    surface: "whiteboard" as const,
  };
  const view = render(<InteractiveResourceFrame {...props} iframeRef={ref} />);
  const frame = screen.getByTitle(
    interactiveResource.title,
  ) as HTMLIFrameElement;
  const post = vi
    .spyOn(frame.contentWindow!, "postMessage")
    .mockImplementation(
      (
        _message: unknown,
        _origin?: string | WindowPostMessageOptions,
        transfer?: Transferable[],
      ) => {
        const state: ResourceControlState = {
          version: "test",
          title: "Acceleration",
          viewport: { width: 640, height: 420 },
          offset: 0,
          total: 0,
          controls: [],
          outputs: ["2 m/s²"],
          truncated: false,
        };
        (transfer![0] as MessagePort).postMessage({ ok: true, state });
      },
    );
  await new Promise<void>((resolve) =>
    frame.addEventListener("load", () => resolve(), { once: true }),
  );
  view.rerender(<InteractiveResourceFrame {...props} iframeRef={nextRef} />);
  expect(ref).toHaveBeenLastCalledWith(null);
  expect(nextRef).toHaveBeenLastCalledWith(frame);
  const target = {
    surface: props.surface,
    id: props.objectId,
    html: interactiveResource.html,
  };
  expect(
    (
      await requestResourceControl(
        target,
        { type: "inspect" },
        { current: () => true },
      )
    ).outputs,
  ).toEqual(["2 m/s²"]);
  post.mockImplementation(() => {});
  const pending = requestResourceControl(
    target,
    { type: "inspect" },
    { current: () => true },
  );
  view.unmount();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(nextRef).toHaveBeenLastCalledWith(null);
});
