import { createStore, get, set } from "idb-keyval";
import { getLanguage, t } from "@fcboard/fcboard/i18n";

import { validateInteractiveResource } from "@fcboard/fcboard/interactiveHtml";

import type { InteractiveResource } from "@fcboard/fcboard/interactiveHtml";

import { chat, parseJSON, visualMessage } from "./ai";
import { currentSettings } from "./settings";
import { createVisualizationResource } from "./visualizationResource";
import {
  teachingResourceFormat,
  teachingResourceEngines,
  teachingResourceInstructions,
  assertResourceEngines,
} from "./teachingResourcePrompt";

import type { TeachingResourceKind } from "./teachingResourcePrompt";

import type { Message } from "./ai";

export type GeneratedResource = InteractiveResource;
const storage = createStore("fcboard-resources", "resources");
let writing: Promise<unknown> = Promise.resolve();

export const generatedResources = async (): Promise<GeneratedResource[]> => {
  await writing.catch(() => {});
  return (await get<GeneratedResource[]>("items", storage)) || [];
};

const updateResources = (
  update: (items: GeneratedResource[]) => GeneratedResource[],
) => {
  const task = writing
    .catch(() => {})
    .then(async () => {
      const items = (await get<GeneratedResource[]>("items", storage)) || [];
      const next = update(items);
      await set("items", next, storage);
      return next;
    });
  writing = task;
  return task;
};

export const deleteGeneratedResource = (id: string) =>
  updateResources((items) => items.filter((item) => item.id !== id));

export const parseGeneratedResource = async (
  response: string,
  topic: string,
): Promise<GeneratedResource> => {
  const source = response
    .trim()
    .replace(/^```(?:html|json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "");
  let value: {
    title?: unknown;
    html?: unknown;
    mode?: unknown;
    spec?: unknown;
    libraries?: unknown;
  } | null;
  if (/^(?:<!doctype\s+html[^>]*>\s*)?<html\b/i.test(source)) {
    const document = new DOMParser().parseFromString(source, "text/html");
    value = {
      title:
        document.title ||
        document.querySelector("h1")?.textContent ||
        topic.slice(0, 160),
      html: source,
    };
  } else {
    value = parseJSON(source) as typeof value;
  }
  if (value?.spec) {
    return createVisualizationResource(
      typeof value.title === "string" ? value.title : topic.slice(0, 160),
      { mode: value.mode || "vega-lite", spec: value.spec },
    );
  }
  return validateInteractiveResource({
    ...value,
    id: `generated:${crypto.randomUUID()}`,
  });
};

/** Keep generated code inside the lesson iframe; it has no host command access. */
export const generateTeachingResource = async (
  prompt: string,
  signal: AbortSignal,
  context?: { text?: string; image?: string; name?: string; page?: number },
  kind: TeachingResourceKind = "auto",
) => {
  if (!prompt.trim() || prompt.length > 2000) {
    throw new Error(t("fcboard.describe_the_teaching_resource_to_generate"));
  }
  const settings = currentSettings();
  const format = teachingResourceFormat(prompt);
  const engines = teachingResourceEngines(prompt);
  const messages: Message[] = [
    {
      role: "system",
      content: teachingResourceInstructions(format),
    },
    visualMessage(
      JSON.stringify({
        topic: prompt,
        kind,
        engines,
        language: getLanguage().code,
        source: context
          ? { text: context.text, name: context.name, page: context.page }
          : undefined,
      }),
      context?.image,
    ),
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await chat(
      messages,
      signal,
      { ...settings, model: settings.textModel || settings.model },
      { maxTokens: 12000 },
    );
    signal.throwIfAborted();
    let item: GeneratedResource;
    try {
      item = await parseGeneratedResource(response, prompt);
      assertResourceEngines(item, engines);
      if (format === "html" && item.visualization) {
        throw new Error("Expected a self-contained HTML teaching resource");
      }
    } catch (failure) {
      signal.throwIfAborted();
      if (attempt === 1) {
        throw new Error(
          t("fcboard.the_generated_teaching_resource_is_invalid"),
        );
      }
      messages.push(
        { role: "assistant", content: response.slice(0, 120000) },
        {
          role: "user",
          content: `The resource failed validation: ${String(
            failure instanceof Error ? failure.message : failure,
          ).slice(0, 1200)}. Return a ${
            format === "html" || format === "jsxgraph"
              ? "complete corrected self-contained HTML document starting with <!doctype html>, not a JSON specification"
              : "complete corrected resource using the original HTML/optional-engine or declarative Vega contract"
          }. Preserve the topic, data, language and every explicit medium/engine choice or exclusion. A real visual demonstration and working inline script/controls are required when requested. Return the complete artifact, not a patch or planning response; use only the available declared engines and no external dependencies.`,
        },
      );
      continue;
    }
    signal.throwIfAborted();
    await updateResources((items) => [item, ...items]);
    return item;
  }
  throw new Error(t("fcboard.the_generated_teaching_resource_is_invalid"));
};
