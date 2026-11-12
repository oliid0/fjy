import { readFileSync, writeFileSync } from "node:fs";
import { transferableAbortController } from "node:util";

import { it } from "vitest";

import { chat } from "./ai";
import { generateQuiz, quizDocument } from "./quiz";
import { defaults, saveSettings } from "./settings";
import protractor from "./factory-gizmo-icons/protractor.json";
import { recognizeInkContent } from "./inkRecognition";
import { insertGeneratedImage } from "./imageGeneration";
import { sceneAPI } from "./test/scene";
import { registerCanvasCommands } from "./canvasCommands";
import { agentResponsesEndpoint, runResponsesAgent } from "./responsesAgent";

/** Opt-in only: never sends requests during ordinary tests or without a supplied key. */
const live = process.env.FCBOARD_LIVE === "1" && !!process.env.hs_apikey;
const traces: {
  model: string;
  tier?: string;
  search: boolean;
  status: number;
  reference?: boolean;
  decomposition?: boolean;
  stream?: Record<string, unknown>;
}[] = [];
const reports: Record<string, unknown> = {};
const observations: Promise<void>[] = [];
const observeStream = async (
  response: Response,
  target: Record<string, unknown>,
) => {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      raw += decoder.decode(next.value, { stream: true });
    }
  } catch (failure) {
    target.failure = (failure as Error).name;
  } finally {
    reader.releaseLock();
  }
  let visible = 0;
  let reasoning = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) {
      continue;
    }
    try {
      const packet = JSON.parse(line.slice(5).trim());
      for (const choice of packet.choices || []) {
        visible += (choice.delta?.content || "").length;
        reasoning += (choice.delta?.reasoning_content || "").length;
        if (choice.finish_reason) {
          target.finishReason = choice.finish_reason;
        }
        if (choice.delta?.annotations || choice.message?.annotations) {
          target.citations =
            choice.delta?.annotations || choice.message?.annotations;
        }
      }
      if (packet.usage) {
        target.usage = packet.usage;
      }
      if (packet.error) {
        target.errorCode = packet.error.code;
      }
    } catch {
      /* DONE or an aborted partial frame. */
    }
  }
  target.textCharacters = visible;
  target.reasoningCharacters = reasoning;
};

const nativeFetch = globalThis.fetch;
const settings = () => ({ ...defaults, apiKey: process.env.hs_apikey || "" });

it.runIf(live)(
  "LIVE: continues native Responses function calls until actual editable pen work is complete",
  async () => {
    const started = Date.now();
    const api = sceneAPI();
    const stop = registerCanvasCommands(api);
    try {
      const result = await runResponsesAgent({
        endpoint: agentResponsesEndpoint(settings().endpoint)!,
        settings: settings(),
        signal: new AbortController().signal,
        current: () => true,
        allowed: (name) => name === "canvas.ink",
        messages: [
          {
            role: "system",
            content:
              "你是白板操作Agent。调用提供的真实工具执行用户目标，根据工具结果完成后再简要报告。不要只输出计划，不调用截图，不插入文字。",
          },
          {
            role: "user",
            content:
              "使用board_draw，在实际画布坐标(400,300)、(430,280)、(460,300)之间用笔画一条折线，select=false。只执行一次，收到真实结果后说明已完成。",
          },
        ],
      });
      const ink = api
        .getSceneElements()
        .filter((element) => element.type === "freedraw");
      expect(ink).toHaveLength(1);
      expect(ink[0]).toMatchObject({
        x: 400,
        y: 300,
        points: [
          [0, 0],
          [30, -20],
          [60, 0],
        ],
      });
      expect(result.summary.trim()).not.toBe("");
      reports.responsesAgent = {
        success: true,
        elapsedMs: Date.now() - started,
        strokes: ink.length,
      };
    } finally {
      stop();
    }
  },
  180000,
);

beforeEach(() => {
  if (!live) {
    return;
  }
  // Node fetch rejects jsdom's otherwise-compatible AbortSignal brand.
  const nativeController = transferableAbortController();
  vi.stubGlobal("AbortController", nativeController.constructor);
  vi.stubGlobal("AbortSignal", nativeController.signal.constructor);
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      let response: Response;
      try {
        response = await nativeFetch(input, init);
      } catch (failure) {
        const error = failure as Error & {
          cause?: { code?: string; message?: string };
        };
        reports.transport = {
          name: error.name,
          message: error.message.replaceAll(
            process.env.hs_apikey || "__missing__",
            "[redacted]",
          ),
          cause: error.cause?.code,
        };
        throw failure;
      }
      const trace = {
        model: body.model,
        tier: body.service_tier,
        search:
          !!body.web_search_options ||
          !!body.tools?.some(
            (tool: { type: string }) => tool.type === "web_search",
          ),
        status: response.status,
        reference: !!body.image,
        decomposition: !!body.layer_decomposition,
        stream: {} as Record<string, unknown>,
      };
      traces.push(trace);
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        observations.push(observeStream(response.clone(), trace.stream));
      }
      return response;
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await Promise.allSettled(observations);
  if (live) {
    writeFileSync(
      process.env.FCBOARD_LIVE_REPORT || "/tmp/fjy-live-model-report.json",
      JSON.stringify({ reports, requests: traces }, null, 2),
    );
  }
});

