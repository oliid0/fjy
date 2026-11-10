import type { OutputChunk } from "rollup";

type ClientChunk = Pick<
  OutputChunk,
  "type" | "name" | "fileName" | "isEntry" | "imports" | "modules"
>;
type ClientBundle = Record<string, ClientChunk | { type: "asset" }>;

/** Offline inference assets may be cached, but must not execute with the UI. */
export const assertClientRuntimeBoundary = (bundle: ClientBundle) => {
  const entry = Object.values(bundle).find(
    (chunk): chunk is ClientChunk =>
      chunk.type === "chunk" && chunk.isEntry && chunk.name === "app",
  );
  if (!entry) {
    throw new Error("Whiteboard app entry is missing from the output bundle");
  }
  const visited = new Set<string>();
  const visit = (chunk: ClientChunk, parents: string[]) => {
    if (visited.has(chunk.fileName)) {
      return;
    }
    visited.add(chunk.fileName);
    const path = [...parents, chunk.fileName];
    const inference = Object.keys(chunk.modules).find((id) =>
      /\/(?:@paddleocr\/paddleocr-js|@techstark\/opencv-js|onnxruntime-web)\//.test(
        id.replace(/\\/g, "/"),
      ),
    );
    if (inference) {
      throw new Error(
        `Offline inference leaked into UI startup: ${path.join(
          " -> ",
        )} (${inference})`,
      );
    }
    for (const name of chunk.imports) {
      const dependency = bundle[name];
      if (dependency?.type === "chunk") {
        visit(dependency, path);
      }
    }
  };
  visit(entry, []);
};
