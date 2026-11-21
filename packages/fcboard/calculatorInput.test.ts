import {
  applyCalculatorAction,
  calculatorDisplay,
  initialCalculator,
} from "./calculatorInput";
import { evaluateCalculator } from "./calculatorExpression";

import type { CalculatorAction } from "./calculatorInput";

const operate = (...actions: (string | CalculatorAction)[]) =>
  actions.reduce(
    (state, action) =>
      applyCalculatorAction(
        state,
        typeof action === "string"
          ? action === "="
            ? { type: "equals" }
            : /^\d$|^\.$/.test(action)
            ? { type: "number", value: action }
            : { type: "operator", value: action }
          : action,
      ),
    initialCalculator,
  );

it("uses precedence while typing and continues with the last result only after equals", () => {
  const sequence = ["1", "+", "1", "*", "1", "+", "1"];
  expect(calculatorDisplay(operate(...sequence))).toBe("1+1×1+1");
  expect(calculatorDisplay(operate(...sequence, "="))).toBe("3");
  expect(calculatorDisplay(operate(...sequence, "=", "+", "1"))).toBe("3+1");
  expect(calculatorDisplay(operate(...sequence, "=", "+", "1", "="))).toBe("4");
});

it("handles changing a pending operator, backspace, negative powers, and decimal input", () => {
  expect(calculatorDisplay(operate("8", "+", "/", "2", "="))).toBe("4");
  expect(
    calculatorDisplay(operate("1", "2", "+", { type: "backspace" }, "3", "=")),
  ).toBe("123");
  expect(calculatorDisplay(operate("2", "*", "-", "3", "="))).toBe("-6");
  expect(calculatorDisplay(operate("-", "2", "=", "^", "2", "="))).toBe("4");
  expect(calculatorDisplay(operate("1", ".", "+", "2", "="))).toBe("3");
});

it("recovers from a bad expression without losing the previous answer", () => {
  const invalid = operate("2", "=", "/", "0", "=");
  expect(invalid.phase).toBe("error");
  expect(invalid.answer).toBe("2");
  expect(
    calculatorDisplay(
      applyCalculatorAction(invalid, { type: "number", value: "8" }),
    ),
  ).toBe("8");
});

it("retains scientific precedence, supported functions and angle units", () => {
  expect(evaluateCalculator("sqrt(81)+fact(4)", true)).toBe("33");
  expect(evaluateCalculator("sin(30)", true)).toBe("0.5");
  expect(evaluateCalculator("sin(PI/2)", false)).toBe("1");
  expect(evaluateCalculator("2^3^2", true)).toBe("512");
  expect(evaluateCalculator("8÷2+5%3", true)).toBe("6");
});
