import { Fcboard } from "@fcboard/fcboard";
import { t } from "@fcboard/fcboard/i18n";
import { Keyboard } from "@fcboard/fcboard/tests/helpers/ui";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@fcboard/fcboard/tests/test-utils";

import { useState } from "react";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { NativeToolbarItems } from "./NativeToolbarItems";
import badminton from "./native-toolbar-assets/area_badminton_court_bg.svg?raw";
import go from "./native-toolbar-assets/area_go_bg.svg?raw";

const { h } = window;
const area = () =>
  h.elements.find(
    (element) => !element.isDeleted && element.customData?.fcNativeArea,
  );
const svgBlob = (svg: string) => {
  const file = new File([svg], "site.svg", { type: "image/svg+xml" });
  Object.defineProperty(file, "text", { value: async () => svg });
  return file;
};
const setup = async () => {
  let api!: FcboardImperativeAPI;
  const Harness = () => {
    const [current, setCurrent] = useState<FcboardImperativeAPI>();
    return (
      <Fcboard
        UIOptions={{ unifiedToolbar: true }}
        onFcboardAPI={(value) => {
          api = value;
          setCurrent(value);
        }}
      >
        {current && <NativeToolbarItems api={current} />}
      </Fcboard>
    );
  };
  await render(<Harness />);
  act(() => api.updateScene({ appState: { width: 1600, height: 900 } }));
  const open = async () => {
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.toolbox"), exact: true }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: t("fcboard.area_background"),
        exact: true,
      }),
    );
    return screen.findByRole("dialog", {
      name: t("fcboard.area_background"),
      exact: true,
    });
  };
  return { api, open };
};
afterEach(() => vi.restoreAllMocks());

it("inserts one native-size site, replaces its bitmap at the existing scale and undoes the replacement", async () => {
  const fetcher = vi.spyOn(window, "fetch").mockResolvedValue({
    ok: true,
    blob: async () => svgBlob(badminton),
  } as Response);
  const { api, open } = await setup();
  let picker = await open();
  expect(within(picker).getAllByRole("button")).toHaveLength(11);
  fireEvent.click(
    within(picker).getByRole("button", {
      name: t("fcboard.native_sites.area_badminton"),
      exact: true,
    }),
  );
  await waitFor(() => expect(area()).toBeDefined());
  const initial = area()!;
  expect(initial.width).toBeCloseTo(841.9);
  expect(initial.height).toBeCloseTo(595.3);
  expect(initial.locked).toBe(true);
  expect(Object.values(api.getFiles())).toHaveLength(1);
  picker = await open();
  fetcher.mockResolvedValue({
    ok: true,
    blob: async () => svgBlob(go),
  } as Response);
  fireEvent.click(
    within(picker).getByRole("button", {
      name: t("fcboard.native_sites.area_weiqi"),
      exact: true,
    }),
  );
  await waitFor(() => expect(area()?.version).toBeGreaterThan(initial.version));
  const replaced = area()!;
  const viewBox = new DOMParser()
    .parseFromString(go, "image/svg+xml")
    .documentElement.getAttribute("viewBox")!
    .split(/\s+/)
    .map(Number);
  expect(replaced.id).toBe(initial.id);
  expect([replaced.x, replaced.y]).toEqual([initial.x, initial.y]);
  expect(replaced.width).toBeCloseTo(viewBox[2]);
  expect(replaced.height).toBeCloseTo(viewBox[3]);
  expect(
    h.elements.filter(
      (element) => !element.isDeleted && element.customData?.fcNativeArea,
    ),
  ).toHaveLength(1);
  Keyboard.withModifierKeys({ ctrl: true }, () => Keyboard.keyPress("z"));
  await waitFor(() => expect(area()?.width).toBeCloseTo(initial.width));
  expect(area()?.height).toBeCloseTo(initial.height);
});

it("does not insert a site after its picker closes while the resource loads and reports actual failures", async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.spyOn(window, "fetch").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { api, open } = await setup();
  let picker = await open();
  fireEvent.click(
    within(picker).getByRole("button", {
      name: t("fcboard.native_sites.area_badminton"),
      exact: true,
    }),
  );
  fireEvent.click(
    within(picker).getByRole("button", {
      name: t("buttons.close"),
      exact: true,
    }),
  );
  await act(async () =>
    finish({ ok: true, blob: async () => svgBlob(badminton) } as Response),
  );
  expect(area()).toBeUndefined();
  expect(Object.values(api.getFiles())).toHaveLength(0);
  fetcher.mockRejectedValue(new Error("site unavailable"));
  picker = await open();
  fireEvent.click(
    within(picker).getByRole("button", {
      name: t("fcboard.native_sites.area_badminton"),
      exact: true,
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("site unavailable"),
  );
  expect(area()).toBeUndefined();
});
