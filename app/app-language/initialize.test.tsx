import { render } from "@testing-library/react";

import { getLanguage, isLanguageLoaded, t } from "@fcboard/fcboard/i18n";
import { InitializeApp } from "@fcboard/fcboard/components/InitializeApp";

import { appJotaiStore } from "../app-jotai";

import { appLangCodeAtom } from "./language-state";

it("prepares the chosen non-English catalog before the first editor mount", async () => {
  appJotaiStore.set(appLangCodeAtom, "es-ES");
  const { initialLanguageReady } = await import("./initialize");
  await initialLanguageReady;
  expect(getLanguage().code).toBe("es-ES");
  expect(isLanguageLoaded("es-ES")).toBe(true);
  const mounted = vi.fn();
  const Board = () => {
    mounted();
    return <button>{t("fcboard.pen")}</button>;
  };
  const view = render(
    <InitializeApp langCode="es-ES">
      <Board />
    </InitializeApp>,
  );
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(view.getByRole("button").textContent).toBe(t("fcboard.pen"));
  expect(view.container.querySelector(".LoadingMessage")).toBeNull();
});
