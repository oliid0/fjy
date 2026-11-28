import quizNumbers from "@fcboard/fcboard/locales/data/quizNumbers.json";
import { getLanguage, t } from "@fcboard/fcboard/i18n";

import { chat, parseJSON, visualMessage } from "./ai";
import { currentSettings } from "./settings";
import { quizText, quizDiagram } from "./quizContent";
import { generateQuizImage } from "./quizRequests";
import { validateQuizFigure } from "./quizFigure";

import type { QuizFigure } from "./quizFigure";

import type { QuizDiagram } from "./quizContent";

export const quizTypes = [
  "single",
  "multiple",
  "true_false",
  "fill",
  "short",
  "calculation",
  "analysis",
  "challenge",
] as const;
export type QuizQuestion = {
  id?: string;
  image?: {
    method: "draw";
    spec: QuizFigure;
    caption: string;
    status: "pending" | "ready" | "error";
    dataURL?: string;
    error?: string;
  };
  type: typeof quizTypes[number];
  question: string;
  options?: string[];
  answer: string[];
  explanation?: string;
  steps?: string[];
  diagram?: QuizDiagram;
  solutionDiagram?: QuizDiagram;
};
export type Quiz = {
  id?: string;
  plannedCount?: number;
  generating?: boolean;
  errors?: string[];
  title: string;
  questions: QuizQuestion[];
  sources: { title: string; url: string }[];
};
const nonempty = (value: unknown, max = 12000): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= max;

/** Validate actual question content before publishing a completed card. */
export const validateQuiz = (input: unknown, count?: number): Quiz => {
  const value = input as Quiz;
  if (
    !value ||
    !nonempty(value.title, 200) ||
    !Array.isArray(value.questions) ||
    !value.questions.length ||
    value.questions.length > 50 ||
    (count && value.questions.length !== count)
  ) {
    throw new Error(t("fcboard.aiMessages.quizInvalidStructure"));
  }
  const seen = new Set<string>();
  for (const q of value.questions) {
    if (
      !q ||
      !quizTypes.includes(q.type) ||
      !nonempty(q.question) ||
      seen.has(q.question.trim()) ||
      !Array.isArray(q.answer) ||
      !q.answer.length ||
      !q.answer.every((answer) => nonempty(answer)) ||
      (q.explanation !== undefined && typeof q.explanation !== "string") ||
      (q.steps !== undefined &&
        (!Array.isArray(q.steps) || !q.steps.every((step) => nonempty(step))))
    ) {
      throw new Error(t("fcboard.aiMessages.quizIncomplete"));
    }
    seen.add(q.question.trim());
    [
      q.question,
      ...(q.options || []),
      ...q.answer,
      q.explanation || "",
      ...(q.steps || []),
    ].forEach(quizText);
    if (q.diagram) {
      quizDiagram(q.diagram);
    }
    if (q.solutionDiagram) {
      quizDiagram(q.solutionDiagram);
    }
    if (q.type === "single" || q.type === "multiple") {
      if (
        !Array.isArray(q.options) ||
        q.options.length < 2 ||
        q.options.length > 8 ||
        !q.options.every((option) => nonempty(option)) ||
        new Set(q.options).size !== q.options.length ||
        !q.answer.every(
          (answer) =>
            /^[A-H]$/.test(answer) &&
            answer.charCodeAt(0) - 65 < q.options!.length,
        ) ||
        new Set(q.answer).size !== q.answer.length ||
        (q.type === "single" && q.answer.length !== 1) ||
        (q.type === "multiple" && q.answer.length < 2)
      ) {
        throw new Error(t("fcboard.aiMessages.quizInvalidChoices"));
      }
    }
    if (
      q.type === "true_false" &&
      (q.answer.length !== 1 || !["true", "false"].includes(q.answer[0]))
    ) {
      throw new Error(t("fcboard.aiMessages.quizInvalidBoolean"));
    }
  }
  validateSources(value.sources);
  return value;
};

