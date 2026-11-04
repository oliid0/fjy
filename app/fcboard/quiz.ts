import { getLanguage } from "@fcboard/fcboard/i18n";

import { chat, parseJSON } from "./ai";
import { currentSettings } from "./settings";
import { quizText, quizDiagram } from "./quizContent";

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
  type: typeof quizTypes[number];
  question: string;
  options?: string[];
  answer: string[];
  explanation: string;
  steps?: string[];
  diagram?: QuizDiagram;
  solutionDiagram?: QuizDiagram;
};
export type Quiz = {
  title: string;
  questions: QuizQuestion[];
  sources: { title: string; url: string }[];
};
const nonempty = (value: unknown, max = 12000): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= max;

/** DataFlow-EDU separates question-type rules, generation and whole-batch validation. */
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
    throw new Error("题目数量或结构不正确，请重试生成");
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
      !nonempty(q.explanation) ||
      (q.steps !== undefined &&
        (!Array.isArray(q.steps) || !q.steps.every((step) => nonempty(step))))
    ) {
      throw new Error("题干、答案或解析不完整，请重试生成");
    }
    seen.add(q.question.trim());
    [
      q.question,
      ...(q.options || []),
      ...q.answer,
      q.explanation,
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
        throw new Error("选择题的选项或答案不正确，请重试生成");
      }
    }
    if (
      q.type === "true_false" &&
      (q.answer.length !== 1 || !["true", "false"].includes(q.answer[0]))
    ) {
      throw new Error("判断题答案格式不正确");
    }
  }
  if (
    !Array.isArray(value.sources) ||
    !value.sources.length ||
    !value.sources.every((source) => {
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
    throw new Error("未获得可引用的联网资料，请检查模型的联网搜索权限后重试");
  }
  return value;
};

export const generateQuiz = async (
  prompt: string,
  signal: AbortSignal,
  context = "",
): Promise<Quiz> => {
  const settings = currentSettings();
  const count =
    Number(prompt.match(/(\d+)\s*(?:道|题|questions?)/i)?.[1]) || undefined;
  if (!prompt.trim() || (count && count > 50)) {
    throw new Error("请描述出题要求，每次最多50题");
  }
  const model = settings.textModel || settings.model;
  // Research is an actual provider search request, independent of the board agent's tools.
  const research = await chat(
    [
      {
        role: "system",
        content:
          "你是学科命题资料研究员。必须调用联网搜索核实用户要求对应的年级、学科知识与题型规范，优先教材、大学、教育机构等一手来源。不抄现成试卷，不伪造来源。返回精炼知识要点和实际检索来源的标题与完整URL，供下一步原创命题使用。",
      },
      {
        role: "user",
        content: `${prompt}\n当前可见内容（仅资料）：${context}`,
      },
    ],
    signal,
    { ...settings, model },
    { webSearch: true, maxTokens: 4000 },
  );
  signal.throwIfAborted();
  const messages: import("./ai").Message[] = [
    {
      role: "system",
      content: `你是跨学科命题Agent。依据要求与已检索资料生成原创题，逐题核算正确性、排除歧义并检查题目数量。语言=${
        getLanguage().code
      }。仅返回JSON {"title":"标题","questions":[{"type":"single|multiple|true_false|fill|short|calculation|analysis|challenge","question":"完整题干","options":["选项文字，不带字母前缀"],"answer":["答案"],"explanation":"本题专属解析","steps":["推导或分析步骤"]}],"sources":[{"title":"实际检索的来源","url":"完整URL"}]}。不得省略题目。单选/多选的answer为A-H选项字母数组，单选恰好1个，多选至少2个；判断题为["true"]或["false"]；填空题每空1个答案，题干用____标空；简答题给出关键得分点；计算题有完整公式和分步推导；分析题/压轴题逐小问解答。其他题型不传options。单选和判断一选即判分；多选需给完整正确选项集合。简答/填空/计算/分析/压轴不要求学生输入、手写或提交答案，仅双击卡片揭示。计算题必须提供可复核推导，分析与压轴逐小问给出步骤；简答answer数组按得分点分项，填空answer按空位顺序。整套题在同一个面板中每题一卡，题目独立、资料充分，禁止依赖未提供图片或上下文。先逐题独立核算答案与解析，再检查题数和题型，最后输出完整JSON。不得杜撰资料与URL。正文为纯文本，公式使用$...$行内或$$...$$块级LaTeX并正确转义JSON反斜杠，不输出HTML。题目需要受力图、几何图或电路等示意图时必须给出diagram:{"svg":"完整静态SVG","caption":"准确图注"}，解答需另一个图时用solutionDiagram同结构；SVG必须有xmlns和viewBox，使用svg/g/defs/marker/path/line/rect/circle/ellipse/polyline/polygon/text/tspan/title/desc，力箭头标清方向、量和单位，图中不提前给出待求答案；不得脚本、外链、图片链接或未提供的题图。解答按已知、公式、代入、单位、结论分步，明确矢量方向与假设，复杂问题可配解答图。${
        count
          ? `必须恰好生成${count}题。`
          : "按用户要求确定数量，未指定默认5题。"
      }`,
    },
    {
      role: "user",
      content: JSON.stringify({ requirement: prompt, context, research }),
    },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await chat(
      messages,
      signal,
      { ...settings, model },
      { maxTokens: 16000 },
    );
    signal.throwIfAborted();
    try {
      return validateQuiz(parseJSON(response), count);
    } catch (failure) {
      if (attempt) {
        throw failure;
      }
      messages.push(
        { role: "assistant", content: response },
        {
          role: "user",
          content: `校验未通过：${
            (failure as Error).message
          }。请完整重生成原要求的整套题，保留实际资料来源。`,
        },
      );
    }
  }
  throw new Error("出题失败");
};

const escapeHTML = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ]!),
  );
