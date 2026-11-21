import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { t } from "@fcboard/fcboard/i18n";

import { RollCall } from "./RollCall";
import { classroomCommands } from "./commands";
import { render } from "./test/render";
import * as imports from "./namelistImport";

const storageKey = "fcboard-rollcall-names";
beforeEach(() => localStorage.removeItem(storageKey));
afterEach(() => vi.restoreAllMocks());
const open = async () => {
  const view = render(
    <div className="fc-classroom">
      <RollCall />
    </div>,
  );
  await act(async () => classroomCommands.execute({ name: "tools.rollcall" }));
  return view;
};
const edit = () =>
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.namelist") }));
const fileInput = () =>
  screen.getByLabelText(t("fcboard.namelistImport.importFile"));

it("starts/stops/resumes by the whole content area and persists edits without a save button", async () => {
  const view = await open();
  expect(
    screen.getByRole("button", { name: t("fcboard.roll_call") }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: /^(Start|Stop|Continue|Save)$/ }),
  ).toBeNull();
  edit();
  expect(screen.queryByText(t("fcboard.namelistImport.saved"))).toBeNull();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "张三\n李四" },
  });
  expect(localStorage.getItem(storageKey)).toBe("张三\n李四");
  expect(screen.getByRole("status")).toHaveTextContent(
    t("fcboard.namelistImport.saved"),
  );
  fireEvent.click(screen.getByRole("button", { name: t("buttons.done") }));
  const stage = screen.getByRole("button", { name: t("fcboard.roll_call") });
  fireEvent.click(stage);
  expect(stage).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("status").textContent).toMatch(/张三|李四/);
  fireEvent.click(screen.getByRole("status"));
  expect(stage).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(stage);
  expect(stage).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: t("buttons.close") }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  view.unmount();
  await open();
  edit();
  expect(screen.getByRole("textbox")).toHaveValue("张三\n李四");
});

it("preserves the last saved list and shows a real storage error without claiming automatic-save success", async () => {
  localStorage.setItem(storageKey, "Original");
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key,
    value,
  ) {
    if (key === storageKey) {
      throw new Error("quota exhausted");
    }
    return original.call(this, key, value);
  });
  await open();
  edit();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Replacement" },
  });
  expect(screen.getByRole("alert")).toHaveTextContent("quota exhausted");
  expect(localStorage.getItem(storageKey)).toBe("Original");
  expect(screen.queryByText(t("fcboard.namelistImport.saved"))).toBeNull();
});

it("imports table names with correct column/header choices and lets the user choose another worksheet", async () => {
  vi.spyOn(imports, "importNamelist").mockResolvedValue([
    {
      name: "Class one",
      rows: [
        ["Id", "姓名"],
        ["1", "Doe, Jane"],
        ["2", "李四"],
      ],
    },
    { name: "Class two", rows: [["Name"], ["王五"]] },
  ]);
  await open();
  edit();
  fireEvent.change(fileInput(), {
    target: { files: [new File(["workbook"], "names.xlsx")] },
  });
  await waitFor(() =>
    expect(screen.getByRole("textbox")).toHaveValue('"Doe, Jane"\n李四'),
  );
  expect(localStorage.getItem(storageKey)).toBe('"Doe, Jane"\n李四');
  fireEvent.change(
    screen.getByRole("combobox", { name: t("fcboard.namelistImport.column") }),
    { target: { value: "0" } },
  );
  expect(screen.getByRole("textbox")).toHaveValue("1\n2");
  fireEvent.change(
    screen.getByRole("combobox", { name: t("fcboard.namelistImport.sheet") }),
    { target: { value: "1" } },
  );
  expect(screen.getByRole("textbox")).toHaveValue("王五");
  fireEvent.click(
    screen.getByRole("checkbox", { name: t("fcboard.namelistImport.header") }),
  );
  expect(screen.getByRole("textbox")).toHaveValue("Name\n王五");
});

it.each(["close", "edit"])(
  "invalidates a pending file import on %s without overwriting newer saved names",
  async (action) => {
    let complete!: (
      value: Awaited<ReturnType<typeof imports.importNamelist>>,
    ) => void;
    const read = vi.spyOn(imports, "importNamelist").mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await open();
    edit();
    fireEvent.change(fileInput(), {
      target: { files: [new File(["names"], "names.csv")] },
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      t("fcboard.namelistImport.loading"),
    );
    if (action === "close") {
      fireEvent.click(screen.getByRole("button", { name: t("buttons.close") }));
    } else {
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "New names" },
      });
    }
    expect(read.mock.calls[0][1].aborted).toBe(true);
    await act(async () => complete([{ name: "old", rows: [["Stale names"]] }]));
    expect(localStorage.getItem(storageKey)).toBe(
      action === "edit" ? "New names" : null,
    );
  },
);

it("shows import failure without replacing an existing saved list", async () => {
  localStorage.setItem(storageKey, "Original");
  vi.spyOn(imports, "importNamelist").mockRejectedValue(
    new Error("Unreadable file"),
  );
  await open();
  edit();
  fireEvent.change(fileInput(), {
    target: { files: [new File(["invalid"], "names.xlsx")] },
  });
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Unreadable file"),
  );
  expect(screen.getByRole("textbox")).toHaveValue("Original");
  expect(localStorage.getItem(storageKey)).toBe("Original");
});
