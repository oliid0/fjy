import { act, screen, waitFor } from "@testing-library/react";
import { t } from "@fcboard/fcboard/i18n";

import { classroomCommands } from "../commands";

/** Write through the real visible-surface command; the question border owns no ink layer. */
export const writeQuestion = async () => {
  const frame = await screen.findByRole("dialog", {
    name: t("fcboard.handwritten_question"),
  });
  await waitFor(() => expect(frame.style.width).not.toBe(""));
  const document = classroomCommands.read("document") as
    | { viewport: { left: number; top: number; scroll: number } }
    | undefined;
  const layout = classroomCommands.read("document.layout") as
    | { scale: number }
    | undefined;
  const scale = layout?.scale || 1;
  const left =
    (parseFloat(frame.style.left) - (document?.viewport.left || 0)) / scale;
  const top =
    (parseFloat(frame.style.top) - (document?.viewport.top || 0)) / scale +
    (document?.viewport.scroll || 0);
  let result: unknown;
  await act(async () => {
    result = await classroomCommands.execute({
      name: "canvas.ink",
      args: {
        strokes: [
          [
            [left + 20, top + 20],
            [left + 25, top + 25],
            [left + 30, top + 35],
            [left + 40, top + 45],
            [left + 50, top + 50],
          ],
        ],
        select: false,
      },
    });
  });
  return result as { ids: string[] };
};