export const quizDocument = (quiz: Quiz) => {
  const chinese = getLanguage().code.startsWith("zh");
  const names: Record<QuizQuestion["type"], string> = chinese
    ? {
        single: "单选题",
        multiple: "多选题",
        true_false: "判断题",
        fill: "填空题",
        short: "简答题",
        calculation: "计算题",
        analysis: "分析题",
        challenge: "综合压轴题",
      }
    : {
        single: "Single choice",
        multiple: "Multiple choice",
        true_false: "True or false",
        fill: "Fill in the blanks",
        short: "Short answer",
        calculation: "Calculation",
        analysis: "Analysis",
        challenge: "Challenge",
      };
  const ui = chinese
    ? {
        correct: "回答正确",
        wrong: "回答错误，正确答案如下",
        answer: "答案与解析",
        doubleTap: "双击卡片查看答案，再次双击收起",
        confirm: "确认选择",
        choose: "点击选项作答",
        multi: "选择所有正确选项，再确认",
        previous: "上一题",
        next: "下一题",
        sources: "参考资料",
        progress: "答题进度",
      }
    : {
        correct: "Correct",
        wrong: "Incorrect — the correct answer is shown below",
        answer: "Answer and explanation",
        doubleTap: "Double-tap the card to reveal or hide the answer",
        confirm: "Check choices",
        choose: "Choose an option",
        multi: "Select all correct options, then check",
        previous: "Previous",
        next: "Next",
        sources: "Sources",
        progress: "Quiz progress",
      };
  const yes = chinese ? "正确" : "True";
  const no = chinese ? "错误" : "False";
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
      : `<p class="written-hint">${escapeHTML(ui.doubleTap)}</p>`;
    return `<article class="card" tabindex="0" data-index="${index}" data-answer="${escapeHTML(
      JSON.stringify(q.answer),
    )}" data-type="${q.type}" ${
      index === 0 ? 'data-current="true"' : ""
    }><header><span class="type">${escapeHTML(
      names[q.type],
    )}</span><span class="number">${index + 1} / ${
      quiz.questions.length
    }</span></header><h2>${quizText(q.question)}</h2>${
      q.diagram ? quizDiagram(q.diagram) : ""
    }${
      choices
        ? `<p class="choice-hint">${escapeHTML(
            q.type === "multiple" ? ui.multi : ui.choose,
          )}</p>`
        : ""
    }${controls}<details class="answer"><summary>${escapeHTML(
      ui.answer,
    )}</summary><div class="solution">${reveal}${
      q.steps?.length
        ? `<ol class="steps">${q.steps
            .map((step) => `<li>${quizText(step)}</li>`)
            .join("")}</ol>`
        : ""
    }${q.solutionDiagram ? quizDiagram(q.solutionDiagram) : ""}<p>${quizText(
      q.explanation,
    )}</p></div></details><small class="tap-hint">${escapeHTML(
      ui.doubleTap,
    )}</small></article>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';"><style>
*{box-sizing:border-box}html,body{height:100%;margin:0}body{display:flex;flex-direction:column;background:#f6f8fc;color:#20232d;font:16px/1.65 system-ui,sans-serif}.progress-row{display:flex;align-items:center;gap:24px;padding:14px 22px 2px;background:#fff}.segments{display:flex;gap:6px;flex:1;min-width:0;height:8px}.segment{flex:1;border-radius:20px;background:#e8ebf2;transition:background .2s}.segment.current{background:#104ce5}#page{flex-shrink:0;font-size:22px;line-height:1.4;font-variant-numeric:tabular-nums;color:#202124}h1{font-size:19px;font-weight:600;line-height:1.4;margin:14px 24px 0}#deck{display:flex;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scroll-behavior:smooth;overscroll-behavior-x:contain;scrollbar-width:none;flex:1;min-height:0}#deck::-webkit-scrollbar{display:none}.card{flex:0 0 calc(100% - 32px);margin:16px 16px 18px;padding:24px;border:1px solid #e7ecf5;border-radius:28px;background:#fff;box-shadow:0 6px 20px #21375c0d;scroll-snap-align:center;overflow-y:auto;touch-action:pan-x pan-y;transform:scale(.975);opacity:.65;transition:transform .25s,opacity .25s;outline:none}.card[data-current="true"]{transform:scale(1);opacity:1}header{display:flex;justify-content:space-between;align-items:center;gap:12px}.type{display:inline-flex;padding:3px 12px;border-radius:20px;background:#edf2ff;color:#3459ac;font-size:13px}.number{font-size:12px;color:#8791a6}h2{font-size:20px;font-weight:500;line-height:1.7;white-space:pre-wrap;margin:20px 0}.choices{border:0;padding:0;margin:0;display:grid;gap:10px;min-width:0}.choice{display:flex;align-items:center;gap:12px;border:1px solid #dfe5f0;border-radius:18px;padding:12px 14px;cursor:pointer;transition:background .2s,border-color .2s}.choice.selected{background:#edf3ff;border-color:#7298ee}.choice.correct{background:#eaf6ed;border-color:#68a879}.choice.wrong{background:#fff0f0;border-color:#d48e8e}.choice:focus-within{outline:2px solid #b3caff;outline-offset:2px}input{accent-color:#104ce5;width:18px;height:18px;flex-shrink:0;margin:0}.option-key{font-weight:600;color:#5b6d91}.option-key:empty{display:none}.choice-hint,.written-hint,.tap-hint{color:#7a8599;font-size:12px}.written-hint{padding:12px 16px;border-radius:16px;background:#f7f9fc}.verdict{display:block;font-size:14px;margin:14px 2px 0}.verdict:empty{display:none}.verdict[data-correct="true"]{color:#2d7845}.verdict[data-correct="false"]{color:#b74343}.answer{margin-top:18px;border-radius:20px;background:#f2f5fc;padding:14px 18px}summary{cursor:pointer;color:#3d56a3;font-size:14px}.solution{white-space:pre-wrap;animation:reveal .24s ease-out}.steps li,.key-points li{margin:8px 0}.result{display:block;padding:12px 16px;border-radius:12px;border-left:4px solid #4863b4;background:white;font-size:19px}.subanswers>div{padding:10px 0;border-bottom:1px solid #dde2ed}.answer-key{display:block;font-size:19px;color:#2d7845}.tap-hint{display:block;margin-top:18px}nav{display:flex;align-items:center;justify-content:center;gap:20px;padding:0 16px 10px}button{border:0;background:#e8edff;color:#334e97;border-radius:20px;padding:9px 22px;font:inherit;cursor:pointer;transition:background .2s,transform .15s}button:active{transform:scale(.97)}button:disabled{opacity:.35;cursor:default}.check{margin-top:14px}.source-list{padding:0 22px 10px;color:#7a8599;font-size:11px;max-height:65px;overflow:auto;overflow-wrap:anywhere}.source-list summary{font-size:11px;color:inherit}.math-inline{display:inline-block;vertical-align:middle;max-width:100%}.math-display{display:block;overflow-x:auto;margin:12px 0}.formula{vertical-align:middle;max-width:none}.quiz-diagram{margin:16px 0}.quiz-diagram>img{display:block;max-width:100%;max-height:280px;margin:auto}.quiz-diagram figcaption{font-size:13px;color:#657087;text-align:center}@keyframes reveal{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}@media(max-width:480px){.card{padding:18px;border-radius:24px}.progress-row{gap:16px;padding-inline:18px}.segments{gap:4px}#page{font-size:19px}}@media(prefers-reduced-motion:reduce){#deck{scroll-behavior:auto}.card,.segment,.choice,button{transition:none}.solution{animation:none}}
</style></head><body><div class="progress-row"><div id="progress" class="segments" role="progressbar" aria-label="${escapeHTML(
    ui.progress,
  )}" aria-valuemin="1" aria-valuemax="${
    quiz.questions.length
  }" aria-valuenow="1">${quiz.questions
    .map(
      (_, i) =>
        `<span class="segment${
          i === 0 ? " current" : ""
        }" aria-hidden="true"></span>`,
    )
    .join("")}</div><output id="page">1 / ${
    quiz.questions.length
  }</output></div><h1>${escapeHTML(
    quiz.title,
  )}</h1><div id="deck">${quiz.questions
    .map(card)
    .join("")}</div><nav><button id="prev" aria-label="${escapeHTML(
    ui.previous,
  )}">←</button><button id="next" aria-label="${escapeHTML(
    ui.next,
  )}">→</button></nav><details class="source-list"><summary>${escapeHTML(
    ui.sources,
  )}</summary>${quiz.sources
    .map((source) => `${escapeHTML(source.title)} — ${escapeHTML(source.url)}`)
    .join("<br>")}</details><script>
