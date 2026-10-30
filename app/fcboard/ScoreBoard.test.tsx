import { fireEvent, screen, within } from "@testing-library/react";
import { t } from "@fcboard/fcboard/i18n";

import { render } from "./test/render";
import { ScoreBoard } from "./ScoreBoard";

it("keeps independent scores including negatives, commits/cancels raw names, and resets on reopening", () => {
  const close = vi.fn();
  const view = render(<ScoreBoard onClose={close} />);
  const first = t("fcboard.scoreBoard.group1");
  const second = t("fcboard.scoreBoard.group2");
  const scores = () =>
    Array.from(
      view.container.querySelectorAll("output"),
      (node) => node.textContent,
    );
  expect(scores()).toEqual(["1", "2", "1"]);
  fireEvent.click(
    screen.getByRole("button", {
      name: t("fcboard.scoreBoard.decrease", { name: first }),
    }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: t("fcboard.scoreBoard.decrease", { name: first }),
    }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: t("fcboard.scoreBoard.increase", { name: second }),
    }),
  );
  expect(scores()).toEqual(["-1", "3", "1"]);
  const edit = () =>
    fireEvent.click(
      screen.getByRole("button", {
        name: t("fcboard.scoreBoard.editNameFor", { name: first }),
      }),
    );
  edit();
  let dialog = screen.getByRole("dialog", {
    name: t("fcboard.scoreBoard.editName"),
  });
  fireEvent.change(within(dialog).getByRole("textbox"), {
    target: { value: "discarded" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: t("fcboard.scoreBoard.cancel"),
    }),
  );
  expect(screen.queryByText("discarded")).toBeNull();
  edit();
  dialog = screen.getByRole("dialog", {
    name: t("fcboard.scoreBoard.editName"),
  });
  fireEvent.change(within(dialog).getByRole("textbox"), {
    target: { value: "  Team A  " },
  });
  fireEvent.submit(within(dialog).getByRole("textbox").closest("form")!);
  expect(
    view.container.querySelector(".fc-score-group-heading strong")?.textContent,
  ).toBe("  Team A  ");
  expect(scores()).toEqual(["-1", "3", "1"]);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
  view.unmount();
  render(<ScoreBoard onClose={close} />);
  expect(screen.getAllByRole("status").map((node) => node.textContent)).toEqual(
    ["1", "2", "1"],
  );
});