const validateSources = (sources: Quiz["sources"]) => {
  if (
    !Array.isArray(sources) ||
    !sources.every((source) => {
      try {
        return (
          nonempty(source.title, 500) &&
          ["http:", "https:"].includes(new URL(source.url).protocol)
        );
      } catch {
        return false;
      }
    })
  ) {
    throw new Error(t("fcboard.aiMessages.quizMissingSources"));
  }
};

export const generateQuiz = async (
  prompt: string,
  signal: AbortSignal,
  context = "",
  image?: string,
  questionType?: QuizQuestion["type"],
  onProgress?: (quiz: Quiz) => void,
): Promise<Quiz> => {
  const settings = currentSettings();
  const requested = quizNumbers.patterns
    .map((pattern) => prompt.match(new RegExp(pattern, "i"))?.[1])
    .find((value) => value !== undefined);
  const digits = quizNumbers.digits as Record<string, number>;
  const count =
    requested === undefined
      ? 5
      : /^\d+$/.test(requested)
      ? Number(requested)
      : requested.includes(quizNumbers.hundred)
      ? 100
      : requested.includes(quizNumbers.ten)
      ? (digits[requested.split(quizNumbers.ten)[0]] || 1) * 10 +
        (digits[requested.split(quizNumbers.ten)[1]] || 0)
      : digits[requested];
  if (
    !prompt.trim() ||
    (questionType !== undefined && !quizTypes.includes(questionType)) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 50
  ) {
    throw new Error(t("fcboard.aiMessages.quizDescribeRequest"));
  }
  const modelSettings = {
    ...settings,
    model: settings.textModel || settings.model,
  };
  // Independent questions start immediately; no research/planning round blocks them.
  const plan = {
    title: prompt.trim().split(/\s+/).join(" ").slice(0, 200).trimEnd(),
    tasks: Array.from({ length: count }, (_, index) => ({
      type: questionType,
      focus: `Question ${
        index + 1
      } of ${count}; cover a distinct part of the complete request.`,
    })),
    sources: [] as Quiz["sources"],
  };
  let value: Quiz = {
    id: crypto.randomUUID(),
    title: plan.title,
    plannedCount: count,
    generating: true,
    questions: [],
    sources: plan.sources,
    errors: [],
  };
  const publish = () => {
    signal.throwIfAborted();
    onProgress?.(value);
  };
  const update = (question: QuizQuestion) => {
    value = {
      ...value,
      questions: value.questions.map((existing) =>
        existing.id === question.id ? question : existing,
      ),
    };
    publish();
  };
  publish();
  const illustrations: Promise<void>[] = [];
  await Promise.all(
    plan.tasks.map((task, index) =>
      Promise.resolve()
        .then(async () => {
          const messages: import("./ai").Message[] = [
            {
              role: "system",
              content: `Generate ONE original independent quiz question in interface language ${
                getLanguage().code
              }. The app renders fixed HTML cards; return compact JSON only: {"type":"${
                task.type || quizTypes.join("|")
              }","question":"complete question","options":["choice without letter"],"answer":["answer"]}. Options are only for choice questions. Single has one A-H answer, multiple at least two; true_false uses ["true"] or ["false"]. Fill uses ____ and ordered answers. Other types need question and answer only; explanation and steps are optional. Use escaped LaTeX where useful. Follow ALL text in the supplied screenshot as the user's quiz requirements and use its diagrams as source evidence. A necessary scientific/mathematical diagram MUST be returned in this SAME JSON as "figure": {"caption":"...","mode":"vega|vega-lite","spec":{inline Vega specification}} or {"caption":"...","mode":"jsxgraph","boundingbox":[-5,5,5,-5],"axis":false,"elements":[{"id":"A","type":"point","parents":[0,0],"attributes":{"name":"A"}}]}. JSXGraph supports point,line,segment,arrow,polygon,circle,angle,curve,text; use earlier element IDs as parents, numeric coordinate arrays for curves; no JavaScript/functions. Use only inline data and meaningful labels, units and geometry. Figure data must exactly match the question without revealing its answer. NEVER request generated images, photographs, pictorial counting questions such as counting apples, HTML, image URLs or a separate drawing task. Prefer self-contained text questions when no schematic is needed. Do not search, review, or call another model. ${
                task.type
                  ? `Use type ${task.type}.`
                  : "Choose the appropriate type."
              }`,
            },
            visualMessage(
              JSON.stringify({
                requirement: prompt,
                context,
                sources: plan.sources,
                task: index + 1,
                brief: task,
                otherBriefs: plan.tasks.map((other) => other.focus),
              }),
              image,
            ),
          ];
          const response = await chat(messages, signal, modelSettings, {
            maxTokens: 3000,
            useVisionModel: true,
            quickVision: true,
          });
          signal.throwIfAborted();
          const candidate = parseJSON(response) as QuizQuestion & {
            figure?: QuizFigure & { caption?: string };
          };
          const question = validateQuiz(
            {
              title: plan.title,
              sources: plan.sources,
              questions: [candidate],
            },
            1,
          ).questions[0];
          if (task.type && question.type !== task.type) {
            throw new Error(
              t("fcboard.quizForm.typeMismatch", {
                type: t(`fcboard.aiMessages.quizType_${task.type}`),
              }),
            );
          }
          if (candidate.figure) validateQuizFigure(candidate.figure);
          if (
            value.questions.some(
              (existing) =>
                existing.question.trim() === question.question.trim(),
            )
          ) {
            throw new Error(t("fcboard.aiMessages.quizIncomplete"));
          }
          const ready: QuizQuestion = {
            type: question.type,
            question: question.question,
            options: question.options,
            answer: question.answer,
            explanation: question.explanation,
            steps: question.steps,
            id: crypto.randomUUID(),
            ...(candidate.figure
              ? {
                  image: {
                    method: "draw" as const,
                    spec: candidate.figure,
                    caption: candidate.figure.caption || "",
                    status: "pending" as const,
                  },
                }
              : {}),
          };
          value = { ...value, questions: [...value.questions, ready] };
          publish();
          if (ready.image) {
            illustrations.push(
              generateQuizImage(ready, signal).then(
                (dataURL) => {
                  update({
                    ...ready,
                    image: { ...ready.image!, status: "ready", dataURL },
                  });
                },
                (failure) => {
                  if (signal.aborted) {
                    return;
                  }
                  update({
                    ...ready,
                    image: {
                      ...ready.image!,
                      status: "error",
                      error:
                        failure instanceof Error
                          ? failure.message
                          : String(failure),
                    },
                  });
                },
              ),
            );
          }
        })
        .catch((failure) => {
          signal.throwIfAborted();
          value = {
            ...value,
            errors: [
              ...value.errors!,
              t("fcboard.quizForm.questionFailed", {
                number: index + 1,
                message:
                  failure instanceof Error ? failure.message : String(failure),
              }),
            ],
          };
          publish();
        }),
    ),
  );
  await Promise.all(illustrations);
  signal.throwIfAborted();
  value = { ...value, generating: false };
  publish();
  return value;
};

