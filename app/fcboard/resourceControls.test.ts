import { requestResourceControl } from "@excalidraw/excalidraw/interactiveResourceControls";

import type { ResourceControlState } from "@excalidraw/excalidraw/interactiveResourceControls";

import { classroomCommands } from "./commands";
import { registerCanvasCommands } from "./canvasCommands";
import { sceneAPI } from "./test/scene";
import { resourceFrame } from "./test/resourceFrame";
import { interactiveResource } from "./test/interactiveResource";

import type { InkStroke } from "./documents";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("operates the actual canvas object and reports its live calculation to the agent", async () => {
  const api = sceneAPI();
  const stop = registerCanvasCommands(api);
  const { ids } = (await classroomCommands.execute({
    name: "canvas.resource",
    args: { resource: interactiveResource },
  })) as { ids: string[] };
  const element = api.getSceneElements().find((item) => item.id === ids[0])!;
  const frame = resourceFrame({
    id: element.id,
    surface: "whiteboard",
    html: element.customData!.fcInteractiveResource.html,
  });
  frame.loaded();
  try {
    const snapshot = (await classroomCommands.execute({
      name: "canvas.inspect",
    })) as { elements: { id: string; interactive?: boolean }[] };
    expect(
      snapshot.elements.find((item) => item.id === element.id)?.interactive,
    ).toBe(true);
    const state = (await classroomCommands.execute({
      name: "resources.inspect",
      args: { id: element.id },
    })) as ResourceControlState;
    const force = state.controls.find((item) => item.type === "range")!;
    await expect(
      classroomCommands.execute({
        name: "resources.interact",
        args: {
          id: element.id,
          version: state.version,
          control: force.id,
          action: "set",
          value: 10,
        },
      }),
    ).resolves.toMatchObject({
      id: element.id,
      surface: "whiteboard",
      outputs: ["5 m/s²"],
    });
    await expect(
      classroomCommands.execute({
        name: "resources.inspect",
        args: { id: interactiveResource.id },
      }),
    ).rejects.toThrow("RESOURCE_OBJECT_NOT_VISIBLE");
    api.updateScene({
      elements: api.getSceneElements().filter((item) => item.id !== element.id),
    });
    await expect(
      classroomCommands.execute({
        name: "resources.inspect",
        args: { id: element.id },
      }),
    ).rejects.toThrow("RESOURCE_OBJECT_NOT_VISIBLE");
  } finally {
    frame.dispose();
    stop();
  }
});

it("routes a graphic drag through the public command and returns the real changed simulation", async () => {
  const api = sceneAPI();
  const stop = registerCanvasCommands(api);
  const resource = {
    ...interactiveResource,
    html: interactiveResource.html.replace(
      "</script>",
      `
const block=document.getElementById('block');
block.setAttribute('aria-label','Mass');
let held=false;
block.addEventListener('pointerdown',event=>{held=true;block.setPointerCapture(event.pointerId);});
block.addEventListener('pointermove',event=>{if(held){force.value=String(Math.round(event.clientX/10));update();}});
block.addEventListener('pointerup',event=>{held=false;block.releasePointerCapture(event.pointerId);});
</script>`,
    ),
  };
  const { ids } = (await classroomCommands.execute({
    name: "canvas.resource",
    args: { resource },
  })) as { ids: string[] };
  const element = api.getSceneElements().find((item) => item.id === ids[0])!;
  const frame = resourceFrame({
    id: element.id,
    surface: "whiteboard",
    html: element.customData!.fcInteractiveResource.html,
  });
  frame.loaded();
  const block = frame.window.document.querySelector<SVGElement>("#block")!;
  vi.spyOn(block, "getBoundingClientRect").mockImplementation(() => ({
    x: Number(block.getAttribute("x")),
    y: 20,
    width: 40,
    height: 40,
    left: Number(block.getAttribute("x")),
    top: 20,
    right: Number(block.getAttribute("x")) + 40,
    bottom: 60,
    toJSON: () => ({}),
  }));
  try {
    const state = (await classroomCommands.execute({
      name: "resources.inspect",
      args: { id: element.id },
    })) as ResourceControlState;
    const graphic = state.controls.find((item) => item.label === "Mass")!;
    await expect(
      classroomCommands.execute({
        name: "resources.interact",
        args: {
          id: element.id,
          version: state.version,
          control: graphic.id,
          action: "drag",
          to: { x: 100, y: 40 },
        },
      }),
    ).resolves.toMatchObject({
      id: element.id,
      outputs: ["5 m/s²"],
      controls: expect.arrayContaining([
        expect.objectContaining({
          id: graphic.id,
          bounds: { x: 150, y: 20, width: 40, height: 40 },
        }),
      ]),
    });
  } finally {
    frame.dispose();
    stop();
  }
});

