import { fireEvent, screen } from "@testing-library/react";
import { t } from "@excalidraw/excalidraw/i18n";

/** Exercise real pointer sampling instead of filling an obsolete text input. */
export const questionFrame = () => {
  const svg = screen.getByRole("img", {
    name: t("fcboard.ask_the_ai_teacher"),
  });
  Object.defineProperties(svg, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
    x: 500,
    y: 300,
    left: 500,
    top: 300,
    right: 1100,
    bottom: 444,
    width: 600,
    height: 144,
    toJSON: () => ({}),
  });
  const pointer = (
    type: string,
    x: number,
    y: number,
    extra: Record<string, unknown> = {},
  ) =>
    fireEvent(
      svg,
      Object.assign(new Event(type, { bubbles: true }), {
        pointerId: 1,
        pointerType: "pen",
        isPrimary: true,
        button: 0,
        clientX: x,
        clientY: y,
        ...extra,
      }),
    );
  return { svg, pointer };
};

export const writeQuestion = () => {
  const { svg, pointer } = questionFrame();
  pointer("pointerdown", 520, 320);
  pointer("pointermove", 540, 345, {
    getCoalescedEvents: () => [
      { clientX: 525, clientY: 325 },
      { clientX: 530, clientY: 335 },
    ],
  });
  pointer("pointerup", 550, 350);
  return { svg, pointer };
};
