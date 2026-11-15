import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { t } from "@fcboard/fcboard/i18n";

import { RollCall, parseNamelist } from "./RollCall";
import { classroomCommands } from "./commands";
import { render } from "./test/render";

it("replaces the site tool with real persistent roll-call names, start, stop and resume", async () => {
  localStorage.removeItem("fcboard-rollcall-names");
  expect(parseNamelist("张三，李四\n王五")).toEqual(["张三", "李四", "王五"]);
  const mounted = render(<RollCall />);
  await act(async () => classroomCommands.execute({ name: "tools.rollcall" }));
  expect(
    screen.getByRole("button", { name: t("fcboard.rollcall_start") }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.namelist") }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "张三\n李四" },
  });
  fireEvent.click(screen.getByRole("button", { name: t("buttons.save") }));
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.rollcall_start") }),
  );
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toMatch(/张三|李四/),
  );
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.rollcall_stop") }),
  );
  const result = screen.getByRole("status").textContent;
  expect(
    screen.getByRole("button", { name: t("fcboard.rollcall_resume") }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: t("buttons.close") }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  mounted.unmount();
  render(<RollCall />);
  await act(async () => classroomCommands.execute({ name: "tools.rollcall" }));
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.namelist") }));
  expect(screen.getByRole("textbox")).toHaveValue("张三\n李四");
  expect(result).toMatch(/张三|李四/);
});
