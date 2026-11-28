import { t } from "@fcboard/fcboard/i18n";

import { chat, parseJSON, visualMessage } from "./ai";
import { agentContext, runBoardCommands } from "./agent";
import {
  classroomCommands,
  executeBoardCommand,
  verifyBoardCommandResult,
} from "./commands";
import { currentSettings, defaults, ARK_VISION_MODEL } from "./settings";
import { agentResponsesEndpoint, runResponsesAgent } from "./responsesAgent";
import { describeBoardTools } from "./realtimeTools";
import {
  boardObservationAfterTools,
  boardViewContext,
  observeBoard,
} from "./boardObservation";

import type { Message } from "./ai";
import type { BoardAgentAction } from "./agent";
import type { BoardView } from "./boardObservation";
import type { Command } from "./commands";

export type BoardTask = {
  id: string;
  prompt: string;
  role: string;
  command?: string;
  sourceIds?: string[];
  state: "running" | "completed" | "failed" | "cancelled";
  startedAt: number;
  finishedAt?: number;
  result?: unknown;
  error?: string;
  speech?: { sequence: number; text: string };
};

export const boardAgentRole = (name: string) => name.split(".")[0] || "board";

const workerCommand = (name: string) =>
  !/^voice\./.test(name) &&
  !/^lesson\./.test(name) &&
  name !== "ui.invoke" &&
  (name !== "record.start" || currentSettings().speech === "local");

/** Defer slow independent work while executing dependent UI and scene operations in order. */
export const voiceBoardCommand = (
  command: Command,
  cloud = currentSettings().speech !== "local",
): Command => {
  if (currentSettings().speech === "cloud" && command.name === "record.start") {
    return { name: "record.open" };
  }
  if (
    cloud &&
    ["document.next", "document.previous"].includes(command.name) &&
    !classroomCommands.has(command.name) &&
    classroomCommands.isPublic("board.step")
  ) {
    return {
      name: "board.step",
      args: {
        direction: command.name === "document.next" ? "next" : "previous",
      },
    };
  }
  const background = cloud
    ? /^research\.search$|\.generate$/.test(command.name)
    : !/^(?:agent|voice)\./.test(command.name) &&
      !/\.(?:inspect|list|snapshot|evaluate|describe)$/.test(command.name);
  if (!classroomCommands.isPublic("agent.start") || !background) {
    return command;
  }
  return {
    name: "agent.start",
    args: {
      prompt: String(command.args?.prompt || command.name),
      role: boardAgentRole(command.name),
      command: { ...command, args: command.args || {} },
    },
  };
};

