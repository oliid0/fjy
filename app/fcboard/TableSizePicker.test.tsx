import { fireEvent, render } from "@testing-library/react";

import { TableSizePicker } from "./TableSizePicker";

it("previews a grid and inserts its exact cell count on release; cancellation inserts nothing", () => {
  const change = vi.fn();
  const select = vi.fn();
  const { container } = render(
    <TableSizePicker
      rows={1}
      columns={1}
      onChange={change}
      onSelect={select}
    />,
  );
  const grid = container.querySelector<HTMLElement>(".fc-table-picker-grid")!;
  const pointer = (
    type: string,
    data: MouseEventInit & { pointerId: number },
  ) => {
    const event = new MouseEvent(type, { bubbles: true, ...data });
    Object.defineProperty(event, "pointerId", { value: data.pointerId });
    fireEvent(grid, event);
  };
  grid.releasePointerCapture = vi.fn();
  vi.spyOn(grid, "getBoundingClientRect").mockReturnValue({
    left: 10,
    top: 20,
    width: 200,
    height: 140,
    right: 210,
    bottom: 160,
  } as DOMRect);
  pointer("pointerdown", { pointerId: 1, button: 0, clientX: 15, clientY: 25 });
  pointer("pointermove", {
    pointerId: 1,
    buttons: 1,
    clientX: 85,
    clientY: 75,
  });
  expect(change).toHaveBeenLastCalledWith(3, 4);
  expect(select).not.toHaveBeenCalled();
  pointer("pointerup", { pointerId: 1, clientX: 85, clientY: 75 });
  expect(select).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenLastCalledWith(3, 4);
  select.mockClear();
  pointer("pointerdown", { pointerId: 2, button: 0, clientX: 15, clientY: 25 });
  pointer("pointercancel", { pointerId: 2 });
  pointer("pointerup", { pointerId: 2, clientX: 85, clientY: 75 });
  expect(select).not.toHaveBeenCalled();
});
