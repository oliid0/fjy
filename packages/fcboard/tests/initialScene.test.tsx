import { act, render, waitFor } from "@testing-library/react";
import { resolvablePromise } from "@fcboard/common";

import { Fcboard } from "../index";
import { defaultLang, setLanguage } from "../i18n";

import { API } from "./helpers/api";

import type { FcboardInitialDataState } from "../types";

beforeEach(async () => {
  await setLanguage(defaultLang);
});

describe("first writable scene", () => {
  it.each([false, true])(
    "restores a local source before yielding to another frame (factory: %s)",
    (factory) => {
      const element = API.createElement({ type: "freedraw" });
      const data = { elements: [element] };
      const initialized = vi.fn();
      const view = render(
        <Fcboard
          initialData={factory ? () => data : data}
          onInitialize={initialized}
          UIOptions={{ unifiedToolbar: true }}
        />,
      );
      expect(initialized).toHaveBeenCalledTimes(1);
      expect(window.h.state.isLoading).toBe(false);
      expect(window.h.elements[0].id).toBe(element.id);
      expect(window.h.state.activeTool.type).toBe("freedraw");
      expect(view.container.querySelector("canvas.interactive")).not.toBeNull();
      expect(view.container.querySelector(".LoadingMessage")).toBeNull();
    },
  );

  it("keeps an actual asynchronous import pending until its scene arrives", async () => {
    const data = resolvablePromise<FcboardInitialDataState | null>();
    const initialized = vi.fn();
    render(<Fcboard initialData={data} onInitialize={initialized} />);
    expect(window.h.state.isLoading).toBe(true);
    expect(initialized).not.toHaveBeenCalled();
    const element = API.createElement({ type: "rectangle" });
    await act(async () => data.resolve({ elements: [element] }));
    await waitFor(() => expect(initialized).toHaveBeenCalledTimes(1));
    expect(window.h.state.isLoading).toBe(false);
    expect(window.h.elements[0].id).toBe(element.id);
  });
});