it("targets only the visible document page even when the hidden board has the same resource id", async () => {
  const api = sceneAPI();
  const stop = registerCanvasCommands(api);
  const { ids } = (await classroomCommands.execute({
    name: "canvas.resource",
    args: { resource: interactiveResource },
  })) as { ids: string[] };
  const element = api.getSceneElements().find((item) => item.id === ids[0])!;
  const boardFrame = resourceFrame({
    id: element.id,
    surface: "whiteboard",
    html: element.customData!.fcInteractiveResource.html,
  });
  const ink: InkStroke = {
    id: element.id,
    color: "#000",
    width: 1,
    points: [[0, 0]],
    resource: { ...interactiveResource, width: 720, height: 460 },
  };
  const documentFrame = resourceFrame({
    id: ink.id,
    surface: "document",
    html: interactiveResource.html,
  });
  let page = 1;
  const release = classroomCommands.context("document", () => ({
    id: "course",
    page,
    ink: page === 1 ? [ink] : [],
  }));
  boardFrame.loaded();
  documentFrame.loaded();
  try {
    const state = (await classroomCommands.execute({
      name: "resources.inspect",
      args: { id: ink.id },
    })) as ResourceControlState;
    expect(boardFrame.post).not.toHaveBeenCalled();
    expect(documentFrame.post).toHaveBeenCalledTimes(1);
    expect(state.outputs).toEqual(["2 m/s²"]);
    // Delay a response until after a page turn: its old data must be rejected.
    const post = documentFrame.post.getMockImplementation()!;
    documentFrame.post.mockImplementation((...args) => {
      post(...args);
      page = 2;
    });
    await expect(
      classroomCommands.execute({
        name: "resources.inspect",
        args: { id: ink.id },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      classroomCommands.execute({
        name: "resources.inspect",
        args: { id: ink.id },
      }),
    ).rejects.toThrow("RESOURCE_OBJECT_NOT_VISIBLE");
    expect(boardFrame.post).not.toHaveBeenCalled();
  } finally {
    release();
    boardFrame.dispose();
    documentFrame.dispose();
    stop();
  }
});

it("rejects invalid action payloads before dispatch and aborts requests on invalidation/unmount", async () => {
  const api = sceneAPI();
  const stop = registerCanvasCommands(api);
  const { ids } = (await classroomCommands.execute({
    name: "canvas.resource",
    args: { resource: interactiveResource },
  })) as { ids: string[] };
  try {
    for (const args of [
      { action: "script", script: "alert(1)" },
      { action: "set", version: "v1", control: "#force", value: 10 },
      { action: "set", version: "v1", control: "c1", value: NaN },
      { action: "click", version: "v1", control: "c1", selector: "button" },
      { action: "drag", version: "v1", control: "c1" },
      { action: "drag", version: "v1", control: "c1", to: { x: NaN, y: 0 } },
      {
        action: "drag",
        version: "v1",
        control: "c1",
        to: { x: 20, y: 30, selector: "rect" },
      },
      { action: "click", version: "v1", control: "c1", to: { x: 20, y: 30 } },
    ]) {
      await expect(
        classroomCommands.execute({
          name: "resources.interact",
          args: { id: ids[0], ...args },
        }),
      ).rejects.toThrow("RESOURCE_INVALID_ACTION");
    }
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      classroomCommands.execute({
        name: "resources.inspect",
        args: { id: ids[0], signal: aborted.signal },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const loading = classroomCommands.execute({
      name: "resources.inspect",
      args: { id: ids[0] },
    });
    classroomCommands.invalidate();
    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
    const again = classroomCommands.execute({
      name: "resources.inspect",
      args: { id: ids[0] },
    });
    stop();
    await expect(again).rejects.toMatchObject({ name: "AbortError" });
  } finally {
    stop();
  }
});

it("rejects a reply after switching boards without applying it to the new board", async () => {
  const api = sceneAPI();
  const stop = registerCanvasCommands(api);
  const { ids } = (await classroomCommands.execute({
    name: "canvas.resource",
    args: { resource: interactiveResource },
  })) as { ids: string[] };
  const element = api.getSceneElements().find((item) => item.id === ids[0])!;
  const target = {
    id: element.id,
    surface: "whiteboard" as const,
    html: element.customData!.fcInteractiveResource.html,
  };
  const frame = resourceFrame(target);
  frame.loaded();
  let active = "board-one";
  const release = classroomCommands.context("boards", () => ({ active }));
  try {
    const post = frame.post.getMockImplementation()!;
    frame.post.mockImplementation((...args) => {
      post(...args);
      active = "board-two";
    });
    await expect(
      classroomCommands.execute({
        name: "resources.inspect",
        args: { id: element.id },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    // Direct client remains available on this mounted fixture; the router rejected its stale board context.
    expect(
      (
        await requestResourceControl(
          target,
          { type: "inspect" },
          { current: () => true },
        )
      ).outputs,
    ).toEqual(["2 m/s²"]);
  } finally {
    release();
    frame.dispose();
    stop();
  }
});
