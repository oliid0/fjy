import { DiagramToCodePlugin, exportToBlob, TTDDialog } from "@fcboard/fcboard";
import { getDataURL } from "@fcboard/fcboard/data/blob";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { TTDIndexedDBAdapter } from "../data/TTDStorage";
import { chat, visualMessage } from "../fcboard/ai";

export const AIComponents = ({
  excalidrawAPI,
}: {
  excalidrawAPI: FcboardImperativeAPI;
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
              "You generate code from whiteboard sketches. Return one complete interactive self-contained HTML document with inline CSS/JavaScript, without Markdown, external links or external resources.",
          },
          visualMessage(
            "Convert this sketch into a working interactive page.",
            await getDataURL(blob),
          ),
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
                "You generate Mermaid diagrams from the actual request. Return only valid Mermaid code in a ```mermaid code block, without external links.",
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