const escapeHTML = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ]!),
  );
const quizLabels = () => ({
  correct: t("fcboard.aiMessages.quiz_correct"),
  wrong: t("fcboard.aiMessages.quiz_wrong"),
  answer: t("fcboard.aiMessages.quiz_answer"),
  confirm: t("fcboard.aiMessages.quiz_confirm"),
  choose: t("fcboard.aiMessages.quiz_choose"),
  multi: t("fcboard.aiMessages.quiz_multi"),
  previous: t("fcboard.aiMessages.quiz_previous"),
  next: t("fcboard.aiMessages.quiz_next"),
  sources: t("fcboard.aiMessages.quiz_sources"),
  progress: t("fcboard.aiMessages.quiz_progress"),
  pending: t("fcboard.quizForm.questionPending"),
  cancelled: t("fcboard.quizForm.cancelled"),
  imagePending: t("fcboard.quizForm.imagePending"),
  imageInvalid: t("fcboard.quizForm.imageInvalid"),
  retryImage: t("fcboard.quizForm.retryImage"),
});
const quizImage = (q: QuizQuestion, generating: boolean) => {
  if (!q.image) {
    return "";
  }
  const ui = quizLabels();
  const image = q.image;
  const ready =
    image.status === "ready" &&
    typeof image.dataURL === "string" &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(
      image.dataURL,
    );
  return `<figure class="quiz-image" data-image-id="${escapeHTML(
    q.id || "",
  )}">${
    ready
      ? `<img loading="lazy" decoding="async" alt="${escapeHTML(
          image.caption,
        )}" src="${image.dataURL}"/><figcaption>${escapeHTML(
          image.caption,
        )}</figcaption>`
      : image.status === "pending"
      ? `<p class="loading" role="status"><span class="spinner"></span>${escapeHTML(
          ui.imagePending,
        )}</p>`
      : `<p role="alert">${escapeHTML(
          image.error || ui.imageInvalid,
        )}</p><button ${
          generating ? "disabled" : ""
        } data-retry-image="${escapeHTML(q.id || "")}">${escapeHTML(
          ui.retryImage,
        )}</button>`
  }</figure>`;
};

