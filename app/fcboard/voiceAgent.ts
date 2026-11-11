import { agentContext, runBoardCommands } from "./agent";
import { chat, parseJSON } from "./ai";
import { classroomCommands } from "./commands";
import { agentResponsesEndpoint, runResponsesAgent } from "./responsesAgent";
import { currentSettings } from "./settings";

import type { BoardAgentAction } from "./agent";
import type { Message } from "./ai";

/** ASR-only providers use the same model-directed tool registry as live speech. */
export const runVoiceAgent = async (
  text: string,
  history: Message[],
  signal: AbortSignal,
): Promise<string | undefined> => {
  const configured = currentSettings();
  const settings = {
    ...configured,
    model: configured.textModel || configured.model,
  };
  const endpoint = agentResponsesEndpoint(settings.endpoint);
  const allowed = (name: string) =>
    !["agent.say", "agent.wait", "lesson.audio", "lesson.resume"].includes(
      name,
    );
  const messages: Message[] = [
    {
      role: "system",
      content: `你是持续对话的白板助教。理解完整语义、对话和真实白板，自主决定直接回答、调用工具或启动并行后台agent；没有固定关键词流程。后台任务执行时继续对话，新的补充可用agent.update传给对应任务。仅任务提供明确朗读正文时才朗读，不播报任务状态或错误。根据真实结果继续，不猜测对象id，不重复已完成操作。${
        endpoint
          ? "使用提供的工具；可以直接自然回答而不操作白板。"
          : '直接回答返回{"action":"text","text":"回答"}；操作返回{"action":"commands","commands":[{"name":"实际命令","args":{}}]}；完成且无需说话返回{"action":"done"}。'
      }\n${classroomCommands
        .describe()
        .split("\n")
        .filter((line) => allowed(line.split(":")[0]))
        .join("\n")}`,
    },
    ...history,
    {
      role: "user",
      content: `${text}\n${agentContext({
        canvas: classroomCommands.read("canvas"),
        tasks: classroomCommands.read("agents"),
      })}`,
    },
  ];
  if (endpoint) {
    const result = await runResponsesAgent({
      endpoint,
      settings,
      messages,
      signal,
      current: () => !signal.aborted,
      allowed,
      requireActions: false,
    });
    return result.summary;
  }
  const raw = await chat(messages, signal, settings, { maxTokens: 4096 });
  signal.throwIfAborted();
  let action: BoardAgentAction;
  try {
    action = parseJSON(raw) as BoardAgentAction;
  } catch {
    return raw;
  }
  if (action.action === "commands") {
    action = await runBoardCommands(
      action,
      messages,
      signal,
      () => !signal.aborted,
      {
        settings,
        verify: true,
        validate: (command) => allowed(command.name),
        completion:
          '根据真实结果继续；需要说话返回{"action":"text","text":"正文"}，无需说话返回{"action":"done"}。',
      },
    );
  }
  signal.throwIfAborted();
  return action.action === "text" && typeof action.text === "string"
    ? action.text
    : undefined;
};
