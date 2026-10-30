import {
  act,
  fireEvent,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { t } from "@fcboard/fcboard/i18n";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { render } from "./test/render";
import { RandomNumber } from "./RandomNumber";
import { TeachingResources, teachingResources } from "./TeachingResources";
import { classroomCommands } from "./commands";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("changes the original integer wheel by direct touch drag and never turns it into a text input", () => {
  render(<RandomNumber onClose={vi.fn()} />);
  const wheel = screen.getByRole("spinbutton", {
    name: t("fcboard.randomNumber.minimum"),
  });
  vi.spyOn(wheel, "setPointerCapture").mockImplementation(() => {});
  Object.defineProperty(wheel, "releasePointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  const pointer = (type: string, y: number) =>
    fireEvent(
      wheel,
      Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
        pointerId: 1,
        pointerType: "touch",
        clientY: y,
        button: 0,
      }),
    );
  pointer("pointerdown", 60);
  pointer("pointermove", -20);
  pointer("pointerup", -20);
  expect(wheel).toHaveAttribute("aria-valuenow", "3");
  expect(wheel).toHaveFocus();
  expect(screen.queryByRole("textbox")).toBeNull();
  pointer("pointerdown", 20);
  pointer("pointerup", 20);
  expect(wheel).toHaveAttribute("aria-valuenow", "2");
});

it("selects 1–8 numbers, allows equal endpoints and duplicates, preserves results on range errors and draws again", () => {
  render(<RandomNumber onClose={vi.fn()} />);
  expect(screen.queryByRole("textbox")).toBeNull();
  const minimum = screen.getByRole("spinbutton", {
    name: t("fcboard.randomNumber.minimum"),
  });
  const maximum = screen.getByRole("spinbutton", {
    name: t("fcboard.randomNumber.maximum"),
  });
  const result = screen.getByRole("status", {
    name: t("fcboard.randomNumber.result"),
  });
  const start = screen.getByRole("button", {
    name: t("fcboard.randomNumber.start"),
  });
  fireEvent.click(screen.getByRole("button", { name: "8" }));
  const random = vi.spyOn(Math, "random").mockReturnValue(0);
  fireEvent.click(start);
  expect(result.children).toHaveLength(8);
  expect(Array.from(result.children, (node) => node.textContent)).toEqual(
    Array(8).fill("1"),
  );
  random.mockReturnValue(0.9999);
  fireEvent.click(start);
  expect(result.firstChild?.textContent).toBe("100");
  fireEvent.keyDown(minimum, { key: "End" });
  expect(minimum).toHaveAttribute("aria-valuenow", "999");
  vi.useFakeTimers();
  fireEvent.click(start);
  expect(screen.getByRole("alert")).toHaveTextContent(
    t("fcboard.randomNumber.invalidRange"),
  );
  expect(result.firstChild?.textContent).toBe("100");
  act(() => vi.advanceTimersByTime(4500));
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(start);
  expect(screen.getByRole("alert")).toHaveTextContent(
    t("fcboard.randomNumber.invalidRange"),
  );
  fireEvent.keyDown(maximum, { key: "End" });
  fireEvent.keyDown(maximum, { key: "ArrowUp" });
  expect(maximum).toHaveAttribute("aria-valuenow", "999");
  fireEvent.click(start);
  expect(result.firstChild?.textContent).toBe("999");
  fireEvent.keyDown(minimum, { key: "Home" });
  fireEvent.keyDown(minimum, { key: "ArrowDown" });
  fireEvent.wheel(maximum, { deltaY: -10 });
  expect(minimum).toHaveAttribute("aria-valuenow", "-999");
  expect(maximum).toHaveAttribute("aria-valuenow", "998");
});

it("opens the original math resource entry and starts a fresh draw after closing", async () => {
  render(<TeachingResources api={{} as FcboardImperativeAPI} />);
  const id = teachingResources.find(
    (item) => item.action === "random-number",
  )!.id;
  const open = async () =>
    act(async () => {
      await classroomCommands.execute({ name: "resources.use", args: { id } });
    });
  await open();
  let dialog = screen.getByRole("dialog", {
    name: t("fcboard.randomNumber.title"),
  });
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: t("fcboard.randomNumber.start"),
    }),
  );
  expect(within(dialog).getByRole("status").children).toHaveLength(1);
  fireEvent.click(
    within(dialog).getByRole("button", { name: t("buttons.close") }),
  );
  await open();
  dialog = screen.getByRole("dialog", {
    name: t("fcboard.randomNumber.title"),
  });
  await waitFor(() =>
    expect(within(dialog).getByRole("status").children).toHaveLength(0),
  );
  expect(
    within(dialog).getByRole("spinbutton", {
      name: t("fcboard.randomNumber.minimum"),
    }),
  ).toHaveAttribute("aria-valuenow", "1");
});
