import { agentContext, runBoardCommands } from "./agent";
import { chat, parseJSON } from "./ai";
import { classroomCommands, executeBoardCommand } from "./commands";
import { agentResponsesEndpoint, runResponsesAgent } from "./responsesAgent";
import { currentSettings } from "./settings";
import { voiceBoardCommand } from "./boardAgents";

import type { BoardAgentAction } from "./agent";
import type { Message } from "./ai";

/** ASR-only providers use the same model-directed tool registry as live speech. */
export const runVoiceAgent = async (
  text: string,
  history: Message[],
  signal: AbortSignal,
  taskSignal: AbortSignal = signal,
): Promise<string | undefined> => {
  const configured = currentSettings();
  const settings = {
    ...configured,
    model: configured.textModel || configured.model,
  };
  const endpoint = agentResponsesEndpoint(settings.endpoint);
  const allowed = (name: string) => !["agent.say", "agent.wait"].includes(name);
  const dispatch = (
    command: import("./commands").Command,
    owner?: AbortSignal,
  ) => {
    const routed = voiceBoardCommand(command);
    return executeBoardCommand(
      routed,
      routed.name === "agent.start" ? taskSignal : owner,
    );
  };
  const messages: Message[] = [
    {
      role: "system",
      content: `You are a continuously conversational whiteboard assistant. Interpret the complete request, conversation and actual board in any language. Decide whether to answer, use tools or start independent background agents without a fixed keyword workflow. Keep talking while tasks run, and forward corrections with agent.update. Narrate only explicitly submitted content, never task status/errors. Follow real results, never guess IDs or repeat completed operations. ${
        endpoint
          ? "Use the supplied tools; ordinary conversation may be answered directly without changing the board."
          : 'Return {"action":"text","text":"answer"} for a direct answer, {"action":"commands","commands":[{"name":"registered command","args":{}}]} for operations, or {"action":"done"} when complete with nothing to say.'
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
      responseLanguage: "input",
      dispatch,
    });
    return result.summary;
  }
  const raw = await chat(messages, signal, settings, {
    maxTokens: 4096,
    responseLanguage: "input",
  });
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
        responseLanguage: "input",
        dispatch,
        verify: true,
        validate: (command) => allowed(command.name),
        completion:
          'Continue from real results; return {"action":"text","text":"narration"} when speech is needed, or {"action":"done"} when silent.',
      },
    );
  }
  signal.throwIfAborted();
  return action.action === "text" && typeof action.text === "string"
    ? action.text
    : undefined;
};
