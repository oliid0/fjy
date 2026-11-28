import { agentContext, runBoardCommands } from "./agent";
import { chat, parseJSON, visualMessage } from "./ai";
import {
  classroomCommands,
  executeBoardCommand,
  verifyBoardCommandResult,
} from "./commands";
import { agentResponsesEndpoint, runResponsesAgent } from "./responsesAgent";
import { currentSettings, defaults, ARK_VISION_MODEL } from "./settings";
import { voiceBoardCommand } from "./boardAgents";
import {
  boardObservationAfterTools,
  boardObservationState,
  observeBoard,
} from "./boardObservation";

import type { BoardAgentAction } from "./agent";
import type { Message } from "./ai";
import type { Command } from "./commands";

/** ASR-only providers use the same model-directed tool registry as live speech. */
export const runVoiceAgent = async (
  text: string,
  history: Message[],
  signal: AbortSignal,
  taskSignal: AbortSignal = signal,
  onTextPreview?: (text: string) => void,
): Promise<string | undefined> => {
  const configured = currentSettings();
  const endpoint = agentResponsesEndpoint(configured.endpoint);
  const useVision = configured.speech !== "local" && !!configured.apiKey.trim();
  const revision = classroomCommands.revision;
  const current = () =>
    useVision ? classroomCommands.isCurrent(revision, signal) : !signal.aborted;
  const assertCurrent = () => {
    signal.throwIfAborted();
    if (!current()) {
      throw new DOMException("Voice surface changed", "AbortError");
    }
  };
  const visible = useVision ? await observeBoard(signal, current) : undefined;
  const initialState = useVision
    ? boardObservationState()
    : {
        canvas: classroomCommands.read("canvas"),
        tasks: classroomCommands.read("agents"),
      };
  const observeAfterTools = useVision
    ? boardObservationAfterTools(visible, signal, current)
    : undefined;
  const textModel = configured.textModel || configured.model;
  const visionModel =
    configured.ocrModel ||
    (endpoint &&
    new URL(endpoint).hostname === "ark.cn-beijing.volces.com" &&
    configured.model === defaults.model
      ? ARK_VISION_MODEL
      : configured.model);
  const settings = {
    ...configured,
    model: useVision ? visionModel : textModel,
  };
  const allowed = (name: string) =>
    !["agent.say", "agent.wait"].includes(name) &&
    (configured.speech === "local" || name !== "record.start");
  const dispatch = async (command: Command, owner?: AbortSignal) => {
    const routed = voiceBoardCommand(command);
    const result = await executeBoardCommand(
      routed,
      routed.name === "agent.start" ? taskSignal : owner,
    );
    return useVision ? verifyBoardCommandResult(routed, result) : result;
  };
  const messages: Message[] = [
    {
      role: "system",
      content: `You are a continuously conversational whiteboard assistant. Interpret the complete request, conversation and actual board in any language. Decide whether to answer, use tools or start independent background agents without a fixed keyword workflow. Keep talking while tasks run, and forward corrections with agent.update. Narrate only explicitly submitted content, never task status/errors. Follow actual results, never guess IDs or repeat completed operations. ${
        useVision
          ? "Use the current screenshot as evidence and scene data for IDs and coordinates. Observe again or explain what is missing if the view is absent or unreadable. Open files by actual name or use the real file picker and inspect the loaded page. Use canvas.text with presentation=handwritten for editable writing, canvas.ink for editable drawings, and image.generate for requested illustrations. Use record.open and let the user start the microphone. Delegate independent research or generation work. Execute dependent controls and edits in order. Never report a running task or a picker awaiting user input as complete. "
          : ""
      }${
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
    visualMessage(
      `${text}\n${agentContext({
        ...initialState,
        visible: visible
          ? { text: visible.text, name: visible.name, page: visible.page }
          : undefined,
      })}`,
      visible?.image,
    ),
  ];
  if (endpoint) {
    const result = await runResponsesAgent({
      endpoint,
      settings,
      messages,
      signal,
      current,
      allowed,
      observeAfterTools,
      verifyToolFailures: useVision,
      requireActions: false,
      onTextPreview: useVision ? onTextPreview : undefined,
      responseLanguage: "input",
      dispatch,
    });
    return result.summary;
  }
  const raw = await chat(messages, signal, settings, {
    maxTokens: 4096,
    responseLanguage: "input",
  });
  assertCurrent();
  let action: BoardAgentAction;
  try {
    action = parseJSON(raw) as BoardAgentAction;
  } catch {
    return raw;
  }
  if (action.action === "commands") {
    action = await runBoardCommands(action, messages, signal, current, {
      settings,
      observeAfterTools,
      verifyToolFailures: useVision,
      responseLanguage: "input",
      dispatch,
      verify: true,
      validate: (command) => allowed(command.name),
      completion:
        'Continue from real results; return {"action":"text","text":"narration"} when speech is needed, or {"action":"done"} when silent.',
    });
  }
  assertCurrent();
  return action.action === "text" && typeof action.text === "string"
    ? action.text
    : undefined;
};
