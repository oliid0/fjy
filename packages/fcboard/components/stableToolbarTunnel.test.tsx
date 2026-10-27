import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { stableToolbarTunnel } from "./stableToolbarTunnel";

it("keeps independent toolbar components in position while their state and children change", () => {
  const tunnel = stableToolbarTunnel();
  const Control = ({ name }: { name: string }) => {
    const [value, setValue] = useState(0);
    return (
      <tunnel.In>
        <button onClick={() => setValue(value + 1)}>
          {name} {value}
        </button>
      </tunnel.In>
    );
  };
  const view = render(
    <>
      <Control name="白板" />
      <Control name="教师" />
      <Control name="录制" />
      <div role="toolbar">
        <tunnel.Out />
      </div>
    </>,
  );
  const first = screen.getByRole("button", { name: "白板 0" });
  const middle = screen.getByRole("button", { name: "教师 0" });
  fireEvent.click(first);
  expect(
    screen.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(["白板 1", "教师 0", "录制 0"]);
  expect(screen.getByRole("button", { name: "白板 1" })).toBe(first);
  expect(screen.getByRole("button", { name: "教师 0" })).toBe(middle);
  fireEvent.click(middle);
  expect(
    screen.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(["白板 1", "教师 1", "录制 0"]);
  view.unmount();
});

it("notifies host availability when a shape provider mounts and unmounts", () => {
  const tunnel = stableToolbarTunnel();
  const Availability = () => (
    <output>{tunnel.useHasEntries() ? "host" : "fallback"}</output>
  );
  const Host = () => (
    <tunnel.In>
      <button>Shape</button>
    </tunnel.In>
  );
  const content = (present: boolean) => (
    <>
      {present && <Host />}
      <Availability />
      <tunnel.Out />
    </>
  );
  const view = render(content(false));
  expect(screen.getByRole("status")).toHaveTextContent("fallback");
  view.rerender(content(true));
  expect(screen.getByRole("status")).toHaveTextContent("host");
  expect(screen.getByRole("button", { name: "Shape" })).toBeInTheDocument();
  view.rerender(content(false));
  expect(screen.getByRole("status")).toHaveTextContent("fallback");
  expect(screen.queryByRole("button", { name: "Shape" })).toBeNull();
});
