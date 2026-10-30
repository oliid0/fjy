import { render as renderComponent } from "@testing-library/react";

import { EditorJotaiProvider, editorJotaiStore } from "../editor-jotai";

import type { ReactElement } from "react";

/** App extensions run inside the editor's language/store provider in production. */
export const render = (component: ReactElement) =>
  renderComponent(
    <EditorJotaiProvider store={editorJotaiStore}>
      {component}
    </EditorJotaiProvider>,
  );
