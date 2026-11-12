import { t } from "@fcboard/fcboard/i18n";

import { chat, parseJSON, visualMessage } from "./ai";
import { agentContext, runBoardCommands } from "./agent";
import { classroomCommands, executeBoardCommand } from "./commands";
import { currentSettings } from "./settings";
import { agentResponsesEndpoint, runResponsesAgent } from "./responsesAgent";
import { describeBoardTools } from "./realtimeTools";

import type { Message } from "./ai";
import type { BoardAgentAction } from "./agent";
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
  !/^voice\./.test(name) && !/^lesson\./.test(name) && name !== "ui.invoke";

/** Both voice providers acknowledge visible work without waiting for model/tool completion. */
export const voiceBoardCommand = (command: Command): Command => {
  if (
    !classroomCommands.isPublic("agent.start") ||
    /^(?:agent|voice)\./.test(command.name) ||
    /\.(?:inspect|list|snapshot|evaluate|describe)$/.test(command.name)
  ) {
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
    if (command) {
      return executeBoardCommand(command, signal);
    }
    const configured = currentSettings();
    const settings = {
      ...configured,
      model: configured.textModel || configured.model,
    };
    const endpoint = agentResponsesEndpoint(settings.endpoint);
    const revision = classroomCommands.revision;
    const current = () => classroomCommands.isCurrent(revision, signal);
    const visible = classroomCommands.has("canvas.snapshot")
      ? ((await executeBoardCommand(
          {
            name: "canvas.snapshot",
            args: {
              sourceIds: task.sourceIds,
              capture: !task.sourceIds?.length || configured.selectionImages,
            },
          },
          signal,
        )) as {
          text?: string;
          image?: string;
          name?: string;
          page?: number;
        })
      : undefined;
    const permitted = workerCommand;
    const messages: Message[] = [
      {
        role: "system",
        content: `你是独立白板任务agent。根据完整目标、已有对话、真实画布和动态工具自主规划与执行；角色只用于分工，不限制可用工具，不按关键词或固定示例套流程。可按依赖关系执行步骤或通过agent.start并发安排独立任务，用agent.update传递后续更正。只有需要用户听到的正文才调用agent.say，它立即返回，继续白板操作；需要边写边说时，写入和朗读采用相同正文。任务进度、成功、失败仅为内部数据，不朗读，不另开进度面板。根据真实结果继续，不猜测对象id、不重放成功动作；操作语音会话和旧课程播放器不属于后台任务。${
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
          visible: visible
            ? { text: visible.text, name: visible.name, page: visible.page }
            : undefined,
          conversation: classroomCommands.read("conversation"),
          tasks: classroomCommands.read("agents"),
        }),
        visible?.image,
      ),
    ];
    if (endpoint) {
      return runResponsesAgent({
        endpoint,
        messages,
        settings,
        signal,
        current,
        allowed: permitted,
        updates,
      });
    }
    const action = parseJSON(
      await chat(messages, signal, settings, { maxTokens: 4096 }),
    ) as BoardAgentAction;
    signal.throwIfAborted();
    if (!current()) {
      throw new DOMException("Task surface changed", "AbortError");
    }
    if (action?.action !== "commands") {
      throw invalid();
    }
    const result = await runBoardCommands(action, messages, signal, current, {
      validate: (command) => permitted(command.name),
      settings,
      verify: true,
      maxTokens: 4096,
      updates,
      context: () => ({ canvas: classroomCommands.read("canvas") }),
    });
    signal.throwIfAborted();
    if (!current() || result.action !== "done") {
      throw invalid();
    }
    return { canvas: classroomCommands.read("canvas") };
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
                "根据完整目标联网核实资料，优先一手来源，返回结论和真实来源链接，区分事实、推导与不确定内容；不执行白板和语音操作。",
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
      "查询当前真实工具用途、参数/必填项、返回约定与调用方式；args.query可搜索名字或说明，args.names精确查询，offset/limit分页。陌生操作先查询，界面控件再用ui.inspect获取当前真实id。",
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
      "仅供正在运行的子任务提交需要朗读的正文；args.text为短段讲解。立即返回，白板操作继续，不播报状态或错误。",
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
          sourceIds: args.sourceIds as string[] | undefined,
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
      "向args.id指定的运行中agent传递args.prompt补充或更正，不中断实时语音，不重放已完成操作。",
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
      "读取后台任务真实状态/错误；省略args.id读取全部摘要，指定真实id读取该任务完整结果。running仅表示执行中，不能称已完成。",
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
      "等待args.id指定后台任务的真实终态；完成返回完整任务及result，失败/取消明确报错。取消等待不会取消原任务；不要在实时对话中等待无关长任务。",
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
      "取消args.id指定的后台任务，保留已完成的板书；不关闭语音会话。",
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
