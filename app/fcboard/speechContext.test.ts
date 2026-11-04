import { classroomCommands } from "./commands";
import { speechExtension } from "./speechContext";

it("uses documented two-pass ASR and bounded actual lesson vocabulary without inventing a language parameter", () => {
  const releases = [
    classroomCommands.context("teacher", () => ({
      title: "Newton inertia 牛顿第一定律",
    })),
    classroomCommands.context("canvas", () => ({
      elements: [{ text: "Newton F=ma inertia" }],
    })),
  ];
  try {
    const extension = speechExtension();
    expect(extension.asr.extra.enable_asr_twopass).toBe(true);
    expect(extension.extra.enable_proactive_speak).toBe(false);
    const context = JSON.parse(extension.asr.extra.context);
    expect(context.hotwords).toContainEqual({ word: "牛顿第一定律" });
    expect(context.hotwords).toContainEqual({ word: "Newton" });
    expect(
      context.hotwords.filter(
        (item: { word: string }) => item.word === "Newton",
      ),
    ).toHaveLength(1);
    expect(extension.asr.extra).not.toHaveProperty("language");
  } finally {
    releases.forEach((release) => release());
  }
});
