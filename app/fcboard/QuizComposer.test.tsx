import { useState } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { t } from "@fcboard/fcboard/i18n";

import { render } from "./test/render";
import { QuizComposer } from "./QuizComposer";

it("submits the selected grade, actual quiz type, difficulty and supplementary requirements", () => {
  const submit = vi.fn();
  render(<QuizComposer open onClose={vi.fn()} onSubmit={submit} />);
  fireEvent.change(
    screen.getByRole("combobox", { name: t("fcboard.quizForm.grade") }),
    { target: { value: "6" } },
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: t("fcboard.quizForm.type") }),
    { target: { value: "calculation" } },
  );
  fireEvent.click(
    screen.getByRole("radio", { name: t("fcboard.quizForm.hard") }),
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: t("fcboard.quizForm.supplement") }),
    { target: { value: "  出3道分数题，附解析  " } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.quizForm.generate") }),
  );
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit.mock.calls[0][0]).toContain("Grade 6");
  expect(submit.mock.calls[0][0]).toContain("only calculation");
  expect(submit.mock.calls[0][0]).toContain("Difficulty: hard");
  expect(submit.mock.calls[0][0]).toContain("出3道分数题，附解析");
  expect(submit.mock.calls[0][1]).toBe("calculation");
});

it("preserves editable choices across close/reopen and never submits on cancellation", async () => {
  const close = vi.fn();
  const submit = vi.fn();
  const Host = () => {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button onClick={() => setOpen(true)}>Reopen builder</button>
        <QuizComposer
          open={open}
          onClose={() => {
            close();
            setOpen(false);
          }}
          onSubmit={submit}
        />
      </>
    );
  };
  render(<Host />);
  fireEvent.change(
    screen.getByRole("textbox", { name: t("fcboard.quizForm.supplement") }),
    { target: { value: "Knowledge from the board" } },
  );
  fireEvent.click(screen.getByRole("button", { name: t("buttons.cancel") }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(submit).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Reopen builder" }));
  expect(
    screen.getByRole("textbox", { name: t("fcboard.quizForm.supplement") }),
  ).toHaveValue("Knowledge from the board");
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.quizForm.generate") }),
  );
  expect(submit.mock.calls[0][1]).toBeUndefined();
});
