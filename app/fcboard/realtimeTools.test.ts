import { classroomCommands, executeBoardCommand } from "./commands";
import { registerCanvasCommands } from "./canvasCommands";
import { realtimeCommand, realtimeTools } from "./realtimeTools";
import { sceneAPI } from "./test/scene";

it("routes typed writing and pen paths to actual editable scene elements with no model or image generation", async () => {
  const api = sceneAPI();
  api.updateScene({ elements: [] });
  const stop = registerCanvasCommands(api);
  try {
    expect(realtimeTools().some((tool) => tool.name === "board_draw")).toBe(
      true,
    );
    await executeBoardCommand(
      realtimeCommand({
        name: "board_write",
        arguments: JSON.stringify({
          text: "牛顿定律",
          role: "title",
          presentation: "handwritten",
          placement: "center",
          sourceIds: [],
        }),
      }),
    );
    await executeBoardCommand(
      realtimeCommand({
        function: {
          name: "board_draw",
          arguments: JSON.stringify({
            strokes: [
              [
                [500, 200],
                [525, 160],
                [550, 200],
              ],
              [
                [525, 160],
                [535, 145],
              ],
            ],
            select: false,
            pen: "highlighter",
            color: "#2299aa",
            opacity: 70,
          }),
        },
      }),
    );
    expect(api.getSceneElements()).toHaveLength(3);
    expect(
      api.getSceneElements().filter((element) => element.type === "text"),
    ).toHaveLength(1);
    expect(
      api.getSceneElements().filter((element) => element.type === "freedraw"),
    ).toHaveLength(2);
    const ink = api
      .getSceneElements()
      .find((element) => element.type === "freedraw");
    expect(ink).toMatchObject({
      x: 500,
      y: 200,
      strokeColor: "#2299aa",
      opacity: 30,
      customData: { fcInk: { pen: "highlighter" } },
      points: [
        [0, 0],
        [25, -40],
        [50, 0],
      ],
    });
  } finally {
    stop();
  }
  expect(realtimeTools().some((tool) => tool.name === "board_draw")).toBe(
    false,
  );
});

it("does not expose or execute unregistered, private or malformed realtime commands", () => {
  const stop = classroomCommands.register("ui.invoke", "@internal", vi.fn());
  try {
    for (const item of [
      { name: "board_command", arguments: '{"name":"ui.invoke"}' },
      { name: "board_draw", arguments: '{"strokes":[]}' },
      { name: "made_up_tool", arguments: "{}" },
      { name: "board_command", arguments: '{"name":"canvas.text","args":[]}' },
    ]) {
      expect(() => realtimeCommand(item)).toThrow();
    }
  } finally {
    stop();
  }
});