const quizCards = (quiz: Quiz, previous?: Quiz) => {
  const names: Record<QuizQuestion["type"], string> = {
    single: t("fcboard.aiMessages.quizType_single"),
    multiple: t("fcboard.aiMessages.quizType_multiple"),
    true_false: t("fcboard.aiMessages.quizType_true_false"),
    fill: t("fcboard.aiMessages.quizType_fill"),
    short: t("fcboard.aiMessages.quizType_short"),
    calculation: t("fcboard.aiMessages.quizType_calculation"),
    analysis: t("fcboard.aiMessages.quizType_analysis"),
    challenge: t("fcboard.aiMessages.quizType_challenge"),
  };
  const ui = quizLabels();
  const yes = t("fcboard.aiMessages.quiz_true");
  const no = t("fcboard.aiMessages.quiz_false");
  const card = (q: QuizQuestion, index: number) => {
    const choices =
      q.type === "true_false"
        ? [yes, no]
        : q.type === "single" || q.type === "multiple"
        ? q.options
        : undefined;
    const answers =
      q.type === "true_false" ? [q.answer[0] === "true" ? yes : no] : q.answer;
    const reveal =
      q.type === "fill"
        ? `<ol class="blanks">${answers
            .map((answer) => `<li>${quizText(answer)}</li>`)
            .join("")}</ol>`
        : q.type === "single" ||
          q.type === "multiple" ||
          q.type === "true_false"
        ? `<strong class="answer-key">${answers
            .map(quizText)
            .join("、")}</strong>`
        : q.type === "short"
        ? `<ul class="key-points">${answers
            .map((answer) => `<li>${quizText(answer)}</li>`)
            .join("")}</ul>`
        : q.type === "calculation"
        ? `<output class="result">${answers.map(quizText).join("\n")}</output>`
        : `<section class="subanswers">${answers
            .map(
              (answer, i) => `<div><b>${i + 1}.</b> ${quizText(answer)}</div>`,
            )
            .join("")}</section>`;
    const controls = choices
      ? `<fieldset class="choices" aria-label="${escapeHTML(
          names[q.type],
        )}">${choices
          .map(
            (option, i) =>
              `<label class="choice" data-key="${
                q.type === "true_false"
                  ? String(i === 0)
                  : String.fromCharCode(65 + i)
              }"><input type="${
                q.type === "multiple" ? "checkbox" : "radio"
              }" name="q${index}"/><span class="option-key">${
                q.type === "true_false" ? "" : String.fromCharCode(65 + i)
              }</span><span>${quizText(option)}</span></label>`,
          )
          .join("")}</fieldset>${
          q.type === "multiple"
            ? `<button class="check" disabled>${escapeHTML(
                ui.confirm,
              )}</button>`
            : ""
        }<output class="verdict" role="status" aria-live="polite"></output>`
      : "";
    return `<article class="card" tabindex="0" data-ready="true" data-id="${escapeHTML(
      q.id || String(index),
    )}" data-index="${index}" data-answer="${escapeHTML(
      JSON.stringify(q.answer),
    )}" data-type="${q.type}" ${
      index === 0 ? 'data-current="true"' : ""
    }><header><span class="type">${escapeHTML(
      names[q.type],
    )}</span><span class="number">${index + 1} / ${
      quiz.plannedCount || quiz.questions.length
    }</span></header><section class="problem"><h2>${quizText(q.question)}</h2>${
      q.image
        ? quizImage(q, !!quiz.generating)
        : q.diagram
        ? quizDiagram(q.diagram)
        : ""
    }${
      choices
        ? `<p class="choice-hint">${escapeHTML(
            q.type === "multiple" ? ui.multi : ui.choose,
          )}</p>`
        : ""
    }${controls}</section><details class="answer"><summary>${escapeHTML(
      ui.answer,
    )}</summary><div class="solution">${reveal}${
      q.steps?.length
        ? `<ol class="steps">${q.steps
            .map((step) => `<li>${quizText(step)}</li>`)
            .join("")}</ol>`
        : ""
    }${q.solutionDiagram ? quizDiagram(q.solutionDiagram) : ""}<p>${quizText(
      q.explanation || "",
    )}</p></div></details></article>`;
  };
  const total = Math.max(
    quiz.questions.length,
    Math.min(50, quiz.plannedCount || quiz.questions.length),
  );
  return Array.from({ length: total }, (_, index) => {
    if (
      previous &&
      previous.questions[index] === quiz.questions[index] &&
      (quiz.questions[index]
        ? quiz.questions[index].image?.status !== "error" ||
          previous.generating === quiz.generating
        : previous.generating === quiz.generating &&
          previous.errors === quiz.errors)
    ) {
      return null;
    }
    if (quiz.questions[index]) {
      return card(quiz.questions[index], index);
    }
    const failureStart = total - (quiz.errors?.length || 0);
    const failure =
      index >= failureStart
        ? quiz.errors![index - failureStart]
        : !quiz.generating
        ? ui.cancelled
        : "";
    return `<article class="card" tabindex="0" data-index="${index}" ${
      index === 0 ? 'data-current="true"' : ""
    }>${
      failure
        ? `<p role="alert">${escapeHTML(failure)}</p>`
        : `<p class="loading" role="status"><span class="spinner"></span>${escapeHTML(
            ui.pending,
          )}</p>`
    }</article>`;
  });
};

