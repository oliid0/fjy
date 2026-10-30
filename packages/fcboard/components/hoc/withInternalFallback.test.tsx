import React from "react";

import { Fcboard, MainMenu } from "../../index";
import { render, queryAllByTestId } from "../../tests/test-utils";

describe("Test internal component fallback rendering", () => {
  it("should render only one menu per fcboard instance (custom menu first scenario)", async () => {
    const { container } = await render(
      <div>
        <Fcboard>
          <MainMenu>test</MainMenu>
        </Fcboard>
        <Fcboard />
      </div>,
    );

    expect(queryAllByTestId(container, "main-menu-trigger")?.length).toBe(2);

    const excalContainers =
      container.querySelectorAll<HTMLDivElement>(".fcboard-container");

    expect(
      queryAllByTestId(excalContainers[0], "main-menu-trigger")?.length,
    ).toBe(1);
    expect(
      queryAllByTestId(excalContainers[1], "main-menu-trigger")?.length,
    ).toBe(1);
  });

  it("should render only one menu per fcboard instance (default menu first scenario)", async () => {
    const { container } = await render(
      <div>
        <Fcboard />
        <Fcboard>
          <MainMenu>test</MainMenu>
        </Fcboard>
      </div>,
    );

    expect(queryAllByTestId(container, "main-menu-trigger")?.length).toBe(2);

    const excalContainers =
      container.querySelectorAll<HTMLDivElement>(".fcboard-container");

    expect(
      queryAllByTestId(excalContainers[0], "main-menu-trigger")?.length,
    ).toBe(1);
    expect(
      queryAllByTestId(excalContainers[1], "main-menu-trigger")?.length,
    ).toBe(1);
  });

  it("should render only one menu per fcboard instance (two custom menus scenario)", async () => {
    const { container } = await render(
      <div>
        <Fcboard>
          <MainMenu>test</MainMenu>
        </Fcboard>
        <Fcboard>
          <MainMenu>test</MainMenu>
        </Fcboard>
      </div>,
    );

    expect(queryAllByTestId(container, "main-menu-trigger")?.length).toBe(2);

    const excalContainers =
      container.querySelectorAll<HTMLDivElement>(".fcboard-container");

    expect(
      queryAllByTestId(excalContainers[0], "main-menu-trigger")?.length,
    ).toBe(1);
    expect(
      queryAllByTestId(excalContainers[1], "main-menu-trigger")?.length,
    ).toBe(1);
  });

  it("should render only one menu per fcboard instance (two default menus scenario)", async () => {
    const { container } = await render(
      <div>
        <Fcboard />
        <Fcboard />
      </div>,
    );

    expect(queryAllByTestId(container, "main-menu-trigger")?.length).toBe(2);

    const excalContainers =
      container.querySelectorAll<HTMLDivElement>(".fcboard-container");

    expect(
      queryAllByTestId(excalContainers[0], "main-menu-trigger")?.length,
    ).toBe(1);
    expect(
      queryAllByTestId(excalContainers[1], "main-menu-trigger")?.length,
    ).toBe(1);
  });
});
