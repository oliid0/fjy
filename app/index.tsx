import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import "../app/sentry";

import { initialLanguageReady } from "./app-language/initialize";

import "./fcboard/lanCrypto";

import FcboardApp from "./App";

window.__EXCALIDRAW_SHA__ = import.meta.env.VITE_APP_GIT_SHA;
const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);
registerSW();
void initialLanguageReady.then(() => {
  root.render(
    <StrictMode>
      <FcboardApp />
    </StrictMode>,
  );
});