/** Each task owns its inference and cancellation; no shared assistant request or FIFO. */
export const registerBoardAgents = () => {
  const tasks = new Map<
    string,
    {
      task: BoardTask;
      request: AbortController;
      release: () => void;
      updates: string[];
    }
  >();
  const boards = new Set<string>();
  const rememberBoard = () => {
    const active = (
      classroomCommands.read("boards") as { active?: string } | undefined
    )?.active;
    if (active) {
      boards.add(active);
    }
  };
  const snapshot = () =>
    Array.from(tasks.values(), ({ task }) => ({ ...task, result: undefined }));
  const changed = () => classroomCommands.changed("agents");
  const invalid = () =>
    new Error(t("fcboard.invalid_ai_command_please_try_again"));
  const run = async (
    task: BoardTask,
    command: Command | undefined,
    signal: AbortSignal,
    updates: () => string[],
  ) => {
    const results: {
      name: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    }[] = [];
    const configured = currentSettings();
    const verifyToolFailures = configured.speech !== "local";
    const dispatch = async (operation: Command, owner?: AbortSignal) => {
      try {
        const result = await executeBoardCommand(operation, owner);
        if (verifyToolFailures) {
          verifyBoardCommandResult(operation, result);
        }
        results.push({ name: operation.name, ok: true, result });
        return result;
      } catch (failure) {
        if (!owner?.aborted) {
          console.error("[board-agent-tool]", task.id, operation.name, failure);
        }
        results.push({
          name: operation.name,
          ok: false,
          error: failure instanceof Error ? failure.message : String(failure),
        });
        throw failure;
      }
    };
    let amendments: string[] = [];
    if (command) {
      let result: unknown;
      let failure: unknown;
      try {
        result = await dispatch(command, signal);
      } catch (error) {
        failure = error;
      }
      signal.throwIfAborted();
      amendments = updates();
      if (!amendments.length) {
        if (!results[0].ok) {
          throw failure;
        }
        return result;
      }
    }
    const settings = {
      ...configured,
      model: configured.textModel || configured.model,
    };
    const endpoint = agentResponsesEndpoint(settings.endpoint);
    const revision = classroomCommands.revision;
    const current = () => classroomCommands.isCurrent(revision, signal);
    const useVision = configured.speech !== "local" && !!configured.apiKey;
    const snapshot: Command = {
      name: "canvas.snapshot",
      args: {
        sourceIds: task.sourceIds,
        capture: true,
        screen: useVision && !task.sourceIds?.length,
      },
    };
    const visible = useVision
      ? await observeBoard(signal, current, snapshot.args)
      : classroomCommands.has(snapshot.name)
      ? ((await executeBoardCommand(snapshot, signal)) as BoardView)
      : undefined;
    const observeAfterTools = useVision
      ? boardObservationAfterTools(visible, signal, current)
      : undefined;
    if (useVision && (visible?.image || configured.speech === "cloud")) {
      settings.model =
        configured.ocrModel ||
        (endpoint &&
        new URL(endpoint).hostname === "ark.cn-beijing.volces.com" &&
        configured.model === defaults.model
          ? ARK_VISION_MODEL
          : configured.model);
    }
    const permitted = workerCommand;
    const messages: Message[] = [
      {
        role: "system",
        content: `You are an independent whiteboard task agent. Plan and execute from the complete goal, conversation, actual canvas and current tools. Inspect the current screenshot for visual evidence, canvas.inspect for exact editable coordinates, and ui.inspect for live controls. Write words with canvas.text presentation=handwritten. Draw non-text diagrams as editable canvas.ink strokes using coordinates within the inspected viewport. Use image.generate when the user wants an inserted illustration. Keep navigation and dependent actions in order. Delegate independent research, visuals, or quiz generation to separate agents with distinct goals and use agent.update for corrections. Call agent.say only for content the user should hear; it returns immediately so board work can continue. Use identical text for simultaneous writing/narration. Task status, success and failures remain internal data, without narration or progress panels. Verify actual results, never guess IDs or repeat successful operations. Do not manage voice sessions or obsolete lesson playback. ${
          endpoint
            ? " Use the supplied real function tools."
            : ' Return JSON {"action":"commands","commands":[{"name":"registered command","args":{}}]} or {"action":"done"} when complete.'
        }\nRole: ${task.role}\n${classroomCommands
          .describe()
          .split("\n")
          .filter((line) => permitted(line.split(":")[0]))
          .join("\n")}`,
      },
      visualMessage(
        agentContext({
          prompt: task.prompt,
          sourceIds: task.sourceIds,
          canvas: classroomCommands.read("canvas"),
          visible: boardViewContext(visible),
          conversation: classroomCommands.read("conversation"),
          tasks: classroomCommands.read("agents"),
          results: results.length ? results : undefined,
        }),
        visible?.image,
      ),
    ];
    if (amendments.length) {
      messages.push({ role: "user", content: amendments.join("\n") });
    }
    if (endpoint) {
      const result = await runResponsesAgent({
        endpoint,
        messages,
        settings,
        signal,
        current,
        allowed: permitted,
        updates,
        dispatch,
        requireActions: command ? false : undefined,
        verifyToolFailures,
        observeAfterTools,
      });
      return { ...result, results };
    }
    const action = parseJSON(
      await chat(messages, signal, settings, { maxTokens: 4096 }),
    ) as BoardAgentAction;
    signal.throwIfAborted();
    if (!current()) {
      throw new DOMException("Task surface changed", "AbortError");
    }
    if (!action || typeof action !== "object") {
      throw invalid();
    }
    const result = await runBoardCommands(action, messages, signal, current, {
      validate: (command) => permitted(command.name),
      settings,
      verify: true,
      verifyToolFailures,
      observeAfterTools,
      maxTokens: 4096,
      maxRounds: 12,
      updates,
      dispatch,
      context: () => ({ canvas: classroomCommands.read("canvas") }),
    });
    signal.throwIfAborted();
    if (!current() || result.action !== "done" || !results.length) {
      throw invalid();
    }
    return { canvas: classroomCommands.read("canvas"), results };
  };
  const registrations = [
    classroomCommands.register(
      "research.search",
      "Research args.prompt using the configured AI model and its actual provider web search. Returns verified answer/source links as task data; never automatically speaks or changes the board.",
      async (args) => {
        if (
          typeof args.prompt !== "string" ||
          !args.prompt.trim() ||
          args.prompt.length > 10000
        ) {
          throw invalid();
        }
        const signal =
          args.signal instanceof AbortSignal
            ? args.signal
            : new AbortController().signal;
        const configured = currentSettings();
        const settings = {
          ...configured,
          model: configured.textModel || configured.model,
        };
        const answer = await chat(
          [
            {
              role: "system",
              content:
                "Research the complete goal using real web search. Prefer primary sources; return findings and actual source URLs, distinguishing facts, reasoning and uncertainty. Do not operate the board or voice.",
            },
            { role: "user", content: args.prompt },
          ],
          signal,
          {
            ...settings,
            endpoint:
              agentResponsesEndpoint(settings.endpoint) || settings.endpoint,
          },
          { webSearch: true, maxTokens: 2048 },
        );
        signal.throwIfAborted();
        return { answer };
      },
      {
        parameters: {
          type: "object",
          properties: { prompt: { type: "string" } },
          required: ["prompt"],
          additionalProperties: false,
        },
        returns:
          "{answer:string} including actual source links when returned by the provider",
      },
    ),
    classroomCommands.register(
      "agent.tools",
      "Inspect real tool purposes, parameters/required fields, return contracts and invocation. args.query searches names/descriptions; args.names selects exact names; offset/limit paginate. Discover unfamiliar actions first; use ui.inspect for real UI control IDs.",
      (args) => {
        if (
          (args.query !== undefined && typeof args.query !== "string") ||
          (args.names !== undefined &&
            (!Array.isArray(args.names) ||
              !args.names.every((name) => typeof name === "string"))) ||
          (args.offset !== undefined &&
            (!Number.isInteger(args.offset) || Number(args.offset) < 0)) ||
          (args.limit !== undefined &&
            (!Number.isInteger(args.limit) ||
              Number(args.limit) < 1 ||
              Number(args.limit) > 50))
        ) {
          throw invalid();
        }
        const worker = Array.from(tasks.values()).some(
          ({ task, request }) =>
            task.state === "running" &&
            args.signal instanceof AbortSignal &&
            classroomCommands.isOwnedBy(args.signal, request.signal),
        );
        return describeBoardTools(
          args as {
            query?: string;
            names?: string[];
            offset?: number;
            limit?: number;
          },
          worker
            ? workerCommand
            : (name) => !["agent.say", "agent.wait"].includes(name),
        );
      },
    ),
    classroomCommands.register(
      "agent.say",
      "Only a running child task may submit actual narration in args.text. Return immediately and continue board work; never narrate status or errors.",
      (args) => {
        const entry = Array.from(tasks.values()).find(
          ({ task, request }) =>
            task.state === "running" &&
            args.signal instanceof AbortSignal &&
            classroomCommands.isOwnedBy(args.signal, request.signal),
        );
        if (
          !entry ||
          typeof args.text !== "string" ||
          !args.text.trim() ||
          args.text.length > 2000
        ) {
          throw invalid();
        }
        entry.request.signal.throwIfAborted();
        entry.task.speech = {
          sequence: (entry.task.speech?.sequence || 0) + 1,
          text: args.text.trim(),
        };
        changed();
        return { queued: true };
      },
    ),
    classroomCommands.register(
      "agent.start",
      "Start an independent task and return its actual id/state immediately. args.prompt contains the complete goal; optional role describes the model-chosen responsibility and never limits tools. Optional command executes an actually public command in the background. Tasks support inspect/update/wait/cancel; speech stays independent.",
      (args) => {
        if (
          typeof args.prompt !== "string" ||
          !args.prompt.trim() ||
          args.prompt.length > 10000
        ) {
          throw invalid();
        }
        const role = args.role ?? "board";
        if (typeof role !== "string" || !role.trim() || role.length > 80) {
          throw invalid();
        }
        if (
          args.sourceIds !== undefined &&
          (!Array.isArray(args.sourceIds) ||
            !args.sourceIds.every((id) => typeof id === "string"))
        ) {
          throw invalid();
        }
        const command = args.command as Command | undefined;
        if (
          command !== undefined &&
          (!command ||
            !workerCommand(command.name) ||
            command.name === "agent.say" ||
            !classroomCommands.isPublic(command.name) ||
            !command.args ||
            typeof command.args !== "object" ||
            Array.isArray(command.args))
        ) {
          throw invalid();
        }
        if (
          Array.from(tasks.values()).filter(
            ({ task }) => task.state === "running",
          ).length >= 6
        ) {
          throw new Error(
            t(
              "fcboard.action_limit_reached_completed_work_is_preserved_describe_the_next_step_to_continue",
            ),
          );
        }
        const request = new AbortController();
        const parent =
          args.signal instanceof AbortSignal ? args.signal : undefined;
        parent?.throwIfAborted();
        const cancel = () => request.abort();
        parent?.addEventListener("abort", cancel, { once: true });
        const release = classroomCommands.registerOwner(request.signal, parent);
        const task: BoardTask = {
          id: crypto.randomUUID(),
          prompt: args.prompt.trim(),
          role: role as BoardTask["role"],
          command: command?.name,
          sourceIds: (args.sourceIds ??
            (
              classroomCommands.read("canvas") as
                | { selection?: string[] }
                | undefined
            )?.selection) as string[] | undefined,
          state: "running",
          startedAt: Date.now(),
        };
        rememberBoard();
        tasks.set(task.id, {
          task,
          request,
          updates: [],
          release: () => {
            parent?.removeEventListener("abort", cancel);
            release();
          },
        });
        // Keep bounded completed history; never evict an active task.
        for (const [id, value] of tasks) {
          if (tasks.size <= 30) {
            break;
          }
          if (value.task.state !== "running") {
            value.release();
            tasks.delete(id);
          }
        }
        changed();
        const updates = () => tasks.get(task.id)?.updates.splice(0) || [];
        void run(task, command, request.signal, updates)
          .then(
            (result) => {
              if (!request.signal.aborted) {
                task.state = "completed";
                task.result = result ?? null;
              }
            },
            (failure) => {
              task.state =
                request.signal.aborted || failure?.name === "AbortError"
                  ? "cancelled"
                  : "failed";
              task.error =
                failure instanceof Error ? failure.message : String(failure);
              if (task.state === "failed") {
                console.error("[board-agent]", task.id, task.role, task.error);
              }
            },
          )
          .finally(() => {
            if (request.signal.aborted) {
              task.state = "cancelled";
            }
            task.finishedAt = Date.now();
            changed();
          });
        return { ...task };
      },
    ),
    classroomCommands.register(
      "agent.update",
      "Deliver supplemental/corrected args.prompt to the running task identified by args.id; keep voice active and never repeat completed operations.",
      (args) => {
        const entry = tasks.get(String(args.id));
        if (
          !entry ||
          entry.task.state !== "running" ||
          typeof args.prompt !== "string" ||
          !args.prompt.trim() ||
          args.prompt.length > 10000 ||
          entry.updates.length >= 20
        ) {
          throw invalid();
        }
        entry.updates.push(args.prompt.trim());
        return { id: entry.task.id, state: entry.task.state };
      },
    ),
    classroomCommands.register(
      "agent.inspect",
      "Read actual background task state/errors. Omit args.id for all summaries, or use a real ID for complete results. running means in progress, never completed.",
      (args) => {
        if (args.id === undefined) {
          return snapshot();
        }
        const entry = tasks.get(String(args.id));
        if (!entry) {
          throw invalid();
        }
        return { ...entry.task };
      },
    ),
    classroomCommands.register(
      "agent.wait",
      "Wait for the real terminal state of args.id; return the complete task/result on success and report failure/cancellation. Cancelling this wait does not cancel the task; never block live conversation on unrelated long tasks.",
      (args) => {
        const id = String(args.id);
        if (!tasks.has(id)) {
          throw invalid();
        }
        const signal =
          args.signal instanceof AbortSignal ? args.signal : undefined;
        signal?.throwIfAborted();
        return new Promise<BoardTask>((resolve, reject) => {
          const cleanup = () => {
            unwatch();
            signal?.removeEventListener("abort", abort);
          };
          const abort = () => {
            cleanup();
            reject(new DOMException("Task wait cancelled", "AbortError"));
          };
          const check = () => {
            if (signal?.aborted) {
              abort();
              return;
            }
            const entry = tasks.get(id);
            if (!entry) {
              cleanup();
              reject(invalid());
              return;
            }
            const { task } = entry;
            if (task.state === "running") {
              return;
            }
            cleanup();
            if (task.state === "completed") {
              resolve({ ...task });
            } else if (task.state === "cancelled") {
              reject(
                new DOMException(task.error || "Task cancelled", "AbortError"),
              );
            } else {
              reject(new Error(task.error || t("fcboard.ai_action_failed")));
            }
          };
          const unwatch = classroomCommands.watch("agents", check);
          signal?.addEventListener("abort", abort, { once: true });
          check();
        });
      },
    ),
    classroomCommands.register(
      "agent.cancel",
      "Cancel the background task identified by args.id, preserving completed board work and the voice session.",
      (args) => {
        const entry = tasks.get(String(args.id));
        if (!entry) {
          throw invalid();
        }
        if (entry.task.state === "running") {
          entry.request.abort();
          entry.task.state = "cancelled";
          changed();
        }
        return { ...entry.task };
      },
    ),
    classroomCommands.context("agents", snapshot),
    classroomCommands.context("classroom.scope", () => ({
      boards: [...boards],
    })),
    classroomCommands.watch("boards", () => {
      if (
        [...tasks.values()].some(
          ({ task }) =>
            task.state === "running" && task.command !== "resources.prepare",
        )
      ) {
        rememberBoard();
      }
    }),
    classroomCommands.onInvalidate((source) => {
      for (const { task, request } of tasks.values()) {
        // Preparation only saves an asset; it cannot insert into a stale page.
        // Its owner still cancels it when the session or explicit task stops.
        if (task.command === "resources.prepare") {
          continue;
        }
        if (
          !(
            classroomCommands.isOwnedBy(source, request.signal) &&
            classroomCommands.isExpectedTransition(source)
          )
        ) {
          request.abort();
          if (task.state === "running") {
            task.state = "cancelled";
          }
        }
      }
      changed();
    }),
  ];
  return () => {
    tasks.forEach(({ task, request, release }) => {
      request.abort();
      if (task.state === "running") {
        task.state = "cancelled";
        task.finishedAt = Date.now();
      }
      release();
    });
    changed();
    registrations.forEach((release) => release());
  };
};