/** Updates carry only locally rendered, escaped content from the same card
 * renderer used by the standalone document. Ready cards retain all input state. */
export const quizUpdate = (quiz: Quiz, previous?: Quiz) => ({
  title: quiz.title,
  cards: quizCards(quiz, previous),
  sources: quiz.sources
    .map((source) => `${escapeHTML(source.title)} — ${escapeHTML(source.url)}`)
    .join("<br>"),
});

export const quizDocument = (quiz: Quiz, channel = "standalone") => {
  const markup = quizUpdate(quiz);
  const ui = quizLabels();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';"><style>

*{box-sizing:border-box}html,body{height:100%;margin:0}body{display:flex;flex-direction:column;background:#f6f8fc;color:#20232d;font:16px/1.65 system-ui,sans-serif}.progress-row{display:flex;align-items:center;gap:24px;padding:14px 22px 2px;background:#fff}.segments{display:flex;gap:6px;flex:1;min-width:0;height:8px}.segment{flex:1;border-radius:20px;background:#e8ebf2;transition:background .2s}.segment.current{background:#104ce5}#page{flex-shrink:0;font-size:22px;line-height:1.4;font-variant-numeric:tabular-nums;color:#202124}h1{font-size:19px;font-weight:600;line-height:1.4;margin:14px 24px 0}#deck{display:flex;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scroll-behavior:smooth;overscroll-behavior-x:contain;scrollbar-width:none;flex:1;min-height:0}#deck::-webkit-scrollbar{display:none}.card{display:flex;flex-direction:column;flex:0 0 calc(100% - 32px);margin:16px 16px 18px;padding:24px;border:1px solid #e7ecf5;border-radius:28px;background:#fff;box-shadow:0 6px 20px #21375c0d;scroll-snap-align:center;overflow:hidden;touch-action:pan-x pan-y;transform:scale(.975);opacity:.65;transition:transform .25s,opacity .25s;outline:none}.card[data-current="true"]{transform:scale(1);opacity:1}header{display:flex;justify-content:space-between;align-items:center;gap:12px}.type{display:inline-flex;padding:3px 12px;border-radius:20px;background:#edf2ff;color:#3459ac;font-size:13px}.number{font-size:12px;color:#8791a6}h2{font-size:20px;font-weight:500;line-height:1.7;white-space:pre-wrap;margin:20px 0}.choices{border:0;padding:0;margin:0;display:grid;gap:10px;min-width:0}.choice{display:flex;align-items:center;gap:12px;border:1px solid #dfe5f0;border-radius:18px;padding:12px 14px;cursor:pointer;transition:background .2s,border-color .2s}.choice.selected{background:#edf3ff;border-color:#7298ee}.choice.correct{background:#eaf6ed;border-color:#68a879}.choice.wrong{background:#fff0f0;border-color:#d48e8e}.choice:focus-within{outline:2px solid #b3caff;outline-offset:2px}input{accent-color:#104ce5;width:18px;height:18px;flex-shrink:0;margin:0}.option-key{font-weight:600;color:#5b6d91}.option-key:empty{display:none}.choice-hint{color:#7a8599;font-size:12px}.verdict{display:block;font-size:14px;margin:14px 2px 0}.verdict:empty{display:none}.verdict[data-correct="true"]{color:#2d7845}.verdict[data-correct="false"]{color:#b74343}.answer{margin-top:18px;border-radius:20px;background:#f2f5fc;padding:14px 18px}summary{cursor:pointer;color:#3d56a3;font-size:14px}.solution{white-space:pre-wrap;animation:reveal .24s ease-out}.steps li,.key-points li{margin:8px 0}.result{display:block;padding:12px 16px;border-radius:12px;border-left:4px solid #4863b4;background:white;font-size:19px}.subanswers>div{padding:10px 0;border-bottom:1px solid #dde2ed}.answer-key{display:block;font-size:19px;color:#2d7845}nav{display:flex;align-items:center;justify-content:center;gap:20px;padding:0 16px 10px}button{border:0;background:#e8edff;color:#334e97;border-radius:20px;padding:9px 22px;font:inherit;cursor:pointer;transition:background .2s,transform .15s}button:active{transform:scale(.97)}button:disabled{opacity:.35;cursor:default}.check{margin-top:14px}.source-list{padding:0 22px 10px;color:#7a8599;font-size:11px;max-height:65px;overflow:auto;overflow-wrap:anywhere}.source-list summary{font-size:11px;color:inherit}.math-inline{display:inline-block;vertical-align:middle;max-width:100%}.math-display{display:block;overflow-x:auto;margin:12px 0}.formula{vertical-align:middle;max-width:none}.quiz-diagram{margin:16px 0}.quiz-diagram>img{display:block;max-width:100%;max-height:280px;margin:auto}.quiz-diagram figcaption{font-size:13px;color:#657087;text-align:center}@keyframes reveal{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}@media(max-width:480px){.card{padding:18px;border-radius:24px}.progress-row{gap:16px;padding-inline:18px}.segments{gap:4px}#page{font-size:19px}}@media(prefers-reduced-motion:reduce){#deck{scroll-behavior:auto}.card,.segment,.choice,button{transition:none}.solution{animation:none}}

.problem{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}.answer{flex-shrink:0;max-height:50%;overflow:hidden}.answer[open]{display:flex;flex-direction:column;min-height:90px}.answer[open]::details-content{display:flex;flex:1;min-height:0;overflow:hidden}.answer[open]>.solution{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}.answer:not([open])>.solution{display:none}.answer>summary{flex-shrink:0}.quiz-image{margin:16px 0}.quiz-image>img{display:block;max-width:100%;max-height:280px;margin:auto}.quiz-image figcaption{font-size:13px;color:#657087;text-align:center}.loading{display:flex;align-items:center;justify-content:center;gap:12px;min-height:80px}.spinner{width:24px;height:24px;border:3px solid #dce5fc;border-top-color:#104ce5;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.card:not([data-ready]){justify-content:center}.card:not([data-ready])>p{overflow-wrap:anywhere}.card>header{flex-shrink:0}.answer .solution>p{margin-bottom:0}

</style></head><body><div class="progress-row"><div id="progress" class="segments" role="progressbar" aria-label="${escapeHTML(
    ui.progress,
  )}" aria-valuemin="1" aria-valuemax="${
    markup.cards.length
  }" aria-valuenow="1">${markup.cards
    .map(
      (_, i) =>
        `<span class="segment${
          i === 0 ? " current" : ""
        }" aria-hidden="true"></span>`,
    )
    .join("")}</div><output id="page">1 / ${
    markup.cards.length
  }</output></div><h1>${escapeHTML(
    quiz.title,
  )}</h1><div id="deck">${markup.cards.join(
    "",
  )}</div><nav><button id="prev" aria-label="${escapeHTML(
    ui.previous,
  )}">←</button><button id="next" aria-label="${escapeHTML(
    ui.next,
  )}">→</button></nav><details class="source-list"><summary>${escapeHTML(
    ui.sources,
  )}</summary><div id="sources">${markup.sources}</div></details><script>
