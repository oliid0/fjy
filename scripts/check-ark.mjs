// Terminal diagnostic only. Never import credentials or this script into the app.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import dotenv from "dotenv";

const local = await readFile(
  new URL("../.env.local", import.meta.url),
  "utf8",
).catch(() => "");
const key = process.env.hs_apikey || dotenv.parse(local).hs_apikey;
if (!key) {
  throw new Error(
    "hs_apikey is missing from the process or ignored .env.local",
  );
}
const redact = (value) => String(value).replaceAll(key, "[REDACTED]");
const model = process.env.ARK_MODEL || "doubao-seed-2-0-mini-260428";
const textOutput = (response) =>
  response?.output
    ?.filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("") || "";

// Two sequential calls per protocol show real TTFT and reported cache usage.
// A short probe may not meet the provider's prefix-cache threshold; never infer a hit.
for (const path of ["chat/completions", "responses"]) {
  const cacheKey = randomUUID();
  const responses = path === "responses";
  for (let round = 1; round <= 2; round++) {
    const started = performance.now();
    let firstTokenMs;
    let answer = "";
    let usage;
    let serviceTier;
    let completed = false;
    try {
      const messages = [
        { role: "system", content: "Reply only with the arithmetic result." },
        { role: "user", content: "1+1" },
      ];
      const response = await fetch(
        `https://ark.cn-beijing.volces.com/api/v3/${path}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            stream: true,
            service_tier: "fast",
            prompt_cache_key: cacheKey,
            ...(responses
              ? {
                  input: messages,
                  reasoning: { effort: "minimal" },
                  max_output_tokens: 256,
                }
              : {
                  messages,
                  thinking: { type: "disabled" },
                  max_tokens: 256,
                  stream_options: { include_usage: true },
                }),
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) {
        const data = await response.json();
        throw new Error(
          `HTTP ${response.status}: ${data.error?.message || "Request failed"}`,
        );
      }
      let pending = "";
      const decoder = new TextDecoder();
      const consume = (line) => {
        if (!line.startsWith("data:")) {
          return;
        }
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          completed = true;
          return;
        }
        const packet = JSON.parse(data);
        if (packet.error || packet.type === "response.failed") {
          throw new Error(
            packet.error?.message ||
              packet.response?.error?.message ||
              "Stream failed",
          );
        }
        if (
          packet.type === "response.incomplete" ||
          packet.choices?.[0]?.finish_reason === "length"
        ) {
          throw new Error("Incomplete reply");
        }
        const delta = responses
          ? packet.type === "response.output_text.delta"
            ? packet.delta
            : ""
          : packet.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          firstTokenMs ??= Math.round(performance.now() - started);
          answer += delta;
        }
        usage = packet.usage || packet.response?.usage || usage;
        serviceTier =
          packet.service_tier || packet.response?.service_tier || serviceTier;
        if (packet.type === "response.completed") {
          answer = textOutput(packet.response);
          completed = true;
        }
      };
      for await (const chunk of response.body) {
        pending += decoder.decode(chunk, { stream: true });
        let newline;
        while ((newline = pending.indexOf("\n")) >= 0) {
          consume(pending.slice(0, newline).replace(/\r$/, ""));
          pending = pending.slice(newline + 1);
        }
      }
      pending += decoder.decode();
      if (pending.trim()) {
        consume(pending.trim());
      }
      if (!completed || !answer.trim()) {
        throw new Error("Stream ended without a complete answer");
      }
      console.info(
        redact(
          JSON.stringify({
            model,
            path,
            round,
            firstTokenMs,
            elapsedMs: Math.round(performance.now() - started),
            serviceTier,
            answer,
            usage,
          }),
        ),
      );
    } catch (error) {
      console.error(
        redact(
          JSON.stringify({
            model,
            path,
            round,
            elapsedMs: Math.round(performance.now() - started),
            error: String(error),
            cause: error.cause?.code,
          }),
        ),
      );
      process.exitCode = 1;
    }
  }
}
