import { act, renderHook } from "@testing-library/react";

import { Provider, appJotaiStore } from "../app-jotai";

import { languageDetector } from "./language-detector";
import { appLangCodeAtom, useAppLangCode } from "./language-state";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it("follows system changes without saving the auto-detected language as a manual override", () => {
  const detect = vi
    .spyOn(languageDetector, "detect")
    .mockReturnValue(["en-US"]);
  const cache = vi.spyOn(languageDetector, "cacheUserLanguage");
  appJotaiStore.set(appLangCodeAtom, "system");
  const view = renderHook(useAppLangCode, {
    wrapper: ({ children }) => (
      <Provider store={appJotaiStore}>{children}</Provider>
    ),
  });
  expect(view.result.current[0]).toBe("en");
  act(() => {
    detect.mockReturnValue(["zh-Hant-HK"]);
    window.dispatchEvent(new Event("languagechange"));
  });
  expect(view.result.current[0]).toBe("zh-TW");
  expect(localStorage.getItem("fcboard-language")).toBe("system");
  expect(cache).not.toHaveBeenCalled();
  view.unmount();
});

it("keeps a manual language until the user chooses system again", () => {
  vi.spyOn(languageDetector, "detect").mockReturnValue(["de-DE"]);
  appJotaiStore.set(appLangCodeAtom, "fr-FR");
  const view = renderHook(useAppLangCode, {
    wrapper: ({ children }) => (
      <Provider store={appJotaiStore}>{children}</Provider>
    ),
  });
  act(() => window.dispatchEvent(new Event("languagechange")));
  expect(view.result.current[0]).toBe("fr-FR");
  act(() => view.result.current[1]("system"));
  expect(view.result.current[0]).toBe("de-DE");
  view.unmount();
});