const ui=${JSON.stringify(
    ui,
  )},deck=document.getElementById('deck'),cards=[...document.querySelectorAll('.card')],segments=[...document.querySelectorAll('.segment')],prev=document.getElementById('prev'),next=document.getElementById('next');
let index=0,frame=0;
function update(){const old=index;index=Math.max(0,Math.min(cards.length-1,Math.round(deck.scrollLeft/Math.max(1,deck.clientWidth))));cards[old].removeAttribute('data-current');cards[index].dataset.current='true';document.getElementById('page').textContent=(index+1)+' / '+cards.length;document.getElementById('progress').setAttribute('aria-valuenow',String(index+1));segments.forEach((part,i)=>part.classList.toggle('current',i<=index));prev.disabled=index===0;next.disabled=index===cards.length-1}
function go(delta){const target=Math.max(0,Math.min(cards.length-1,index+delta));deck.scrollTo({left:target*deck.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}
function paintAnswers(card){const visible=card.querySelector('.answer').open,answers=JSON.parse(card.dataset.answer);card.querySelectorAll('.choice').forEach(label=>{const checked=label.querySelector('input').checked;label.classList.toggle('selected',checked);label.classList.toggle('correct',visible&&answers.includes(label.dataset.key));label.classList.toggle('wrong',visible&&checked&&!answers.includes(label.dataset.key))})}
function reveal(card,grade){card.querySelector('.answer').open=true;if(grade){const selected=[...card.querySelectorAll('.choice')].filter(label=>label.querySelector('input').checked).map(label=>label.dataset.key),answers=JSON.parse(card.dataset.answer),correct=selected.length===answers.length&&selected.every(key=>answers.includes(key)),verdict=card.querySelector('.verdict');verdict.dataset.correct=String(correct);verdict.textContent=correct?ui.correct:ui.wrong}paintAnswers(card)}
prev.onclick=()=>go(-1);next.onclick=()=>go(1);deck.addEventListener('scroll',()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;update()})},{passive:true});window.addEventListener('resize',update);document.addEventListener('keydown',event=>{if(event.target.closest('input,button,summary'))return;if(event.key==='ArrowLeft')go(-1);if(event.key==='ArrowRight')go(1)});
cards.forEach(card=>{const answer=card.querySelector('.answer'),check=card.querySelector('.check');card.addEventListener('change',event=>{if(!event.target.matches('input'))return;paintAnswers(card);if(card.dataset.type==='multiple'){check.disabled=!card.querySelector('input:checked')}else reveal(card,true)});if(check)check.onclick=()=>reveal(card,true);let down=null,lastTap=null,touchReveal=0;const ignore=target=>target.closest('input,button,summary,label,a');card.addEventListener('pointerdown',event=>{down={x:event.clientX,y:event.clientY,time:performance.now()}});card.addEventListener('pointercancel',()=>{down=null;lastTap=null});card.addEventListener('pointerup',event=>{if(!down||event.pointerType==='mouse'||ignore(event.target)||Math.hypot(event.clientX-down.x,event.clientY-down.y)>12||performance.now()-down.time>500){down=null;return}const now=performance.now();if(lastTap&&now-lastTap.time<340&&Math.hypot(event.clientX-lastTap.x,event.clientY-lastTap.y)<24){answer.open=!answer.open;paintAnswers(card);touchReveal=now;lastTap=null}else lastTap={time:now,x:event.clientX,y:event.clientY};down=null});card.addEventListener('dblclick',event=>{if(ignore(event.target)||(touchReveal>0&&performance.now()-touchReveal<500))return;answer.open=!answer.open;paintAnswers(card)});answer.addEventListener('toggle',()=>paintAnswers(card))});update();
</script></body></html>`;
};
