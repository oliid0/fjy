import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MaterialSelect } from "./MaterialSelect";

const setup = () => {
  const close = vi.fn();
  const change = vi.fn();
  const Example = () => {
    const [value, setValue] = useState("first");
    return (
      <Dialog open disablePortal onClose={close} aria-label="Settings">
        <section
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              close();
            }
          }}
        >
          <label>
            Recognition
            <MaterialSelect
              aria-label="Recognition"
              value={value}
              onChange={(event) => {
                change(event.target.value);
                setValue(event.target.value);
              }}
            >
              <option value="first">Local ink</option>
              <option value="second">Fallback</option>
            </MaterialSelect>
          </label>
          <input aria-label="Endpoint" />
        </section>
      </Dialog>
    );
  };
  render(<Example />);
  const trigger = screen.getByRole("combobox", { name: "Recognition" });
  fireEvent.mouseDown(trigger);
  return { trigger, close, change };
};

it("dismisses an open choice with Escape without changing its value or closing the parent dialog", async () => {
  const { trigger, close, change } = setup();
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  expect(trigger).toHaveTextContent("Local ink");
  expect(change).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
});

it("dismisses the choices by tapping outside without requiring a choice", async () => {
  const { trigger, close, change } = setup();
  fireEvent.click(document.querySelector(".MuiMenu-root .MuiBackdrop-root")!);
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  expect(trigger).toHaveTextContent("Local ink");
  expect(change).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Endpoint" }), {
    key: "Escape",
  });
  expect(close).toHaveBeenCalledTimes(1);
});

it("changes a choice and closes the temporary menu", async () => {
  const { trigger, change } = setup();
  fireEvent.click(screen.getByRole("option", { name: "Fallback" }));
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  expect(trigger).toHaveTextContent("Fallback");
  expect(change).toHaveBeenCalledWith("second");
});

it("keeps the internal value input out of label activation and mobile text entry", () => {
  const { trigger, change } = setup();
  const input = trigger.parentElement!.querySelector("input")!;
  expect(input.type).toBe("hidden");
  expect(input.inputMode).toBe("none");
  fireEvent.click(screen.getByRole("option", { name: "Fallback" }));
  expect(change).toHaveBeenCalledWith("second");
  expect(document.activeElement).not.toBe(input);
});
