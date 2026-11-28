import { classroomCommands } from "./commands";
import { isLessonInspection } from "./lessonTools";

import type { Command } from "./commands";

export const isBoardObservation = (command: Command) =>
  isLessonInspection(command) ||
  /\.(?:inspect|list|pages|snapshot|describe)$/.test(command.name) ||
  ["agent.tools", "document.ask"].includes(command.name) ||
  command.args?.action === "read";

const point = {
  type: "array",
  items: { type: "number" },
  minItems: 2,
  maxItems: 2,
};
const ids = { type: "array", items: { type: "string" }, minItems: 1 };
const bindings = [
  {
    name: "visual_document_question",
    command: "document.ask",
    description:
      "Use for a question or follow-up about the current document. This captures the current window and asks a vision model using its image and text. Read the answer aloud.",
    properties: { question: { type: "string" } },
    required: ["question"],
  },
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
      "Read visible objects, IDs, viewport, coordinates, selection and revision before operating. Generated handwriting strokes with the same writtenGroup form one text object for editing. For moving, aligning or resizing that writing, pass all observed IDs of the group.",
    properties: {},
    required: [],
  },
  {
    name: "board_write",
    command: "canvas.text",
    description:
      "Write or correct any editable text, including labels, paragraphs and titles. role=title only sets the initial heading size. Use placement=center and sourceIds=[] for centered writing. Pass an observed text ID or a stroke ID from a generated writtenGroup to correct content in place. Use the returned IDs for subsequent operations.",
    properties: {
      text: { type: "string" },
      id: { type: "string" },
      role: { type: "string", enum: ["title"] },
      presentation: { type: "string", enum: ["match", "handwritten", "text"] },
      placement: { type: "string", enum: ["center", "inline", "below"] },
      sourceIds: { type: "array", items: { type: "string" } },
    },
    required: ["text"],
  },
  {
    name: "board_draw",
    command: "canvas.ink",
    description:
      "Draw editable pen paths. Read board_inspect for bounds and coordinates. Explicit board coordinates use coordinateSpace=scene or omit it. Only select viewport for normalized positions with 0 at the left/top and 1000 at the right/bottom. One path can be strokes=[[400,300],[430,280],[460,300]]. Multiple paths use strokes=[[[400,300],[430,280]],[[450,290],[460,300]]]. Repeat the first point to close an outline. Use board_write for labels.",
    properties: {
      strokes: {
        anyOf: [
          { type: "array", items: point, minItems: 1 },
          {
            type: "array",
            items: { type: "array", items: point, minItems: 1 },
            minItems: 1,
          },
        ],
      },
      select: { type: "boolean" },
      coordinateSpace: { type: "string", enum: ["scene", "viewport"] },
      revision: {
        type: "integer",
        description:
          "Optional revision read from board_inspect. Omit if none was read.",
      },
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
    name: "board_erase",
    command: "canvas.erase",
    description:
      "Erase objects by their observed ids, the selection without arguments, or a polygon region such as [[400,280],[460,280],[460,320],[400,320]]. Inspect the board first. Explicit board coordinates use coordinateSpace=scene or omit it. Only use viewport for normalized 0–1000 coordinates. Keeps ink outside the polygon.",
    properties: {
      ids,
      region: { type: "array", minItems: 3, maxItems: 512, items: point },
      coordinateSpace: { type: "string", enum: ["scene", "viewport"] },
      revision: { type: "integer" },
    },
    required: [],
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
    name: "board_image",
    command: "image.generate",
    description:
      "Generate and insert an explicitly requested illustration. The voice dispatcher can return a running image task; verify its actual result before reporting that an image was inserted.",
    properties: {
      prompt: { type: "string" },
      transparent: { type: "boolean" },
    },
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
      sourceIds: { type: "array", items: { type: "string" } },
      command: {
        type: "object",
        description:
          "Optional single public operation; omit for autonomous multi-step planning.",
        properties: {
          name: { type: "string" },
          args: { type: "object", additionalProperties: true },
        },
        required: ["name", "args"],
        additionalProperties: false,
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
    !["agent.say", "agent.wait"].includes(name),
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
      "Execute a registered public command with its documented args. Dependent board and panel actions return in order. Independent generation can return a running task id. Inspect that task or the component state before reporting completion.",
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
