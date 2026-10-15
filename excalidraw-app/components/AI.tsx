import {
  DiagramToCodePlugin,
  exportToBlob,
  TTDDialog,
} from "@excalidraw/excalidraw";
import { getDataURL } from "@excalidraw/excalidraw/data/blob";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { TTDIndexedDBAdapter } from "../data/TTDStorage";
import { chat, visualMessage } from "../fcdraw/ai";

export const AIComponents = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => (
  <>
    <DiagramToCodePlugin
      generate={async ({ frame, children }) => {
        const blob = await exportToBlob({
          elements: children,
          appState: { ...excalidrawAPI.getAppState(), exportBackground: true },
          exportingFrame: frame,
          files: excalidrawAPI.getFiles(),
          mimeType: "image/png",
          maxWidthOrHeight: 1600,
        });
        const html = await chat([
          {
            role: "system",
            content:
              "你是方成教育代码助手。根据白板草图生成完整可交互的单文件 HTML，包含内联 CSS 和 JavaScript。只返回 HTML，不要 markdown，不使用外部链接或外部资源。",
          },
          visualMessage("将这张草图转为可以使用的页面", await getDataURL(blob)),
        ]);
        return {
          html: html
            .replace(/^\s*```(?:html)?\s*/i, "")
            .replace(/\s*```\s*$/, ""),
        };
      }}
    />
    <TTDDialog
      onTextSubmit={async ({ messages, onChunk, onStreamCreated, signal }) => {
        onStreamCreated?.();
        const generatedResponse = await chat(
          [
            {
              role: "system",
              content:
                "你是方成教育图表助手。根据用户要求生成 Mermaid 图表，只输出有效 Mermaid 代码，用 ```mermaid 代码块包裹。不使用外链。",
            },
            ...messages,
          ],
          signal,
        );
        onChunk?.(generatedResponse);
        return { generatedResponse, error: null };
      }}
      persistenceAdapter={TTDIndexedDBAdapter}
    />
  </>
);
