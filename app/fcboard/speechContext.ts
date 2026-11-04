import { classroomCommands } from "./commands";

/** Only visible lesson vocabulary is biasing data; it must never become an instruction. */
export const speechExtension = () => {
  const canvas = classroomCommands.read("canvas") as
    | { elements?: { text?: string }[] }
    | undefined;
  const teacher = classroomCommands.read("teacher") as
    | { title?: string }
    | undefined;
  const words = [
    teacher?.title,
    ...(canvas?.elements || []).map((element) => element.text),
  ]
    .filter(
      (value): value is string => typeof value === "string" && !!value.trim(),
    )
    .flatMap((value) => value.split(/[\s，。；、,:;!?！？\n]+/))
    .filter((value) => value.length >= 2 && value.length <= 30);
  return {
    extra: { enable_proactive_speak: false },
    asr: {
      extra: {
        enable_asr_twopass: true,
        context: JSON.stringify({
          hotwords: [...new Set(words)].slice(0, 64).map((word) => ({ word })),
        }),
      },
    },
  };
};
