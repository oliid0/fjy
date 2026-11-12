import { createStore, get, set } from "idb-keyval";
import { getLanguage, t } from "@fcboard/fcboard/i18n";

import { validateInteractiveResource } from "@fcboard/fcboard/interactiveHtml";

import type { InteractiveResource } from "@fcboard/fcboard/interactiveHtml";

import { chat, parseJSON, visualMessage } from "./ai";
import { currentSettings } from "./settings";
import { createVisualizationResource } from "./visualizationResource";
import {
  teachingResourceFormat,
  teachingResourceInstructions,
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

const resourceResponse = async (
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
  const format = teachingResourceFormat(prompt, kind);
  const messages: Message[] = [
    {
      role: "system",
      content: teachingResourceInstructions(format),
    },
    visualMessage(
      JSON.stringify({
        topic: prompt,
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
      item = await resourceResponse(response, prompt);
      if (format === "vega" && !item.visualization) {
        throw new Error("Expected a Vega visualization specification");
      }
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
          content:
            format === "vega"
              ? `The visualization failed validation/rendering: ${String(
                  failure instanceof Error ? failure.message : failure,
                ).slice(
                  0,
                  1200,
                )}. Return corrected, complete JSON with title, mode and spec. Follow the original Vega/Vega-Lite contract, mathematical domains/branches and inline-data limits. No HTML, scripts or URLs. Preserve the topic, data and language.`
              : format === "auto"
              ? `The resource did not validate: ${String(
                  failure instanceof Error ? failure.message : failure,
                ).slice(
                  0,
                  1200,
                )}. Return a complete corrected resource using either the HTML or Vega contract above, choosing the medium suited to the requested interaction and style. Keep the original topic, data and language. No planning response or external dependencies.`
              : "The response could not be displayed as a visual teaching resource. Return one complete corrected self-contained HTML document starting with <!doctype html>, with a title and a visible SVG/canvas diagram or CSS-illustrated animation. A self-running visual demonstration is sufficient; interactive controls and working inline script are optional. Remove forms and external dependencies. Keep the original topic and language. Return complete HTML, not JSON, a patch or an explanation.",
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