it.runIf(live)(
  "LIVE: completes a default-model fast request through the actual application stream parser",
  async () => {
    const started = Date.now();
    const answer = await chat(
      [{ role: "user", content: "请只输出 OK 两个英文字母。" }],
      undefined,
      settings(),
    );
    expect(answer.trim()).toBe("OK");
    reports.default = {
      success: true,
      elapsedMs: Date.now() - started,
      answer,
    };
  },
  100000,
);

it.runIf(live)(
  "LIVE: sends a different account-listed model using ordinary parameters",
  async () => {
    const started = Date.now();
    const model = "doubao-seed-2-1-lite-260915";
    const before = traces.length;
    const answer = await chat(
      [{ role: "user", content: "计算一加一，只输出阿拉伯数字答案。" }],
      undefined,
      { ...settings(), model },
    );
    expect(answer.trim()).toBe("2");
    expect(
      traces.slice(before).every((request) => request.tier === undefined),
    ).toBe(true);
    reports.custom = {
      success: true,
      model,
      elapsedMs: Date.now() - started,
      answer,
    };
  },
  100000,
);

it.runIf(live)(
  "LIVE: routes an actual image to the configured vision model without fast parameters",
  async () => {
    const started = Date.now();
    const before = traces.length;
    const vision = "doubao-seed-2-1-lite-260915";
    const answer = await chat(
      [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "图中的数学测量工具叫什么？只回答中文名称。",
            },
            { type: "image_url", image_url: { url: protractor.gray.dataURL } },
          ],
        },
      ],
      undefined,
      { ...settings(), ocrModel: vision },
    );
    expect(answer).toContain("量角器");
    expect(
      traces
        .slice(before)
        .every(
          (request) => request.model === vision && request.tier === undefined,
        ),
    ).toBe(true);
    reports.vision = {
      success: true,
      model: vision,
      elapsedMs: Date.now() - started,
      answer,
    };
  },
  100000,
);

it.runIf(live)(
  "LIVE: researches and generates ten answerable high-school math cards using the actual quiz agent",
  async () => {
    const started = Date.now();
    saveSettings(settings(), false);
    const quiz = await generateQuiz(
      "出10道高一数学单项选择题，涵盖集合与函数，每题4个选项。必须联网检索教材与教育机构资料，原创出题并逐题核算。",
      new AbortController().signal,
    );
    expect(quiz.questions).toHaveLength(10);
    expect(
      quiz.questions.every(
        (question) =>
          question.type === "single" &&
          question.options?.length === 4 &&
          question.answer.length === 1,
      ),
    ).toBe(true);
    writeFileSync("/tmp/fjy-live-quiz.json", JSON.stringify(quiz, null, 2));
    writeFileSync("/tmp/fjy-live-quiz.html", quizDocument(quiz));
    reports.quiz = {
      success: true,
      count: quiz.questions.length,
      elapsedMs: Date.now() - started,
      sources: quiz.sources,
    };
  },
  180000,
);

it.runIf(live).each(["text", "drawing"])(
  "LIVE: magic %s ink generates and inserts the intended image",
  async (kind) => {
    const filename =
      kind === "text"
        ? "/tmp/fjy-magic-handwritten-text.png"
        : "/tmp/fjy-magic-dog-sketch.png";
    const input = `data:image/png;base64,${readFileSync(filename).toString(
      "base64",
    )}`;
    saveSettings(
      { ...settings(), ocrModel: "doubao-seed-2-1-lite-260915" },
      false,
    );
    const started = Date.now();
    const recognized = await recognizeInkContent(
      "magic",
      async () => input,
      [],
      new AbortController().signal,
    );
    expect(recognized.kind).toBe("magic");
    if (recognized.kind !== "magic") {
      throw new Error("Magic recognition failed");
    }
    expect(recognized.image).toBe(input);
    expect(recognized.prompt).toContain("若没有文字要求，仅按图生图");
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 0;
        naturalHeight = 0;
        src = "";
        async decode() {
          const bytes = Buffer.from(this.src.split(",")[1], "base64");
          expect(bytes.subarray(1, 4).toString()).toBe("PNG");
          expect(bytes.subarray(12, 16).toString()).toBe("IHDR");
          this.naturalWidth = bytes.readUInt32BE(16);
          this.naturalHeight = bytes.readUInt32BE(20);
        }
      },
    );
    const api = sceneAPI();
    const requestCount = traces.length;
    const source = api.getSceneElements().map((element) => element.id);
    await insertGeneratedImage(
      api,
      recognized.prompt,
      new AbortController().signal,
      {
        referenceImage: recognized.image,
        transparent: recognized.transparent,
        bounds: {
          left: 100,
          top: 100,
          right: 700,
          bottom: kind === "text" ? 150 : 500,
        },
        replaceIds: source,
      },
    );
    expect(traces.length - requestCount).toBe(1);
    expect(traces.at(-1)?.decomposition).toBe(false);
    const inserted = api.getSceneElements()[0];
    expect(api.getSceneElements()).toHaveLength(1);
    expect(inserted.type).toBe("image");
    const file = vi.mocked(api.addFiles).mock.calls[0][0][0];
    writeFileSync(
      `/tmp/fjy-magic-${kind}-result.png`,
      Buffer.from(file.dataURL.split(",")[1], "base64"),
    );
    reports[`magic_${kind}`] = {
      success: true,
      elapsedMs: Date.now() - started,
      prompt: recognized.prompt,
      reference: !!recognized.image,
      width: inserted.width,
      height: inserted.height,
    };
  },
  120000,
);