const ui=${JSON.stringify(ui)},channel=${JSON.stringify(
    channel,
  )},deck=document.getElementById('deck'),prev=document.getElementById('prev'),next=document.getElementById('next');
let cards=[...document.querySelectorAll('.card')],segments=[...document.querySelectorAll('.segment')],index=0,frame=0;
function update(){
  const old=index;
  index=Math.max(0,Math.min(cards.length-1,Math.round(deck.scrollLeft/Math.max(1,deck.clientWidth))));
  if(cards[old])cards[old].removeAttribute('data-current');
  if(cards[index])cards[index].dataset.current='true';
  document.getElementById('page').textContent=(index+1)+' / '+cards.length;
  document.getElementById('progress').setAttribute('aria-valuenow',String(index+1));
  segments.forEach((part,i)=>part.classList.toggle('current',i<=index));
  prev.disabled=index===0;next.disabled=index===cards.length-1;
}
function go(delta){const target=Math.max(0,Math.min(cards.length-1,index+delta));deck.scrollTo({left:target*deck.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}
function paintAnswers(card){const visible=card.querySelector('.answer').open,answers=JSON.parse(card.dataset.answer);card.querySelectorAll('.choice').forEach(label=>{const checked=label.querySelector('input').checked;label.classList.toggle('selected',checked);label.classList.toggle('correct',visible&&answers.includes(label.dataset.key));label.classList.toggle('wrong',visible&&checked&&!answers.includes(label.dataset.key))})}
function reveal(card,grade){card.querySelector('.answer').open=true;if(grade){const selected=[...card.querySelectorAll('.choice')].filter(label=>label.querySelector('input').checked).map(label=>label.dataset.key),answers=JSON.parse(card.dataset.answer),correct=selected.length===answers.length&&selected.every(key=>answers.includes(key)),verdict=card.querySelector('.verdict');verdict.dataset.correct=String(correct);verdict.textContent=correct?ui.correct:ui.wrong}paintAnswers(card)}
function bindCard(card){
  if(card.dataset.ready!=='true')return;
  const answer=card.querySelector('.answer'),check=card.querySelector('.check');
  card.addEventListener('change',event=>{if(!event.target.matches('input'))return;paintAnswers(card);if(card.dataset.type==='multiple'){check.disabled=!card.querySelector('input:checked')}else reveal(card,true)});
  if(check)check.onclick=()=>reveal(card,true);
  let down=null,lastTap=null,touchReveal=0;
  const ignore=target=>target.closest('input,button,summary,label,a');
  card.addEventListener('pointerdown',event=>{down={x:event.clientX,y:event.clientY,time:performance.now()}});
  card.addEventListener('pointercancel',()=>{down=null;lastTap=null});
  card.addEventListener('pointerup',event=>{if(!down||event.pointerType==='mouse'||ignore(event.target)||Math.hypot(event.clientX-down.x,event.clientY-down.y)>12||performance.now()-down.time>500){down=null;return}const now=performance.now();if(lastTap&&now-lastTap.time<340&&Math.hypot(event.clientX-lastTap.x,event.clientY-lastTap.y)<24){answer.open=!answer.open;paintAnswers(card);touchReveal=now;lastTap=null}else lastTap={time:now,x:event.clientX,y:event.clientY};down=null});
  card.addEventListener('dblclick',event=>{if(ignore(event.target)||(touchReveal>0&&performance.now()-touchReveal<500))return;answer.open=!answer.open;paintAnswers(card)});
  answer.addEventListener('toggle',()=>paintAnswers(card));
}
prev.onclick=()=>go(-1);next.onclick=()=>go(1);
deck.addEventListener('scroll',()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;update()})},{passive:true});
window.addEventListener('resize',update);
document.addEventListener('keydown',event=>{if(event.target.closest('input,button,summary'))return;if(event.key==='ArrowLeft')go(-1);if(event.key==='ArrowRight')go(1)});
document.addEventListener('click',event=>{const button=event.target.closest('[data-retry-image]');if(button)parent.postMessage({type:'quiz-retry-image',channel,id:button.dataset.retryImage},'*')});
window.addEventListener('message',event=>{
  const data=event.data;
  if(event.source!==parent||!data||data.type!=='quiz-progress'||data.channel!==channel||!Array.isArray(data.cards))return;
  data.cards.forEach((html,i)=>{
    if(typeof html!=='string')return;
    const template=document.createElement('template');template.innerHTML=html;
    const incoming=template.content.firstElementChild,existing=cards[i];
    if(!incoming)return;
    if(existing&&existing.dataset.ready==='true'&&existing.dataset.id===incoming.dataset.id){
      const oldImage=existing.querySelector('.quiz-image'),newImage=incoming.querySelector('.quiz-image');
      if(oldImage&&newImage&&oldImage.outerHTML!==newImage.outerHTML)oldImage.replaceWith(newImage);
    }else if(!existing){deck.append(incoming);bindCard(incoming)}
    else{existing.replaceWith(incoming);bindCard(incoming)}
  });
  cards=[...deck.querySelectorAll('.card')];
  document.querySelector('h1').textContent=data.title;
  document.getElementById('sources').innerHTML=data.sources;
  const progress=document.getElementById('progress');
  if(segments.length!==cards.length){progress.innerHTML=cards.map(()=>'<span class="segment" aria-hidden="true"></span>').join('');segments=[...progress.children]}
  progress.setAttribute('aria-valuemax',String(cards.length));update();
});
cards.forEach(bindCard);update();
</script></body></html>`;
};
