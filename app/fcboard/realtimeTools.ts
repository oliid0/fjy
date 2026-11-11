import { classroomCommands } from "./commands";

import type { Command } from "./commands";

const point = {
  type: "array",
  items: { type: "number" },
  minItems: 2,
  maxItems: 2,
};
const ids = { type: "array", items: { type: "string" }, minItems: 1 };
const bindings = [
  {
    name: "board_tools",
    command: "agent.tools",
    description:
      "Discover actual currently available operations by query or exact names. Returns purpose, declared parameter schemas/requirements, result contract and callable function name. Use before an unfamiliar action; for visible controls then use ui.inspect and real control ids. New component tools appear here automatically.",
    properties: {
      query: { type: "string" },
      names: { type: "array", items: { type: "string" } },
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    required: [],
  },
  {
    name: "board_teach",
    command: "lesson.ask",
    description:
      "Use only for an explicitly requested board demonstration, animation or writing. Concept questions are answered directly in voice without any task. Start independent board/pen/resource agents while explaining immediately in voice; do not wait for generation. Only explicit explanation text returns for speech on this live connection. No extra player or panel.",
    properties: { prompt: { type: "string" } },
    required: ["prompt"],
  },
  {
    name: "board_animate",
    command: "canvas.animate",
    description:
      "Write and draw incrementally using the existing lesson pen renderer. Coordinates are relative to the current insertion origin. Each command uses type/id directly, never nested name/args. To revise existing writing reuse its observed lessonId and tutorId as command.id. Standalone titles use board_write.",
    properties: {
      lessonId: { type: "string" },
      commands: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: [
                "write_text",
                "write_math",
                "draw_path",
                "draw_arrow",
                "draw_line",
                "draw_rectangle",
                "draw_ellipse",
                "annotate_circle",
                "annotate_underline",
              ],
            },
            id: { type: "string" },
            text: { type: "string" },
            points: { type: "array", items: point },
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
            color: { type: "string" },
            duration: { type: "number", minimum: 0, maximum: 8 },
          },
          required: ["type", "id"],
          additionalProperties: false,
        },
      },
    },
    required: ["commands"],
  },
  {
    name: "board_inspect",
    command: "canvas.inspect",
    description:
      "Read real visible objects, ids, viewport, coordinates, selection and revision before operating.",
    properties: {},
    required: [],
  },
  {
    name: "board_write",
    command: "canvas.text",
    description:
      "Write or correct editable board text. A title uses role=title,presentation=handwritten,placement=center,sourceIds=[]. Reuse an observed text id to correct it.",
    properties: {
      text: { type: "string" },
      id: { type: "string" },
      role: { type: "string", enum: ["title"] },
      presentation: { type: "string", enum: ["match", "handwritten", "text"] },
      placement: { type: "string", enum: ["center"] },
      sourceIds: { type: "array", items: { type: "string" } },
    },
    required: ["text"],
  },
  {
    name: "board_draw",
    command: "canvas.ink",
    description:
      "Draw actual editable pen strokes, including an apple, handwriting or demonstration diagram. Each stroke is an ordered polyline of [x,y] points in the inspected visible canvas coordinates. Use pen/color/width/opacity on this call for independent real brush, highlighter, dashed or rainbow effects. Submit meaningful stroke batches promptly; do not replace a requested drawing with text.",
    properties: {
      strokes: {
        type: "array",
        items: { type: "array", items: point, minItems: 1 },
        minItems: 1,
      },
      select: { type: "boolean" },
      pen: {
        type: "string",
        enum: ["hard", "brush", "highlighter", "dashed", "rainbow"],
      },
      color: { type: "string" },
      width: { type: "number", minimum: 1, maximum: 30 },
      opacity: { type: "number", minimum: 0, maximum: 100 },
    },
    required: ["strokes"],
  },
  {
    name: "board_shape",
    command: "shapes.insert",
    description:
      "Insert an editable factory shape. Use kind=cube for a cube. Read canvas.inspect first and pass its real revision and start/end points in its visible coordinate space. Other kinds appear in the command description.",
    properties: {
      kind: { type: "string" },
      start: point,
      end: point,
      revision: { type: "integer" },
    },
    required: ["kind", "start", "end", "revision"],
  },
  {
    name: "board_select",
    command: "canvas.select",
    description:
      "Select existing observed object ids before changing their style or font size.",
    properties: { ids },
    required: ["ids"],
  },
  {
    name: "board_move",
    command: "canvas.move",
    description:
      "Move the actual observed ids or selected group by dx/dy in board coordinates, preserving editable handwriting and text.",
    properties: { ids, dx: { type: "number" }, dy: { type: "number" } },
    required: ["dx", "dy"],
  },
  {
    name: "board_resize",
    command: "canvas.resize",
    description:
      "Enlarge or shrink an existing title, handwriting, drawing or selected group. Pass observed ids and scale (for example 1.25 for larger). Scales real pen paths and text together; do not insert a duplicate title.",
    properties: {
      ids,
      scale: { type: "number", minimum: 0.1, maximum: 10 },
      anchor: { type: "string", enum: ["center", "top-left"] },
    },
    required: ["scale"],
  },
  {
    name: "board_align",
    command: "canvas.align",
    description:
      "Position the existing observed ids or selected title/group at the left, center or right of the actual visible board. Preserves the group's layout. Supply horizontal, vertical or both.",
    properties: {
      ids,
      horizontal: { type: "string", enum: ["left", "center", "right"] },
      vertical: { type: "string", enum: ["top", "center", "bottom"] },
    },
    required: [],
  },
  {
    name: "board_style",
    command: "canvas.style",
    description:
      "Change the selected existing objects and current pen. fontSize changes editable text; use board_resize to enlarge an existing title group containing handwriting strokes. Select actual ids first.",
    properties: {
      pen: {
        type: "string",
        enum: [
          "hard",
          "brush",
          "highlighter",
          "dashed",
          "rainbow",
          "text",
          "shape",
          "magic",
          "function",
          "calculation",
          "language",
        ],
      },
      fontSize: { type: "number", minimum: 8, maximum: 200 },
      color: { type: "string" },
      width: { type: "number", minimum: 1, maximum: 30 },
      opacity: { type: "number", minimum: 0, maximum: 100 },
    },
    required: [],
  },
  {
    name: "board_resource",
    command: "resources.generate",
    description:
      "Generate and open a real interactive teaching resource or animation, such as Newton's laws or F=ma. Include the user's complete goal. Uses the actual visible board or courseware as context; preparation runs in the background while conversation continues.",
    properties: { prompt: { type: "string" } },
    required: ["prompt"],
  },
  {
    name: "board_quiz",
    command: "quiz.generate",
    description:
      "Generate real question cards from the user's requested subject, count and types, optionally based on the visible board or courseware. Preparation runs in the background while conversation continues.",
    properties: { prompt: { type: "string" } },
    required: ["prompt"],
  },
  {
    name: "board_task",
    command: "agent.start",
    description:
      "Start an independent background agent immediately for work chosen from the live tool catalog. Role is an optional descriptive responsibility, not a capability restriction. Tasks can discover and invoke public operations, run concurrently, receive updates and return explicit narration while conversation continues. Returns running; use actual task results before claiming completion. Keep dependent steps in the same task.",
    properties: {
      prompt: { type: "string" },
      role: {
        type: "string",
        description:
          "Responsibility chosen for this task; descriptive metadata, not a capability restriction.",
      },
    },
    required: ["prompt"],
  },
  {
    name: "agent_narrate",
    command: "agent.say",
    description:
      "Submit only the short explanation that needs speaking, without waiting for playback. Continue visible board actions immediately. Never submit progress, completion or error announcements.",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  {
    name: "board_tasks",
    command: "agent.inspect",
    description:
      "Read real background task status, results and errors. Omit id to read all tasks.",
    properties: { id: { type: "string" } },
    required: [],
  },
  {
    name: "board_update_task",
    command: "agent.update",
    description:
      "Pass the user's latest correction or additional information to an observed running task id. Speech continues and completed board actions are preserved.",
    properties: { id: { type: "string" }, prompt: { type: "string" } },
    required: ["id", "prompt"],
  },
  {
    name: "board_cancel_task",
    command: "agent.cancel",
    description:
      "Cancel a specific background task when requested, preserving committed board work and the voice conversation.",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
];

type FunctionTool = {
  type: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/** Use the registered handler contract or an existing typed adapter, never infer
 * parameters from a tool name. Undeclared contracts retain their full docs. */
export const describeBoardTools = (
  options: {
    query?: string;
    names?: string[];
    offset?: number;
    limit?: number;
  },
  allowed: (name: string) => boolean,
) => {
  const terms = (options.query || "")
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const definitions = classroomCommands
    .definitions()
    .filter(
      (tool) =>
        allowed(tool.name) &&
        (!options.names?.length || options.names.includes(tool.name)) &&
        terms.every((term) =>
          `${tool.name} ${tool.description}`.toLocaleLowerCase().includes(term),
        ),
    );
  const offset = options.offset || 0;
  const limit = options.limit || 20;
  return {
    total: definitions.length,
    nextOffset: offset + limit < definitions.length ? offset + limit : null,
    tools: definitions.slice(offset, offset + limit).map((tool) => {
      const binding = bindings.find((entry) => entry.command === tool.name);
      return {
        ...tool,
        function: binding?.name || "board_command",
        parameters:
          tool.parameters ||
          (binding
            ? {
                type: "object",
                properties: binding.properties,
                required: binding.required,
                additionalProperties: false,
              }
            : undefined),
        invocation: binding
          ? { function: binding.name, arguments: "Use the parameters schema" }
          : {
              function: "board_command",
              arguments: {
                name: tool.name,
                args: "Use the registered description and parameter contract",
              },
            },
      };
    }),
  };
};

export const realtimeTools = (
  allowed: (name: string) => boolean = (name) =>
    !["agent.say", "agent.wait", "lesson.resume", "lesson.audio"].includes(
      name,
    ),
): FunctionTool[] => [
  ...bindings
    .filter(
      (tool) =>
        classroomCommands.isPublic(tool.command) && allowed(tool.command),
    )
    .map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: tool.properties,
        required: tool.required,
        additionalProperties: false,
      },
    })),
  {
    type: "function",
    name: "board_command",
    description:
      "Execute any actually registered public command using its documented args. Long lesson/resource/quiz preparation runs in a background task; inspect the returned task id for completion. Tools operate on the actual visible board.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          enum: classroomCommands
            .describe()
            .split("\n")
            .map((line) => line.split(":")[0])
            .filter((name) => name && name !== "ui.invoke" && allowed(name)),
        },
        args: { type: "object", additionalProperties: true },
      },
      required: ["name"],
    },
  },
];

export const realtimeCommand = (item: Record<string, unknown>): Command => {
  const fn = item.function as Record<string, unknown> | undefined;
  const name = item.name || fn?.name;
  const raw = item.arguments ?? fn?.arguments;
  const args = typeof raw === "string" ? JSON.parse(raw) : raw;
  const binding = bindings.find((tool) => tool.name === name);
  const command =
    name === "board_command"
      ? args
      : binding
      ? { name: binding.command, args }
      : undefined;
  if (
    !command ||
    typeof command.name !== "string" ||
    !classroomCommands.isPublic(command.name) ||
    command.name === "ui.invoke" ||
    (command.args !== undefined &&
      (!command.args ||
        typeof command.args !== "object" ||
        Array.isArray(command.args)))
  ) {
    throw new Error("Unavailable board command");
  }
  return command;
};
