import {
  closeOpenParentheses,
  evaluateCalculator,
} from "./calculatorExpression";

export type CalculatorAction =
  | {
      type: "number" | "operator" | "value" | "function" | "unary";
      value: string;
    }
  | { type: "theme"; value: "light" | "dark" }
  | {
      type:
        | "equals"
        | "clear"
        | "reset"
        | "backspace"
        | "answer"
        | "angle"
        | "inverse"
        | "mode";
    };

export type CalculatorState = {
  prefix: string;
  entry: string;
  answer: string;
  phase: "input" | "result" | "error";
  scientific: boolean;
  degrees: boolean;
  inverse: boolean;
  theme: "light" | "dark" | undefined;
};

export const initialCalculator: CalculatorState = {
  prefix: "",
  entry: "",
  answer: "0",
  phase: "input",
  scientific: false,
  degrees: true,
  inverse: false,
  theme: undefined,
};

export const restoreCalculatorState = (value: unknown): CalculatorState => {
  if (value === undefined) {
    return { ...initialCalculator };
  }
  if (!value || typeof value !== "object") {
    throw new Error("Invalid calculator state");
  }
  const state = value as CalculatorState;
  if (
    ![state.prefix, state.entry, state.answer].every(
      (text) => typeof text === "string" && text.length <= 4096,
    ) ||
    !["input", "result", "error"].includes(state.phase) ||
    ![state.scientific, state.degrees, state.inverse].every(
      (flag) => typeof flag === "boolean",
    ) ||
    (state.theme !== undefined &&
      state.theme !== "light" &&
      state.theme !== "dark")
  ) {
    throw new Error("Invalid calculator state");
  }
  return {
    prefix: state.prefix,
    entry: state.entry,
    answer: state.answer,
    phase: state.phase,
    scientific: state.scientific,
    degrees: state.degrees,
    inverse: state.inverse,
    theme: state.theme,
  };
};

const binaryOperator = /[+\-*/%^]$/;
const operand = /[\w.)!]$/;
const signedOperand = (value: string) =>
  value.startsWith("-") ? `(${value})` : value;

export const calculatorDisplay = ({
  phase,
  prefix,
  entry,
  answer,
}: CalculatorState) =>
  (phase === "result" ? answer : prefix + entry || "0")
    .replaceAll("*", "×")
    .replaceAll("/", "÷");

export const applyCalculatorAction = (
  state: CalculatorState,
  action: CalculatorAction,
): CalculatorState => {
  switch (action.type) {
    case "mode":
      return { ...state, scientific: !state.scientific };
    case "inverse":
      return { ...state, inverse: !state.inverse };
    case "angle":
      return { ...state, degrees: !state.degrees };
    case "theme":
      return { ...state, theme: action.value };
    case "reset":
      return { ...state, prefix: "", entry: "", phase: "input" };
    case "clear":
      return {
        ...state,
        prefix: state.phase === "input" && state.entry ? state.prefix : "",
        entry: "",
        phase: "input",
      };
    case "equals": {
      const source = state.prefix + state.entry;
      if (state.phase !== "input" || !source) {
        return state;
      }
      try {
        const answer = evaluateCalculator(
          closeOpenParentheses(source),
          state.degrees,
        );
        return { ...state, prefix: "", entry: "", answer, phase: "result" };
      } catch {
        return { ...state, phase: "error" };
      }
    }
  }

  let prefix = state.phase === "input" ? state.prefix : "";
  let entry = state.phase === "input" ? state.entry : "";
  const add = (value: string) => {
    const previous = prefix + entry;
    prefix = previous + (operand.test(previous) ? "*" : "") + value;
    entry = "";
  };

  switch (action.type) {
    case "backspace":
      if (state.phase === "result") {
        entry = state.answer.slice(0, -1);
      } else if (entry) {
        entry = entry.slice(0, -1);
      } else {
        prefix = prefix.replace(/(?:[a-z][a-z0-9]*\($|.$)/i, "");
        const tail = prefix.match(/(?:^|[+\-*/%^()])(\d+(?:\.\d*)?)$/)?.[1];
        if (tail) {
          entry = tail;
          prefix = prefix.slice(0, -tail.length);
        }
      }
      break;
    case "number":
      if (operand.test(prefix) && !entry) {
        prefix += "*";
      }
      if (action.value === ".") {
        if (!entry.includes(".")) {
          entry = `${entry || "0"}.`;
        }
      } else {
        entry = entry === "0" ? action.value : entry + action.value;
      }
      break;
    case "value":
      add(action.value);
      break;
    case "answer":
      add(signedOperand(state.answer));
      break;
    case "function":
      add(`${action.value}(`);
      break;
    case "unary": {
      const name = action.value;
      if (state.phase === "result") {
        prefix = `${name}(${state.answer})`;
      } else if (entry) {
        const beforeSign = prefix.slice(0, -1);
        const unaryMinus =
          prefix.endsWith("-") &&
          (!beforeSign ||
            binaryOperator.test(beforeSign) ||
            beforeSign.endsWith("("));
        prefix = unaryMinus
          ? `${beforeSign}${name}(-${entry})`
          : `${prefix}${name}(${entry})`;
        entry = "";
      } else if (operand.test(prefix)) {
        prefix = `${name}(${prefix})`;
      } else {
        add(`${name}(`);
      }
      break;
    }
    case "operator": {
      const operator = action.value;
      if (operator === "(") {
        add(operator);
      } else if (operator === ")") {
        const previous = prefix + entry;
        if (
          (previous.match(/\(/g) || []).length >
            (previous.match(/\)/g) || []).length &&
          operand.test(previous)
        ) {
          prefix = `${previous})`;
          entry = "";
        }
      } else if (state.phase === "result") {
        const base =
          operator === "^" ? signedOperand(state.answer) : state.answer;
        prefix = base + operator;
      } else {
        const previous = prefix + entry;
        const pending = previous.match(/[+\-*/%^]-?$/)?.[0];
        const base = pending ? previous.slice(0, -pending.length) : previous;
        if (operand.test(base) && !base.endsWith("(")) {
          prefix =
            operator === "-" && pending && !pending.endsWith("-")
              ? `${previous}-`
              : base + operator;
          entry = "";
        } else if (!previous || previous.endsWith("(")) {
          prefix = operator === "-" ? `${previous}-` : previous;
        }
      }
      break;
    }
  }
  if (prefix.length + entry.length > 512) {
    return state;
  }
  return { ...state, prefix, entry, phase: "input" };
};
