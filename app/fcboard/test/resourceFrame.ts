import { createRequire } from "node:module";
import { MessageChannel } from "node:worker_threads";

import { interactiveHtml } from "@excalidraw/excalidraw/interactiveHtml";
import { attachResourceControls } from "@excalidraw/excalidraw/interactiveResourceControls";

import type { ResourceControlTarget } from "@excalidraw/excalidraw/interactiveResourceControls";

// jsdom 22 is installed without @types/jsdom. Keep its test-only surface explicit.
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string, options: { runScripts: "dangerously" }) => {
    window: Window & typeof globalThis;
  };
};

/** Execute only the repository's fixed lesson fixture, never model-generated HTML. */
export const resourceFrame = (target: ResourceControlTarget) => {
  vi.stubGlobal("MessageChannel", MessageChannel);
  const dom = new JSDOM(interactiveHtml(target.html), {
    runScripts: "dangerously",
  });
  const node = document.createElement("iframe");
  document.body.append(node);
  const post = vi
    .spyOn(node.contentWindow!, "postMessage")
    .mockImplementation(
      (
        data: unknown,
        _origin?: string | WindowPostMessageOptions,
        transfer?: Transferable[],
      ) => {
        dom.window.dispatchEvent(
          new dom.window.MessageEvent("message", {
            data,
            source: dom.window,
            ports: transfer as MessagePort[],
          }),
        );
      },
    );
  const controls = attachResourceControls(target, node);
  return {
    ...controls,
    post,
    window: dom.window,
    node,
    dispose: () => {
      controls.dispose();
      node.remove();
      dom.window.close();
    },
  };
};
